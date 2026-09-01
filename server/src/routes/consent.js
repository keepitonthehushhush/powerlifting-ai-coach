import { Router } from 'express';
import { z } from 'zod';
import { codedError } from '../lib/errorCodes.js';
import { logger } from '../lib/logger.js';
import {
  CONSENT_TYPES,
  POLICY_VERSIONS,
  REQUIRED_CONSENTS,
  deriveCurrentConsents,
} from '../lib/policyVersions.js';

export const consentRouter = Router();

/**
 * Consent recording, per Washington's My Health My Data Act.
 *
 * The Act requires SEPARATE opt-in consent before collecting consumer health
 * data — a bundled "I agree to the terms" checkbox does not satisfy it — and
 * requires withdrawal to be as easy as granting. Hence one endpoint that takes
 * a single consent type at a time, and a withdrawal path that is the same
 * endpoint with `granted: false`.
 *
 * The ledger is append-only and enforced as such by the database: the
 * `authenticated` role holds INSERT and SELECT on `consent_records` and
 * nothing else, so this route could not rewrite consent history even if it
 * tried to.
 */

const ConsentRequest = z.object({
  consent_type: z.enum(CONSENT_TYPES),
  granted: z.boolean(),
});

/** GET /api/consent — current state plus the versions currently in force. */
consentRouter.get('/', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('consent_records')
      .select('consent_type, granted, policy_version, created_at, seq')
      .order('seq', { ascending: false });

    if (error) throw codedError('storage_unavailable', 'Could not load your consent records.');

    // Rows arrive ordered by seq descending, so the first occurrence of each
    // type is its current state. See migration 0010 for why not created_at.
    const current = deriveCurrentConsents(data ?? []);

    res.json({
      consents: current,
      current_versions: POLICY_VERSIONS,
      required: REQUIRED_CONSENTS,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/consent — record one consent decision.
 *
 * Granting and withdrawing use the same shape, because withdrawal must be no
 * harder than granting. The policy version is taken from the server, never
 * from the request: a client that could name the version could record consent
 * to a policy the user never saw.
 */
consentRouter.post('/', async (req, res, next) => {
  try {
    const parsed = ConsentRequest.safeParse(req.body);
    if (!parsed.success) {
      throw codedError('invalid_request', 'Invalid consent request.', { fields: parsed.error.flatten().fieldErrors });
    }
    const { consent_type: consentType, granted } = parsed.data;

    const { data, error } = await req.supabase
      .from('consent_records')
      .insert({
        user_id: req.user.id,
        consent_type: consentType,
        granted,
        policy_version: POLICY_VERSIONS[consentType],
      })
      .select('consent_type, granted, policy_version, created_at')
      .single();

    if (error) throw codedError('storage_unavailable', 'Could not record your decision.', { cause: error.code });

    // Withdrawing health data consent must also stop the data being held.
    // Leaving it stored while recording that permission was withdrawn is the
    // kind of gap that makes a consent mechanism decorative.
    let healthDataCleared = false;
    if (consentType === 'health_data_collection' && !granted) {
      /**
       * Every field the database counts as health data, cleared together.
       *
       * ── WHY "TOGETHER" IS LOAD-BEARING AND NOT MERELY TIDY ──────────────
       *
       * This list must be a SUPERSET of private.health_fingerprint(). Not a
       * subset, not "most of it" - a superset, because of how the consent
       * trigger decides whether a write is a collection event.
       *
       * private.require_health_data_consent() compares the fingerprint of the
       * old row to the fingerprint of the new one. It permits the write when
       * the new fingerprint is NULL, which is the "clearing everything" case,
       * and when the two are identical, which is the "unrelated edit" case.
       * A clear that misses one health column produces a new fingerprint that
       * is neither null nor equal to the old one - so the trigger reads it as
       * a fresh collection of health data, finds the consent just withdrawn,
       * and REFUSES IT.
       *
       * That is not a partial erasure. It is a total one: the UPDATE is one
       * statement, so the rejection rolls back the other ten columns too. The
       * consent record has already been written by then, in its own request.
       * The ledger says withdrawn, the profile still holds the injury note,
       * and the athlete gets "please contact support".
       *
       * Which is what shipped. Migration 0024 added gender, 0033 added
       * glp1_status, both were added to the fingerprint, and neither was added
       * here - so withdrawal was broken for every athlete who answered either
       * question, and worked for everybody else. Reproduced against the
       * preview database before this line was changed.
       *
       * The comment that used to sit here claimed rls_isolation_test.sql
       * asserted the two lists agree. It does not and never did. The assertion
       * now exists, in server/test/healthWithdrawal.test.js, and it derives
       * the expected set from the migrations rather than restating it - so the
       * next health column added is a failing test rather than a fourth
       * comment promising something nothing checks.
       */
      const { error: clearError } = await req.supabase
        .from('user_profile')
        .update({
          health_restrictions: '',
          health_restrictions_updated_at: null,
          // Not null: the column is NOT NULL, and "has not answered yet" is a
          // different statement from "is not cleared". Same reasoning as the
          // retention sweep in migration 0035.
          cleared_to_train: false,
          sleep_hours_typical: null,
          alcohol_units_per_week: null,
          nicotine_use: null,
          nutrition_notes: null,
          gender: null,
          gender_self_described: null,
          glp1_status: null,
          glp1_status_updated_at: null,
          training_obstacle: null,
          training_if_then: null,
          training_intention_updated_at: null,
        })
        .eq('user_id', req.user.id);

      if (clearError) {
        logger.error('consent.withdrawal_clear_failed', {
          userId: req.user.id,
          code: clearError.code,
        });
        throw codedError(
          'withdrawal_incomplete',
          'Your withdrawal was recorded but the stored health information could not be removed. Please contact support.'
        );
      }
      healthDataCleared = true;
    }

    // Which decision, never the health data it governs.
    logger.info('consent.recorded', {
      userId: req.user.id,
      consentType,
      granted,
      policyVersion: POLICY_VERSIONS[consentType],
      healthDataCleared,
    });

    res.status(201).json({ consent: data, health_data_cleared: healthDataCleared });
  } catch (err) {
    next(err);
  }
});

/** GET /api/consent/history — the full ledger, for the user's own inspection. */
consentRouter.get('/history', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('consent_records')
      .select('consent_type, granted, policy_version, created_at')
      .order('seq', { ascending: false })
      .limit(200);

    if (error) throw codedError('storage_unavailable', 'Could not load your consent history.');
    res.json({ history: data ?? [] });
  } catch (err) {
    next(err);
  }
});

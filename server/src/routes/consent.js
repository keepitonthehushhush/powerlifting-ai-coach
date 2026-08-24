import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/httpError.js';
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

    if (error) throw new HttpError(502, 'Could not load your consent records.');

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
      throw new HttpError(400, 'Invalid consent request.', parsed.error.flatten().fieldErrors);
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

    if (error) throw new HttpError(502, 'Could not record your decision.', { code: error.code });

    // Withdrawing health data consent must also stop the data being held.
    // Leaving it stored while recording that permission was withdrawn is the
    // kind of gap that makes a consent mechanism decorative.
    let healthDataCleared = false;
    if (consentType === 'health_data_collection' && !granted) {
      const { error: clearError } = await req.supabase
        .from('user_profile')
        .update({ health_restrictions: '', cleared_to_train: false })
        .eq('user_id', req.user.id);

      if (clearError) {
        logger.error('consent.withdrawal_clear_failed', {
          userId: req.user.id,
          code: clearError.code,
        });
        throw new HttpError(
          502,
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

    if (error) throw new HttpError(502, 'Could not load your consent history.');
    res.json({ history: data ?? [] });
  } catch (err) {
    next(err);
  }
});

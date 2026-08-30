import { Router } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { codedError } from '../lib/errorCodes.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sendGuardianConsentEmail } from '../lib/mailer.js';
import { adultGateDecision } from '../lib/ageGate.js';
import { GUARDIAN_CONSENT_VERSION } from '../lib/policyVersions.js';
import { createAnonymousClient } from '../lib/supabase.js';

/**
 * The guardian consent round trip.
 *
 * Two endpoints with opposite security models, which is why they are in one
 * file: reading them together is the only way to see that the asymmetry is
 * deliberate.
 *
 *   POST /api/guardian/request    the ATHLETE asks. Authenticated, rate
 *                                 limited, refused outside the 13-17 band by
 *                                 the database rather than by this route.
 *
 *   POST /api/guardian/decision   the GUARDIAN answers. NO AUTHENTICATION,
 *                                 because a guardian has no account and
 *                                 requiring one would mean making a parent
 *                                 sign up to a service they are being asked to
 *                                 permit rather than use.
 *
 * What authorizes the second is the token: 32 bytes of CSPRNG, delivered to an
 * address the athlete named, stored only as a SHA-256 hash. See migration 0044
 * for why the token is never written down and why saying no always works.
 */
/** The athlete's half. Mounted BELOW requireAuth. */
export const guardianRouter = Router();

/**
 * The guardian's half. Mounted ABOVE requireAuth, deliberately and visibly.
 *
 * app.js states the property this preserves: "everything under /api is
 * authenticated unless it is visibly, explicitly, above this line." A separate
 * router makes the exception a mount rather than a condition inside the guard,
 * which is the same reasoning the Stripe webhook is mounted that way.
 */
export const guardianPublicRouter = Router();

/** 32 bytes. Base64url so it survives an email client without escaping. */
function newToken() {
  return randomBytes(32).toString('base64url');
}

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const RequestBody = z.object({
  /**
   * Zod's email check, and nothing more ambitious.
   *
   * Address validation beyond "has a plausible shape" is a well-known way to
   * reject real addresses, and the actual test of an address is whether mail to
   * it arrives. The database applies its own floor as a CHECK.
   */
  guardian_email: z.string().trim().toLowerCase().email().max(320),
});

const DecisionBody = z.object({
  token: z.string().min(1).max(512),
  granted: z.boolean(),
});

/**
 * GET /api/guardian/status
 *
 * What the athlete needs to see: does this apply to me, has anybody been
 * asked, and did they answer.
 *
 * ── WHY THE SERVER DECIDES `applicable` ───────────────────────────────────
 *
 * The page could compute the age band from the date of birth it already has,
 * and that would be one fewer request. It would also be a second
 * implementation of the rule, in a language where it is easy to get the leap
 * year wrong, sitting next to the one in the database that actually decides.
 * Two implementations of an age gate is how a fifteen-year-old sees a form
 * that then refuses them, or worse, does not see one they need.
 *
 * ── AND WHY IT RETURNS THE ADDRESS ────────────────────────────────────────
 *
 * The athlete typed it. Showing it back is how they notice they sent it to
 * dad@gmail.con, which is otherwise a silent failure that looks exactly like a
 * guardian who has not got round to it yet.
 */
guardianRouter.get('/status', async (req, res, next) => {
  try {
    if (!config.minors.enabled) {
      return res.json({ applicable: false, reason: 'feature_off' });
    }

    const [{ data: profile }, { data: requests }, { data: consents }] = await Promise.all([
      req.supabase.from('user_profile').select('date_of_birth').maybeSingle(),
      req.supabase
        .from('guardian_consent_requests')
        // Never token_hash - migration 0044 does not grant it, and asking for
        // it would fail the whole request rather than omit the column.
        .select('id, guardian_email, created_at, expires_at, decided_at, decision')
        .order('created_at', { ascending: false })
        .limit(1),
      req.supabase
        .from('consent_records')
        .select('granted, policy_version, created_at')
        .eq('consent_type', 'guardian_consent')
        .order('seq', { ascending: false })
        .limit(1),
    ]);

    const gate = adultGateDecision(profile ?? {}, { minorsEnabled: true });
    if (!gate.isMinor || gate.reason === 'too_young') {
      return res.json({ applicable: false, reason: gate.reason === 'too_young' ? 'too_young' : 'adult' });
    }

    const latest = requests?.[0] ?? null;
    const consent = consents?.[0] ?? null;

    /**
     * `active` is the only field the coach's own gate agrees with, so it is
     * computed the same way: the latest decision must be a grant AND against
     * the current version. A stale grant is not an active consent, and saying
     * otherwise here would put a green tick above a coach that still refuses.
     */
    const active = Boolean(
      consent?.granted && consent.policy_version === GUARDIAN_CONSENT_VERSION
    );

    res.json({
      applicable: true,
      active,
      request: latest && {
        guardian_email: latest.guardian_email,
        sent_at: latest.created_at,
        expires_at: latest.expires_at,
        decided_at: latest.decided_at,
        decision: latest.decision,
      },
      // A grant against a superseded version. The guardian has to be asked
      // again, and the athlete should be told that rather than left wondering.
      stale: Boolean(consent?.granted && !active),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/guardian/request
 *
 * The athlete names a guardian; we send them a link.
 *
 * Rate limited on the `write` bucket. Without it this is an endpoint that makes
 * our server send mail to an address chosen by the caller, which is a mail
 * relay wearing a different hat - and the abuse is not hypothetical, it is the
 * first thing anybody tries.
 */
guardianRouter.post('/request', rateLimit('write'), async (req, res, next) => {
  try {
    if (!config.minors.enabled) {
      // The flag is off, so this whole path is closed. Same reasoning as the
      // gate: writing the code is not the decision to ship it.
      throw codedError('not_available', 'Coaching for under-18s is not enabled.', { feature: 'minors' });
    }

    const parsed = RequestBody.safeParse(req.body);
    if (!parsed.success) {
      throw codedError('invalid_request', 'That does not look like an email address.', {
        field: 'guardian_email',
      });
    }

    const token = newToken();

    /**
     * The hash goes to the database; the token stays here and goes in the mail.
     * The RPC also enforces the 13-17 band, so an adult cannot manufacture a
     * guardian consent for themselves by calling this directly.
     */
    const { data: requestId, error } = await req.supabase.rpc('request_guardian_consent', {
      p_guardian_email: parsed.data.guardian_email,
      p_token_hash: sha256(token),
    });

    if (error) {
      const detail = `${error.message ?? ''} ${error.hint ?? ''}`;
      if (/not_applicable/.test(detail)) {
        throw codedError(
          'age_restricted',
          'A parent or guardian only needs to agree for athletes aged 13 to 17.',
          { reason: 'not_applicable' }
        );
      }
      if (/requires_date_of_birth/.test(detail)) {
        throw codedError(
          'precondition_missing',
          'Please add your date of birth on the profile page first.',
          { needs: 'date_of_birth' }
        );
      }
      logger.error('guardian.request_failed', { userId: req.user.id, code: error.code });
      throw codedError('storage_unavailable', 'Could not start the guardian request.');
    }

    /**
     * The athlete's display name, if they set one - never their email, never
     * anything about their training. See mailer.js on what the message carries.
     */
    const { data: profile } = await req.supabase
      .from('user_profile')
      .select('display_name')
      .maybeSingle();

    const link = `${config.publicOrigin}/guardian/consent?token=${encodeURIComponent(token)}`;
    const outcome = await sendGuardianConsentEmail({
      to: parsed.data.guardian_email,
      link,
      athleteName: profile?.display_name ?? null,
    });

    /**
     * ── THE ONE THING THIS MUST NOT DO ──────────────────────────────────
     *
     * Report success when the mail did not go. The request row exists either
     * way, so a silent failure leaves the athlete waiting for a message that
     * will never arrive, with an interface that told them it was sent. That is
     * worse than an error, because there is nothing to retry and nothing to
     * report.
     */
    if (!outcome.sent) {
      logger.error('guardian.email_not_sent', { userId: req.user.id, reason: outcome.reason });
      throw codedError(
        'email_unavailable',
        'We saved the request but could not send the email just now. Please try again shortly.',
        { reason: outcome.reason }
      );
    }

    // The fact and the request id. Never the guardian's address.
    logger.info('guardian.request_sent', { userId: req.user.id, requestId });

    res.status(201).json({ request_id: requestId, sent: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/guardian/decision
 *
 * The guardian answers. Public by design; see the file header.
 *
 * Mounted WITHOUT requireAuth, so this brings its own anonymous client rather
 * than reading `req.supabase`, which requireAuth is what sets. That is the
 * point: `record_guardian_consent` is granted to `anon` and derives the account
 * from the token, so there is no user id here to get wrong - and nothing else
 * an anonymous client could reach is worth reaching.
 */
guardianPublicRouter.post('/decision', async (req, res, next) => {
  try {
    const parsed = DecisionBody.safeParse(req.body);
    if (!parsed.success) {
      throw codedError('invalid_request', 'That link is not valid.', { field: 'token' });
    }

    const { data: outcome, error } = await createAnonymousClient().rpc('record_guardian_consent', {
      p_token_hash: sha256(parsed.data.token),
      p_granted: parsed.data.granted,
    });

    if (error) {
      logger.error('guardian.decision_failed', { code: error.code });
      throw codedError('storage_unavailable', 'Could not record your decision.');
    }

    /**
     * The outcome is returned to a stranger, so it is a fixed vocabulary from
     * the function rather than anything derived from the row. `unknown` is
     * deliberately the same answer for a token that never existed and one that
     * was deleted by retention: neither is a fact this caller is owed.
     */
    logger.info('guardian.decision', { outcome });

    const messages = {
      granted: 'Thank you. Coach Diaz can now coach them, and you can change your mind at any time using this same link.',
      withdrawn: 'Done. Coach Diaz will stop coaching them immediately. Their logged training and their account are untouched.',
      already_decided: 'This link has already been used to agree. If you want to change that, choose "withdraw" below - that always works.',
      expired: 'This link has expired, so it can no longer be used to agree. It can still be used to say no.',
      unknown: 'We do not recognize this link. It may have been replaced by a newer one.',
    };

    res.json({ outcome, message: messages[outcome] ?? messages.unknown });
  } catch (err) {
    next(err);
  }
});

/**
 * Exported for the tests, which assert that a token is never stored and that
 * two different tokens never hash alike. `timingSafeEqual` is imported for the
 * same reason it is not used above: the lookup is a database index on a hash of
 * a 256-bit secret, so there is no comparison here to time.
 */
export const __testing = { newToken, sha256, timingSafeEqual };

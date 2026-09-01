import { createUserScopedClient } from '../lib/supabase.js';
import { displayCode } from '../lib/errorCodes.js';
import { logger } from '../lib/logger.js';
import { assuranceLevelOf, describeStepUp, shouldRefuse } from '../lib/assuranceLevel.js';

/**
 * Authenticate the caller and hand the rest of the request an RLS-scoped
 * database client.
 *
 * After this middleware runs:
 *   req.user      - the verified Supabase user (id, email)
 *   req.supabase  - a client that executes every query AS THAT USER
 *
 * Why verify with getUser() rather than decoding the JWT locally:
 * local verification with the project's JWT secret is faster (no network hop)
 * but it validates the signature and expiry only - it cannot tell that a
 * session was signed out or revoked thirty seconds ago. getUser() asks the
 * auth server, which knows. At this scale the round trip is not the
 * bottleneck; the honest tradeoff is that if request volume ever makes it one,
 * the fix is local verification plus a short-lived revocation cache, not
 * dropping the check.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing Bearer token.',
      // ONE code for both 401 paths, on purpose. The vagueness below is a
      // security decision - telling a caller whether a token was expired,
      // malformed or revoked tells an attacker which knob to turn - and a
      // shared code keeps that property while still making 401s countable.
      details: { code: 'auth_required', errorCode: displayCode('auth_required') },
    });
  }

  try {
    const supabase = createUserScopedClient(token);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      // Deliberately vague to the client - distinguishing "expired" from
      // "malformed" from "revoked" tells an attacker which knob to turn.
      // The detail goes to the log, not the response.
      logger.warn('auth.rejected', { reason: error?.message ?? 'no user' });
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid or expired session.',
        details: { code: 'auth_required', errorCode: displayCode('auth_required') },
      });
    }

    /*
     * ── AND IS THIS SESSION STRONG ENOUGH FOR THIS ACCOUNT? ─────────────
     *
     * A verified second factor with an aal1 token means somebody signed in
     * with a password and never finished. The UI knows that too, and the UI
     * is a suggestion: this token works against the API directly whatever the
     * browser decides to render. See lib/assuranceLevel.js for why an absent
     * claim is aal1, why an absent factor list is `unknown`, and why
     * `unknown` deliberately does not refuse here.
     */
    const level = assuranceLevelOf(token);
    const stepUp = describeStepUp({ level, factors: data.user.factors });

    if (shouldRefuse(stepUp)) {
      logger.warn('auth.step_up_required', { level });
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Enter the code from your authenticator app to finish signing in.',
        details: { code: 'mfa_required', errorCode: displayCode('mfa_required') },
      });
    }

    if (stepUp.anomaly) {
      /*
       * Only when the factor list contradicts the assurance level, which
       * cannot happen while the reading in assuranceLevel.js holds. The first
       * version of this logged whenever the list was ABSENT, and absent turned
       * out to be the ordinary state of every account that has not enrolled -
       * twelve warnings in thirty seconds from one signed-in person. A warning
       * that fires on the common path is a warning that gets filtered out,
       * taking the real one with it.
       */
      logger.warn('auth.step_up_anomaly', { level, reason: stepUp.anomaly });
    }

    req.user = { id: data.user.id, email: data.user.email };
    req.auth = { assuranceLevel: level };
    req.supabase = supabase;
    return next();
  } catch (err) {
    return next(err);
  }
}

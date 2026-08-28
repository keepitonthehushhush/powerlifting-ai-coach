import { createUserScopedClient } from '../lib/supabase.js';
import { displayCode } from '../lib/errorCodes.js';
import { logger } from '../lib/logger.js';

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

    req.user = { id: data.user.id, email: data.user.email };
    req.supabase = supabase;
    return next();
  } catch (err) {
    return next(err);
  }
}

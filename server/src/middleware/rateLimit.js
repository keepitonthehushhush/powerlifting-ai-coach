import { HttpError } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';

/**
 * Per-user rate limiting, enforced in Postgres.
 *
 * Why not in memory: serverless functions have no shared memory. An in-process
 * counter is per-instance, so the effective limit becomes (quota x number of
 * warm instances) - a number nobody controls or can predict. The state has to
 * be shared, and Postgres is already in the request path, so using it avoids
 * operating a Redis just for this.
 *
 * The quotas live in the database function, not here. `consume_rate_limit`
 * validates the bucket name against a closed whitelist and derives the counter
 * row from auth.uid(), so this middleware cannot raise its own ceiling and
 * neither can a user calling the RPC directly. See migration 0006 for the hole
 * that made that necessary.
 *
 * Fails OPEN on infrastructure error. If the rate limit check itself breaks,
 * refusing every request converts a counter problem into a total outage. The
 * failure is logged loudly instead. That tradeoff is right for a coaching app
 * bounding its own API spend; it would be wrong for something guarding a
 * password endpoint, where failing closed is the only safe direction.
 *
 * ── WHAT THIS COST ON 2026-08-27, AND WHAT IT DID NOT CHANGE ──────────────
 *
 * The deployed consume_rate_limit had lost its SECURITY DEFINER clause, so
 * every call raised 42501 - permission denied for schema private, which is
 * exactly where the counters live and where `authenticated` is deliberately
 * not allowed. This middleware did what it says: logged an error and let the
 * request through. For over a day, nothing was rate limited at all.
 *
 * The decision above is UNCHANGED and still right. What the incident showed is
 * something else: "logged loudly" is only loud if somebody is listening, and a
 * fail-open path produces a product that looks completely healthy while a
 * security control is absent. The answer is not to fail closed - it is that
 * the control has to be verified where it lives. supabase/tests asserts the
 * deployed function is SECURITY DEFINER, because that assertion is the one
 * thing that would have caught this on the day it happened.
 */
export function rateLimit(bucket) {
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const { data, error } = await req.supabase.rpc('consume_rate_limit', { p_bucket: bucket });

      if (error) {
        logger.error('ratelimit.check_failed', {
          userId: req.user?.id,
          bucket,
          code: error.code,
          message: error.message,
        });
        return next();
      }

      // The function returns a single-row table.
      const result = Array.isArray(data) ? data[0] : data;
      if (!result) return next();

      const { allowed, used, quota, resets_at: resetsAt } = result;
      const resetSeconds = Math.max(0, Math.ceil((new Date(resetsAt).getTime() - Date.now()) / 1000));

      // Standard headers so a client can back off intelligently rather than
      // discovering the limit by being refused.
      res.set({
        'RateLimit-Limit': String(quota),
        'RateLimit-Remaining': String(Math.max(0, quota - used)),
        'RateLimit-Reset': String(resetSeconds),
      });

      if (!allowed) {
        res.set('Retry-After', String(resetSeconds));
        logger.warn('ratelimit.exceeded', { userId: req.user?.id, bucket, used, quota });

        throw new HttpError(
          429,
          `You have reached the limit of ${quota} requests for this window. ` +
            `It resets in ${Math.ceil(resetSeconds / 60)} minute(s).`
        );
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

import { createAnonymousClient } from './supabase.js';
import { logger } from './logger.js';

/**
 * Whether the database is actually answering, memoized.
 *
 * ── THE HOLE THIS FILLS ───────────────────────────────────────────────────
 *
 * /api/health read environment variables and nothing else, so it answered
 * `status: "ok"` whether or not the database existed. That is the failure this
 * project keeps finding in its own checks - a control that answers confidently
 * without looking - and here it had a specific, likely trigger.
 *
 * Supabase pauses a FREE project after roughly seven days of low activity.
 * Data survives and it can be restored for up to a year, but until somebody
 * does, every request that touches the database fails. This app went from
 * 2026-09-04 to 2026-09-06 with no traffic at all; a quiet week is not
 * hypothetical, it is the normal state of a product that has not launched.
 *
 * In that week the daily deployment check would have reported production
 * healthy every morning, because /api/health does not need a database to say
 * "ok". The endpoint would have been green and the app would have been down.
 *
 * ── AND IT DOUBLES AS THE KEEPALIVE ───────────────────────────────────────
 *
 * Supabase counts requests to the project as activity. A health check that
 * genuinely touches the database, polled once a day by the scheduled task that
 * already exists, is therefore both the honest answer to "is it up" and the
 * thing that stops it going down. One round trip solves both, which is a
 * better trade than a cron job whose only purpose is to look busy.
 *
 * It is NOT a guarantee. Supabase does not publish the threshold beyond "a few
 * user requests each day", and the only sure fix is a paid plan. This makes a
 * pause much less likely and makes it VISIBLE within a day if it happens
 * anyway, which is the part that was missing.
 *
 * ── WHY IT IS MEMOIZED ────────────────────────────────────────────────────
 *
 * /api/health is unauthenticated - deliberately, since the maintenance page
 * polls it - so a database round trip on every request is an endpoint anybody
 * can use to make us open connections. The answer is cached for a minute, so a
 * flood costs at most one query per minute per warm instance, and a serverless
 * instance that is cold pays exactly one.
 *
 * A minute is also the right resolution for the question. Nobody needs to know
 * within seconds that the database went away; they need to know today.
 */

/** How long an answer is reused. Long enough to bound abuse, short enough to be true. */
export const DB_CHECK_TTL_MS = 60_000;

let cached = null;

/** Test seam, and used by the module's own tests to force a fresh probe. */
export function resetDatabaseReachable() {
  cached = null;
}

/**
 * @param {{now?: number}} [options]
 * @returns {Promise<'ok'|'unreachable'|'unconfigured'>}
 *   `unconfigured` is a real and expected state - a deployment with no
 *   Supabase URL or publishable key is not a broken one, it is one that has
 *   not been pointed at a database. It is distinct from `unreachable`, which
 *   means we asked and got nothing back.
 */
export async function databaseReachable({ now = Date.now() } = {}) {
  if (cached && now - cached.at < DB_CHECK_TTL_MS) return cached.status;

  let status;
  try {
    /*
     * ── THE ANON CLIENT, NOT THE ADMIN ONE ────────────────────────────────
     *
     * The first version of this read a table through supabaseAdmin(). ADR-12
     * says there is exactly one service-role client and it belongs to the
     * Stripe webhook, and billing.test.js asserts exactly one file imports it
     * with the comment "if a second importer appears, the exception has
     * stopped being an exception and the decision needs revisiting rather than
     * extending." The test was right and the first version was thrown away: a
     * liveness check is a poor reason to widen the one component that bypasses
     * RLS.
     *
     * public.database_awake() returns a constant and touches no table
     * (migration 0059), so this needs no privilege at all - and calling it
     * still proves everything the question is about: PostgREST reachable,
     * Postgres awake, project not paused.
     */
    const anon = createAnonymousClient();
    if (!anon) {
      status = 'unconfigured';
    } else {
      const { error } = await anon.rpc('database_awake');
      status = error ? 'unreachable' : 'ok';
      if (error) logger.warn('health.database_unreachable', { message: error.message });
    }
  } catch (err) {
    // A throw and an error response are the same answer to the only question
    // being asked. Never let this reject: /api/health must not 500 because the
    // database is down - saying so IS its job.
    status = 'unreachable';
    logger.warn('health.database_threw', { message: err?.message });
  }

  cached = { status, at: now };
  return status;
}

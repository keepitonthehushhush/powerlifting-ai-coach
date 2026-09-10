import { logger } from '../lib/logger.js';

/**
 * Record that this account used the app today. Once per day, at most.
 *
 * ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
 *
 * `npm run retention` measures whether athletes come back by unioning the
 * things they WRITE - a message, a logged session, a program. The most
 * ordinary use of this product writes nothing at all: open the app in the gym,
 * read the session, put the phone away, train. Every retention number was
 * therefore a floor with no known ceiling. Migration 0068 has the full
 * argument, including why the row holds a date and nothing else.
 *
 * ── IT AWAITS, AND THAT IS THE DECISION ────────────────────────────────────
 *
 * The tempting shape is fire-and-forget after next(), so no athlete ever waits
 * on telemetry. On Vercel that silently loses writes: the function can be
 * frozen the moment the response is finished, and work still pending is simply
 * not done.
 *
 * A retention log with silent holes is worse than no retention log, because it
 * looks complete. It is the same failure this codebase keeps finding - a
 * control that answers confidently without having looked - and here it would
 * be answering "they never came back" about somebody who did.
 *
 * The cost is bounded and small. requireAuth already makes a network round
 * trip to the auth server on every single request; this adds one insert to the
 * same region, and only on the first request an instance serves for a given
 * account on a given day. Everything after that is a Set lookup.
 *
 * ── AND IT NEVER COSTS ANYBODY THE PAGE THEY ASKED FOR ─────────────────────
 *
 * Same rule as the two funnel stamps: whatever happens here, next() is called.
 * A telemetry write that can 500 a request is a worse bug than the blind spot
 * it was added to fix.
 */

/**
 * Accounts already recorded today, by this instance.
 *
 * Serverless instances are recycled constantly, so this is a courtesy rather
 * than a guarantee - a cold start pays the insert again and the primary key
 * absorbs it. Keyed by day as well as account so yesterday's entries simply
 * stop matching; the size cap is what stops a long-lived instance growing this
 * without bound.
 */
const recorded = new Set();
const MAX_REMEMBERED = 5000;

/**
 * Set once, for the life of the instance, when the table is not there.
 *
 * The hazard is a deploy that lands before its migration - the same ordering
 * trap app.js documents for the monthly rate-limit bucket. Without this, every
 * request in that window pays a failing round trip and writes a log line, which
 * is how a missing migration turns into a latency incident and a wall of noise
 * instead of one line saying what is wrong.
 */
let tableMissing = false;

/** PostgREST's "I have no such table", and Postgres's underlying one. */
const MISSING_TABLE = new Set(['PGRST205', 'PGRST106', '42P01']);

/** Exported for tests: an instance's memory is not global state a test may keep. */
export function _resetActivityMemo() {
  recorded.clear();
  tableMissing = false;
}

export async function recordActivityDay(req, _res, next) {
  const userId = req.user?.id;
  // No user means requireAuth did not run or did not pass. Nothing to record,
  // and nothing to complain about.
  if (!userId || !req.supabase || tableMissing) return next();

  // UTC, matching the column's `current_date` default. The server picks the
  // day rather than the browser: see migration 0068 for why a spoofable client
  // date buys nothing here.
  const day = new Date().toISOString().slice(0, 10);
  const key = `${userId}:${day}`;
  if (recorded.has(key)) return next();

  try {
    /*
     * Through the caller's own RLS-scoped client, so the row can only ever be
     * their own - the policy in 0068 is what enforces that, not this line.
     *
     * ignoreDuplicates is the whole point: two tabs, or two instances, race on
     * the first request of the day and exactly one wins. Without it the loser
     * gets a 23505 that reads like a failure and is in fact the correct
     * outcome.
     */
    const { error } = await req.supabase
      .from('activity_days')
      .upsert({ user_id: userId, day }, { onConflict: 'user_id,day', ignoreDuplicates: true });

    if (error) {
      if (MISSING_TABLE.has(error.code)) {
        tableMissing = true;
        logger.error('activity.table_missing', {
          code: error.code,
          effect: 'retention days are not being recorded on this instance - apply migration 0068',
        });
      } else {
        // No user id in the line. Which account was here is the thing this
        // table exists to hold; it is not something the log needs a second
        // copy of, and error lines travel further than rows do.
        logger.warn('activity.not_recorded', { code: error.code ?? null });
      }
      return next();
    }

    if (recorded.size >= MAX_REMEMBERED) recorded.clear();
    recorded.add(key);
  } catch (err) {
    logger.warn('activity.not_recorded', { code: err?.code ?? null });
  }

  return next();
}

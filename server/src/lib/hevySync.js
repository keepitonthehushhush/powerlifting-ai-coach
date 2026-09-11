/**
 * How much of somebody's history to fetch, and when to stop.
 *
 * ── WHY THE BACKFILL NEEDS A PLAN AT ALL ───────────────────────────────────
 *
 * Their API pages at a MAXIMUM OF TEN ITEMS. That single number shapes
 * everything here. A lifter three years into logging has perhaps four hundred
 * workouts, which is forty round trips, against a rate limit that is not
 * documented anywhere.
 *
 * A naive `while (more) fetch()` has three failure modes and this codebase has
 * shipped versions of all three before: it runs past the function's time limit
 * and is killed halfway with nothing recorded; it hammers an undocumented
 * limit and gets the athlete's key throttled; or it restarts from page one
 * every time and never finishes at all.
 *
 * So: bounded per invocation, resumable across invocations, and terminating.
 * Pure functions, because every one of those properties is testable without a
 * network and none of them can be checked by reading the code.
 */

/**
 * How far back the first import reaches.
 *
 * ── WHY NINETY DAYS AND NOT EVERYTHING ─────────────────────────────────────
 *
 * Not squeamishness about volume - it is what the rules actually read.
 * `summariseLift()` walks a lift's history to find the current working weight,
 * the consecutive misses at that weight, and the resets. `compareToProgram()`
 * windows on the life of the active program. `recommendPhase()` reads the
 * prescriptions those produce. None of them reach back further than the last
 * few training blocks.
 *
 * Thirteen weeks is three or four blocks. Fetching a fifth year of somebody's
 * squats costs forty requests to produce numbers nothing consults, and it is
 * forty more chances to be rate limited before the recent workouts - the ones
 * that decide tomorrow's session - are in.
 *
 * Newest first, so the most useful workouts land in the first request and the
 * product is useful before the backfill has finished.
 */
export const BACKFILL_DAYS = 90;

/** Their maximum. Sending more is rejected; sending less wastes a round trip. */
export const PAGE_SIZE = 10;

/**
 * Pages per invocation.
 *
 * Twelve pages is a hundred and twenty workouts - more than ninety days holds
 * for almost anybody - so the common case finishes in one pass. The cap exists
 * for the athlete who trains twice a day and for the case where the window is
 * widened later: the function's ceiling is five minutes, and a request killed
 * at the limit records nothing, so the bound has to be well under it rather
 * than exactly at it.
 */
export const MAX_PAGES_PER_RUN = 12;

/** Milliseconds in a day, named because 86400000 in an expression reads as noise. */
const DAY = 86_400_000;

/**
 * The oldest workout the first import will keep.
 * @param {number} now epoch ms
 */
export function backfillFloor(now, days = BACKFILL_DAYS) {
  return new Date(now - days * DAY).toISOString();
}

/**
 * What to do next, given where the last run stopped.
 *
 * @param {object} state from the stored connection
 * @param {number} now epoch ms
 * @returns {{mode:'backfill'|'incremental', page:number, since:string|null, pageSize:number}}
 *
 * ── BACKFILL FIRST, ALWAYS ─────────────────────────────────────────────────
 *
 * `synced_through` is only set once the backfill is finished, and this refuses
 * to move to incremental before then. An incremental sync that starts while
 * page seven of twelve is still missing would set a high-water mark past a
 * hole, and `?since=` never looks backwards - so those workouts would be
 * missing permanently, with everything downstream quietly computing on a
 * history that has a month cut out of it.
 */
export function nextStep(state = {}, now = Date.now()) {
  if (!state.backfill_done) {
    return {
      mode: 'backfill',
      page: Number.isInteger(state.backfill_page) && state.backfill_page > 0 ? state.backfill_page : 1,
      since: null,
      pageSize: PAGE_SIZE,
    };
  }
  return {
    mode: 'incremental',
    page: 1,
    /*
     * Overlapped by a minute rather than resumed exactly.
     *
     * Their clock and ours are not the same clock, and a workout saved in the
     * same second the cursor was written can fall on either side of a strict
     * comparison. Re-reading a minute of events costs one request and is
     * absorbed by the idempotency key; missing one loses a session silently.
     * Cheap insurance against an off-by-one nobody would ever see.
     */
    since: state.synced_through
      ? new Date(Date.parse(state.synced_through) - 60_000).toISOString()
      : backfillFloor(now),
    pageSize: PAGE_SIZE,
  };
}

/**
 * Has the backfill reached the end, and where does it resume?
 *
 * @param {object} input
 * @param {number} input.page the page just fetched
 * @param {number} input.pagesFetched how many this invocation has done
 * @param {Array} input.workouts what came back, newest first
 * @param {number|null} input.pageCount what they said the total was
 * @param {string} input.floor the oldest date we keep
 * @returns {{done:boolean, nextPage:number|null, reason:string}}
 *
 * ── FOUR WAYS TO STOP, AND ONLY ONE OF THEM IS "FINISHED" ──────────────────
 *
 * Every one of them has to be a stop, or the loop does not terminate. The
 * reason travels with the answer because "we reached the end of their history"
 * and "we hit our own page cap and will carry on next time" look identical
 * from outside and mean opposite things about whether to keep going.
 */
export function backfillProgress({ page, pagesFetched, workouts, pageCount, floor }) {
  const rows = Array.isArray(workouts) ? workouts : [];

  if (rows.length === 0) {
    return { done: true, nextPage: null, reason: 'no_more_workouts' };
  }

  // Newest first, so the LAST row of a page is the oldest thing on it. Once
  // that is past the floor, every page after this one is older still.
  const oldest = rows[rows.length - 1]?.start_time;
  if (typeof oldest === 'string' && oldest < floor) {
    return { done: true, nextPage: null, reason: 'reached_window' };
  }

  if (Number.isInteger(pageCount) && page >= pageCount) {
    return { done: true, nextPage: null, reason: 'last_page' };
  }

  // A short page means there is nothing after it, whatever the count says.
  // Their page_count has been observed to disagree with reality in other
  // paginated APIs, and trusting it alone is how a loop runs past the end.
  if (rows.length < PAGE_SIZE) {
    return { done: true, nextPage: null, reason: 'short_page' };
  }

  if (pagesFetched >= MAX_PAGES_PER_RUN) {
    // NOT done. The cursor advances so the next invocation resumes here, and
    // this is the one branch where `done` being wrong would lose history.
    return { done: false, nextPage: page + 1, reason: 'page_budget_spent' };
  }

  return { done: false, nextPage: page + 1, reason: 'continue' };
}

/**
 * Keep only what falls inside the window.
 *
 * The last page of a backfill straddles the floor: half of it is inside the
 * window and half is older. Writing the whole page would put workouts from
 * before the window into the log, which is not harmful but makes the window a
 * lie - and a window that is approximately ninety days is a window nobody can
 * reason about when a number looks wrong.
 */
export function withinWindow(workouts, floor) {
  return (Array.isArray(workouts) ? workouts : []).filter(
    (w) => typeof w?.start_time === 'string' && w.start_time >= floor
  );
}

/**
 * The high-water mark to store after an incremental pass.
 *
 * The NEWEST `updated_at` actually seen, never `Date.now()`. Using our own
 * clock would step the cursor past events that happened during the request and
 * had not yet been returned - and `?since=` never looks backwards, so those
 * events would be lost rather than delayed.
 */
export function highWaterMark(events, previous = null) {
  let mark = previous;
  for (const event of Array.isArray(events) ? events : []) {
    const at = event?.workout?.updated_at ?? event?.updated_at ?? null;
    if (typeof at !== 'string') continue;
    if (mark === null || at > mark) mark = at;
  }
  return mark;
}

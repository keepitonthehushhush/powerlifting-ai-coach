/**
 * How much of somebody's history to fetch, and when to stop.
 *
 * ── WHY THE SYNC NEEDS A PLAN AT ALL ───────────────────────────────────────
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
 *
 * ── ONE ENDPOINT, NOT TWO ──────────────────────────────────────────────────
 *
 * Both phases read `GET /v1/workouts/events`. The first draft backfilled from
 * `GET /v1/workouts` and stopped once a page ran past the ninety-day floor,
 * which requires that endpoint to return newest first.
 *
 * It does not say that it does. Their published OpenAPI document describes it
 * as "Get a paginated list of workouts" and documents no ordering at all,
 * while `/workouts/events` says, in the specification itself, "Events are
 * ordered from newest to oldest". An assumption that happens to hold on the
 * account you tested against is not a contract, and the failure it buys is
 * silent: read oldest-first, and the first page is already past the floor, so
 * the import stops having written nothing and reports success.
 *
 * `/workouts/events` also takes an arbitrary `since`, and returns deletions as
 * well as updates. So the first import is just a sync whose `since` is ninety
 * days ago, and there is one code path to get right instead of two.
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
 * product is useful before the import has finished.
 */
export const BACKFILL_DAYS = 90;

/**
 * Their maximum, which their own parameter description states: "Number of
 * items on the requested page (Max 10)". The default is 5. Sending more is
 * rejected; sending less wastes a round trip.
 */
export const PAGE_SIZE = 10;

/**
 * Pages per invocation.
 *
 * Twelve pages is a hundred and twenty events - more than ninety days holds
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
 * How far the cursor is rewound before an incremental pass.
 *
 * Their clock and ours are not the same clock, and a workout saved in the same
 * second the cursor was written can fall on either side of a strict
 * comparison. Re-reading a minute of events costs one request and is absorbed
 * by the idempotency key; missing one loses a session silently.
 */
const OVERLAP_MS = 60_000;

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
 * @returns {{mode:'backfill'|'incremental', page:number, since:string, pageSize:number}}
 *
 * ── BACKFILL FIRST, ALWAYS ─────────────────────────────────────────────────
 *
 * `synced_through` is only honored once the backfill is finished, and this
 * refuses to move to incremental before then. An incremental sync that starts
 * while page seven of twelve is still missing would set a high-water mark past
 * a hole, and `?since=` never looks backwards - so those workouts would be
 * missing permanently, with everything downstream quietly computing on a
 * history that has a month cut out of it.
 *
 * ── WHY THE BACKFILL FLOOR IS RECOMPUTED EVERY RUN ─────────────────────────
 *
 * It slides forward by however long it has been since the last pass, which
 * means a resumed import asks for a slightly smaller window than the one it
 * started. That cannot skip anything, and the reason is worth writing down:
 * the stream is ordered newest first, so the window only ever loses items at
 * the OLD end, and positions are counted from the new end. Items shift toward
 * later pages, never toward earlier ones. A resumed page can therefore repeat
 * work already done - absorbed by the idempotency key - and can never step
 * over work that has not been done.
 */
export function nextStep(state = {}, now = Date.now()) {
  const page = Number.isInteger(state.sync_page) && state.sync_page > 0 ? state.sync_page : 1;

  if (!state.backfill_done) {
    return { mode: 'backfill', page, since: backfillFloor(now), pageSize: PAGE_SIZE };
  }

  return {
    mode: 'incremental',
    page,
    since: state.synced_through
      ? new Date(Date.parse(state.synced_through) - OVERLAP_MS).toISOString()
      : backfillFloor(now),
    pageSize: PAGE_SIZE,
  };
}

/**
 * Has this pass reached the end of the stream, and where does it resume?
 *
 * @param {object} input
 * @param {number} input.page the page just fetched
 * @param {number} input.pagesFetched how many this invocation has done
 * @param {Array} input.events what came back, newest first
 * @param {number|null} input.pageCount what they said the total was
 * @returns {{done:boolean, nextPage:number|null, reason:string}}
 *
 * ── FOUR WAYS TO STOP, AND ONLY ONE OF THEM IS "FINISHED" ──────────────────
 *
 * Every one of them has to be a stop, or the loop does not terminate. The
 * reason travels with the answer because "we reached the end of their history"
 * and "we hit our own page cap and will carry on next time" look identical
 * from outside and mean opposite things about whether to keep going.
 *
 * ── WHY THERE IS NO "WE WALKED PAST THE WINDOW" STOP ───────────────────────
 *
 * There was one, and it was wrong once the stream became the event stream.
 * It compared the oldest `start_time` on the page against the floor, which is
 * sound only if the pages are ordered by when the workout HAPPENED. Events are
 * ordered by when they were LAST TOUCHED. An athlete who fixes a typo in a
 * workout from last year puts a two-year-old `start_time` on page two of a
 * ninety-day import, and that stop would have ended the import there - every
 * page after it unread, and the run reporting success.
 *
 * The window is enforced in the two places where it is actually true: `since`
 * bounds the stream on their side, and `withinWindow()` filters what gets
 * written on ours.
 */
export function pageProgress({ page, pagesFetched, events, pageCount }) {
  const rows = Array.isArray(events) ? events : [];

  if (rows.length === 0) {
    return { done: true, nextPage: null, reason: 'no_more_events' };
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
 * Updates and deletions, separated.
 *
 * Their event stream carries two shapes in one array: `{type:'updated',
 * workout}` and `{type:'deleted', id, deleted_at}`. Anything else is a type
 * this code has never seen, and it is dropped rather than guessed at - a third
 * event type treated as an update would write a session out of a payload
 * nobody has looked at.
 */
export function partitionEvents(events) {
  const updated = [];
  const deleted = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'updated' && event.workout) updated.push(event.workout);
    else if (event?.type === 'deleted' && typeof event.id === 'string') deleted.push(event.id);
  }
  return { updated, deleted };
}

/**
 * Keep only what falls inside the window.
 *
 * The last page of an import straddles the floor: half of it is inside the
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
 * The high-water mark to store after a pass.
 *
 * The NEWEST `updated_at` actually seen, never `Date.now()`. Using our own
 * clock would step the cursor past events that happened during the request and
 * had not yet been returned - and `?since=` never looks backwards, so those
 * events would be lost rather than delayed.
 */
export function highWaterMark(events, previous = null) {
  let mark = previous;
  for (const event of Array.isArray(events) ? events : []) {
    const at = event?.workout?.updated_at ?? event?.deleted_at ?? event?.updated_at ?? null;
    if (typeof at !== 'string') continue;
    if (mark === null || at > mark) mark = at;
  }
  return mark;
}

/**
 * The mark to actually store, which is not the same question.
 *
 * ── A PARTIAL PASS MUST NOT MOVE THE CURSOR ────────────────────────────────
 *
 * The pages this run did not reach are the OLDEST ones, because the stream is
 * newest first. The mark is the NEWEST thing seen. So storing the mark after a
 * run that stopped on its page budget would set the cursor to the newest event
 * in the stream while pages of older events remain unread - and `?since=`
 * never looks backwards, so they are not delayed, they are gone.
 *
 * This is the same hole the backfill cursor exists to prevent, in the phase
 * nobody expected to need it, and it is why `sync_page` is not called
 * `backfill_page` any more (migration 0071).
 */
export function markToStore({ done, events, previous = null }) {
  return done ? highWaterMark(events, previous) : previous;
}

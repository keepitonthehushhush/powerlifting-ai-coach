/**
 * The arithmetic behind `npm run retention`, with no database and no printing.
 *
 * ── WHY THIS IS A SEPARATE FILE ────────────────────────────────────────────
 *
 * Because a retention number is the kind of thing people quote in rooms where
 * nobody can see the code, and every mistake this module can make produces a
 * plausible number rather than an error. funnel.mjs shipped exactly that: a
 * filter that named two accounts as a routing bug, printed with total
 * confidence, computed from a condition that could not distinguish "did not"
 * from "cannot say". It was tested only by reading its source for the right
 * strings, and the right strings were all present.
 *
 * So the parts that can be wrong quietly live here, where a test can hand them
 * a fixture and check the answer.
 */

export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

/**
 * The return curve, in elapsed time rather than calendar days.
 *
 * ── WHY NOT DAYS ───────────────────────────────────────────────────────────
 *
 * Nothing in this system knows what timezone anybody is in. A lifter training
 * at nine in the evening in California is stamped the FOLLOWING calendar day
 * in UTC, so one Tuesday evening becomes two "active days" and a report built
 * on calendar arithmetic announces a return visit that did not happen.
 *
 * "Was there anything between 24 and 168 hours after this account signed up"
 * means the same thing in every timezone there is, so that is what the curve
 * asks. Calendar days are still computed, for texture, and are labeled UTC
 * wherever they are printed.
 */
export const WINDOWS = [
  { label: 'came back at all (24h+)', from: DAY, to: Infinity },
  { label: 'active in week 1 (1-7d)', from: DAY, to: 7 * DAY },
  { label: 'active in week 2 (8-14d)', from: 7 * DAY, to: 14 * DAY },
  { label: 'active in week 3 (15-21d)', from: 14 * DAY, to: 21 * DAY },
  { label: 'active in week 4 (22-28d)', from: 21 * DAY, to: 28 * DAY },
];

/**
 * Collapse a pile of timestamps into the distinct moments somebody was here.
 *
 * ── ONE VISIT IS NOT THREE EVENTS ──────────────────────────────────────────
 *
 * An athlete who finishes a workout, logs it, and tells the coach about it
 * does three writes into three tables inside a minute. Counting rows makes
 * that look like three visits, and "visits per week" is precisely the number
 * somebody would quote. Timestamps closer together than the grain are one
 * moment.
 *
 * The grain is thirty minutes: long enough that a logged session and the
 * conversation about it are one visit, short enough that a morning session
 * and an evening one are two. It is a judgment, so it is a parameter.
 */
export function distinctVisits(instants, grain = 30 * 60 * 1000) {
  const sorted = [...instants].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const visits = [];
  for (const t of sorted) {
    if (visits.length === 0 || t - visits[visits.length - 1] >= grain) visits.push(t);
  }
  return visits;
}

/** UTC calendar days touched. Texture, not evidence - see WINDOWS. */
export function calendarDays(instants) {
  return new Set(instants.filter((t) => Number.isFinite(t)).map((t) => new Date(t).toISOString().slice(0, 10)))
    .size;
}

/**
 * Is this account old enough for the question to be fair?
 *
 * ── THE DENOMINATOR IS THE WHOLE REPORT ────────────────────────────────────
 *
 * An account created yesterday has not failed to reach week two. Putting it in
 * the week-two denominator is how a young product persuades itself that nobody
 * stays - and it is the same false red funnel.mjs had to retract, where an
 * instrument's start date was printed as a person's behavior.
 *
 * An open-ended window (`to: Infinity`) closes as soon as it opens: once 24
 * hours have passed, "did they ever come back" is answerable and stays
 * answerable. A bounded window is only fair once its far edge is behind us.
 */
export function eligibleFor(window, joinedAt, now) {
  const closes = window.to === Infinity ? window.from : window.to;
  return now - joinedAt >= closes;
}

/** Did anything happen inside this window, measured from this account's own signup? */
export function activeIn(window, joinedAt, instants) {
  return instants.some((t) => {
    const elapsed = t - joinedAt;
    return elapsed >= window.from && elapsed < window.to;
  });
}

/**
 * The whole curve.
 *
 * `accounts` is [{ id, joinedAt, instants }]. Returns one row per window with
 * the numerator, the denominator, and who is in it - never a bare percentage,
 * because a bare percentage over three accounts is a sentence with no subject.
 */
export function curve(accounts, now, windows = WINDOWS) {
  return windows.map((window) => {
    const eligible = accounts.filter((a) => eligibleFor(window, a.joinedAt, now));
    const active = eligible.filter((a) => activeIn(window, a.joinedAt, a.instants));
    return {
      label: window.label,
      eligible: eligible.length,
      active: active.length,
      who: active.map((a) => a.id),
      /** Null rather than 0. Nobody old enough is not the same as nobody came back. */
      percent: eligible.length === 0 ? null : Math.round((active.length / eligible.length) * 100),
    };
  });
}

/**
 * Accounts that are, on their own, most of the activity in the database.
 *
 * ── WHEN ONE ROW IS THE ENTIRE FINDING ─────────────────────────────────────
 *
 * At this scale one enthusiastic account - very plausibly the person who wrote
 * the app - can be the overwhelming majority of every number above, and the
 * curve is then a fact about one person rendered as a fact about a product.
 *
 * This deliberately does NOT exclude anybody. Nothing in these tables marks an
 * account as a test account, and a script that guessed would be inventing its
 * own denominator. It measures the concentration and reports it, which is the
 * part a reader cannot work out from a table of percentages.
 */
export function concentration(accounts, threshold = 0.5) {
  const total = accounts.reduce((sum, a) => sum + a.instants.length, 0);
  if (total === 0) return [];
  return accounts
    .filter((a) => a.instants.length > total * threshold)
    .map((a) => ({ id: a.id, events: a.instants.length, total, percent: Math.round((a.instants.length / total) * 100) }));
}

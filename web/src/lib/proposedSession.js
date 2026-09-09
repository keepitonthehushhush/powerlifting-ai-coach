/**
 * Stamps a proposal with the day it arrived, when the coach did not name one.
 *
 * ── WHY THE BROWSER DECIDES THE DAY ─────────────────────────────────────────
 *
 * The server is in UTC and the athlete is not. Somebody in California saying
 * "hit a triple today" at nine in the evening is already on tomorrow by UTC,
 * and every evening session would be filed a day late, forever, with nothing
 * looking wrong. The browser is the only participant that knows what day it is
 * where they are standing.
 *
 * ── AND WHY ON ARRIVAL RATHER THAN ON THE TAP ───────────────────────────────
 *
 * The server's duplicate guard is a hash of the session, and the day is part
 * of it. Computing the day at confirm time means a first attempt at 23:59 and
 * its retry at 00:01 hash differently, and the retry writes a second row -
 * defeating the guard on exactly the path it exists for. Deciding once, when
 * the card appears, makes every attempt at that card the same workout.
 */
export function withLocalDate(proposal) {
  if (!proposal?.session) return null;
  if (proposal.session.date) return proposal;
  const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
  return { ...proposal, session: { ...proposal.session, date: localDate } };
}

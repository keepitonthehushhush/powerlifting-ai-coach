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

/**
 * Which proposal is on screen after a reply lands.
 *
 * ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────
 *
 * The card used to be replaced unconditionally on every reply, which meant a
 * reply carrying no block DESTROYED an unanswered one. The path is the most
 * natural conversation there is:
 *
 *   athlete   "hit 245 for a triple today, felt heavy"
 *   coach     coaching, plus a session_log block   -> the card appears
 *   athlete   "should I keep going up?"            -> types instead of tapping
 *   coach     an answer, no block                  -> THE CARD IS GONE
 *
 * Nothing was logged, nothing failed, and nothing anywhere recorded that an
 * offer had been made and thrown away. Worse, the prompt tells the coach never
 * to offer the same session twice - a rule written for an athlete who tapped
 * no - so silence was read as a decline and the offer never came back.
 *
 * In sixteen days this product wrote one progress_logs row against three
 * programs. This is the most likely reason, and it is the only one that could
 * be established from the code rather than guessed at.
 *
 * ── SO AN OFFER SURVIVES UNTIL IT IS ANSWERED ──────────────────────────────
 *
 * Tapping yes clears it. Tapping no clears it - that is an answer and it is
 * respected. A NEW proposal replaces it, because two cards is two things to
 * answer. Continuing the conversation is none of those things.
 *
 * The staleness that allows is bounded and harmless. The card is component
 * state, so it does not survive a reload; the date was stamped when it
 * arrived, so tapping it tomorrow still files it under the day the athlete
 * described; and the server's content hash absorbs a double tap.
 */
export function nextProposal(current, arriving) {
  return withLocalDate(arriving) ?? current ?? null;
}

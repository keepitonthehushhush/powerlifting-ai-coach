/**
 * What a brand-new athlete is offered instead of a blank box.
 *
 * ── THE PROBLEM THIS EXISTS TO FIX ────────────────────────────────────────
 *
 * On 2026-09-06 the funnel said something worth acting on: the two newest
 * signups completed the ENTIRE intake - terms, AI processing, health-data and
 * leaderboard consent, date of birth, experience level, goal and units - and
 * then sent zero messages and never came back. Nothing on the server refused
 * them. Consent was current, the paywall was off, clearance gates the program
 * block rather than the conversation.
 *
 * What they were shown was "Say hello and Coach Diaz will take it from there",
 * a medical disclaimer, and a composer whose placeholder read "How did that
 * session go?" - a question about a session they had never had. Somebody who
 * has just spent five minutes telling the app how long they have trained and
 * what they are training for is then asked to introduce themselves from
 * scratch, to a coach they have no reason to trust yet.
 *
 * That cannot be proven to be why they left; the client-failure reporting that
 * would distinguish "looked and left" from "the send failed" shipped two days
 * after the second of them. It can be made not to be the reason.
 *
 * ── WHY THE SERVER DERIVES KEYS AND NOT SENTENCES ─────────────────────────
 *
 * Two constraints meet here.
 *
 * The copy has to live in the locale files, because that is where the
 * American-English guard and the Mexican-Spanish guard can see it, and because
 * a Spanish-speaking athlete gets openers in Spanish or the feature is worse
 * than nothing for them. So the server cannot send text.
 *
 * And the profile must not travel to a page that does not need it. The chat
 * screen has no business holding somebody's injuries or restrictions, and
 * "not sent anywhere it does not need to go" is a rule about health data with
 * teeth. So the server cannot send the profile either.
 *
 * Keys satisfy both: the derivation happens once, here, where it is tested,
 * and what crosses the wire is a list of short identifiers with no personal
 * content in them at all. The client renders `t(key)`.
 *
 * ── AND WHY NOTHING HERE MENTIONS BODY COMPOSITION ────────────────────────
 *
 * `body_composition` is a legitimate goal and it is the one goal whose obvious
 * opener - a sentence about weight - this product will not put on a screen
 * unprompted. The prompt carries disordered-eating safeguards for good
 * reasons, and an opener the athlete did not ask for is the app raising the
 * subject rather than answering it. That goal gets the same training-first
 * opener as everybody else, and the athlete can raise the rest themselves.
 */

/**
 * Experience levels, in the order the intake offers them, plus the three
 * legacy values migration 0019 kept legal for rows saved before it. Legacy
 * rows are real people and must not fall through to nothing.
 */
const RETURNING = new Set(['return_from_layoff']);
const BEGINNER = new Set(['never_lifted', 'learning_lifts', 'under_6_months', 'never_trained']);

/** The most openers anybody is shown. */
export const MAX_STARTERS = 3;

/**
 * @param {{experience_level?: string|null, goal?: string|null}|null} profile
 * @returns {string[]} opener ids, most-relevant first, at most MAX_STARTERS.
 *          The client renders `chat.starters.<id>` from its own catalogue.
 */
export function startersFor(profile) {
  const experience = profile?.experience_level ?? null;
  const goal = profile?.goal ?? null;

  const starters = [];

  /*
   * The first opener is the one thing this person is most likely to want, and
   * it is chosen by goal rather than by experience because the goal is what
   * they told us they are here for. Experience decides the SECOND one, which
   * is about where they are starting from.
   */
  if (goal === 'first_meet' || goal === 'meet_prep') starters.push('meet');
  else if (goal === 'return_from_layoff' || RETURNING.has(experience)) starters.push('comingBack');
  else starters.push('firstProgram');

  /*
   * Somebody who has trained before has numbers, and handing them over is the
   * single most useful first message they can send - it is what turns the
   * first reply from questions into a program. Somebody who has not lifted has
   * no numbers, and asking for them is the fastest way to make a beginner feel
   * they are in the wrong place.
   */
  if (BEGINNER.has(experience)) starters.push('neverLifted');
  else starters.push('currentNumbers');

  // Always last, always offered: the question somebody asks when they do not
  // trust the thing yet, which is the honest state of a first visit.
  starters.push('howItWorks');

  return starters.slice(0, MAX_STARTERS);
}

/**
 * How much mobility and stretching work this athlete wants programmed.
 *
 * ── THE COMPLAINT THIS EXISTS FOR ─────────────────────────────────────────
 *
 * "It does not provide the stretches."
 *
 * The coach was obeying its instructions. The warm-up section says "do not
 * attach a generic stretching routine to every session: a list nobody does is
 * worse than a short one they do" - which is right for most people and leaves
 * the athlete who wants that list with no way to ask for it that outlives the
 * conversation window. They ask again, and again, and then stop asking.
 *
 * ── WHAT SEPARATES THIS FROM nutritionDetail.js ───────────────────────────
 *
 * That one can only NARROW: its top level is what the product already does,
 * and a wider one would cross a scope-of-practice line. This one WIDENS -
 * `full` turns on a block the prompt otherwise suppresses.
 *
 * So the safety argument cannot be "it only ever removes", and it is not.
 * Programming range-of-motion work is inside a strength coach's scope. What is
 * bounded here is what a level may CLAIM, and that bound is the evidence:
 *
 *   * Static stretching BEFORE lifting measurably reduces force - it ranks
 *     last of every warm-up method tested for explosive strength. No level
 *     moves it before the session.
 *   * Active cool-downs are "largely ineffective for improving most
 *     psychophysiological markers of post-exercise recovery" (Van Hooren and
 *     Peake). No level may sell this as recovery.
 *   * The protection people expect from stretching comes from warm-ups and
 *     from getting stronger through full range, not from lengthening tissue.
 *     No level may sell this as injury prevention.
 *
 * What survives is the honest claim, and it is a real one: it improves range
 * of motion, and range of motion is worth having in a squat.
 *
 * mobilityDetail.test.js reads every level's text and fails on a recovery or
 * injury-prevention claim, because a rule about what copy may promise is a
 * rule that gets edited by somebody in a hurry.
 *
 * ── WHY `brief` IS THE DEFAULT AND NOT `full` ─────────────────────────────
 *
 * Partly because it is what every athlete received before this column existed,
 * and adding a setting that also changes behavior for everybody is two changes
 * that can only be debugged as one.
 *
 * And partly on the evidence: resistance training through a full range
 * improves flexibility about as well as stretching does (g = 0.63 against
 * stretching's ES = 0.08, p = 0.79). Most athletes are already getting most of
 * this from the lifting. `full` is for the ones who want it anyway, which is a
 * perfectly good reason and not one that needs a health claim attached.
 *
 * ── WHAT SITS ABOVE ALL THREE LEVELS ──────────────────────────────────────
 *
 * The undiagnosed-injury rule, which forbids suggesting stretches, mobility
 * work, corrective exercises or rehab movements to an athlete who has reported
 * a symptom and has not been cleared. That is a clinical call. `full` is a
 * preference about how a HEALTHY athlete's training is written; it is not
 * consent to be treated, and it never unlocks that section.
 */

/**
 * The levels, least first. Order is meaningful: `full` says MORE than `brief`,
 * which is the asymmetry this file exists to reason about carefully.
 */
export const MOBILITY_DETAIL_LEVELS = Object.freeze(['off', 'brief', 'full']);

/** What every athlete received before this column existed. */
export const DEFAULT_MOBILITY_DETAIL = 'brief';

/**
 * The stored value, or the default for anything this build does not recognize.
 *
 * The failure direction is deliberate. An unreadable value resolves to `brief`,
 * which is the MIDDLE level rather than the widest - so a build older than the
 * value can never accidentally start prescribing a block the athlete did not
 * ask for, and can never silently withhold the targeted drills that were
 * always part of the product. Unlike nutrition, where the default is the
 * widest, the safe fallback here is the status quo.
 */
export function resolveMobilityDetail(value) {
  return MOBILITY_DETAIL_LEVELS.includes(value) ? value : DEFAULT_MOBILITY_DETAIL;
}

/**
 * The per-turn directive, or null when there is nothing to say.
 *
 * Null at the default on purpose, the same as nutrition: the warm-up section
 * already describes that behavior, so a directive restating it would spend
 * tokens on every turn of every conversation to change nothing.
 */
export function directiveFor(level) {
  switch (resolveMobilityDetail(level)) {
    case 'off':
      return `- MOBILITY WORK IS OFF FOR THIS ATHLETE. They have turned it off on their account
  page. Do not program stretching, mobility drills or range-of-motion work, and do not
  add one as "just a couple of minutes" at the end of a session. The general and ramped
  warm-up is NOT mobility work and still applies in full - never cut that.
  If they ask a direct question about stretching, answer it, and tell them once that
  they can turn mobility work back on in their account settings. Do not ask why it is
  off and do not try to talk them out of it.`;
    case 'full':
      return `- THIS ATHLETE HAS ASKED FOR THE FULL MOBILITY BLOCK. When you write a training
  session, finish it with a short range-of-motion block - three to five movements, a hold
  or a rep count for each, aimed at the ranges that session actually used. Name them
  specifically rather than saying "stretch your hips".
  Placement is not negotiable: it goes AFTER the training, never before. Held stretches
  before lifting reduce force production, and that is true whatever the setting says.
  SAY WHAT IT IS FOR AND NOTHING MORE. It is for range of motion. Do not tell them it
  speeds recovery, reduces soreness, flushes anything, or prevents injury - the evidence
  does not support any of those and this product does not sell guarantees it cannot keep.
  "This keeps the range you need for a deep squat" is the register.
  This setting does NOT apply to an athlete who has reported a symptom that has not been
  cleared. That rule is above this one and stays where it is: no stretches, no mobility
  work, no corrective movements, whatever this setting says.`;
    default:
      return null;
  }
}

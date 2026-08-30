/**
 * Getting ready to lift, and what the evidence actually supports.
 *
 * ── THE REQUEST, AND WHY IT IS NOT WHAT GETS BUILT ────────────────────────
 *
 * The ask was "stretching before the exercises, to avoid future injuries".
 * That is the most common belief in the gym and both halves of it are wrong.
 *
 * 1. Static stretching before lifting REDUCES force. In a network
 *    meta-analysis of warm-up methods for lower-limb explosive strength,
 *    static stretching ranked last of everything tested (SUCRA 15.6%) and had
 *    a significant negative effect on sprint time; dynamic stretching ranked
 *    first (SUCRA 91.1%). A separate meta-analysis puts static stretching at
 *    roughly a 1.6% decrease in countermovement jump against a 1.8% increase
 *    for dynamic. Prolonged holds (>60 s per muscle) are where the deficit is
 *    clearest.
 *
 * 2. Stretching is not what prevents injury. The protective effect that shows
 *    up in the literature comes from structured neuromuscular warm-ups -
 *    balance, landing control, trunk and hip stability, progressive
 *    plyometrics - through motor control and eccentric strength, not through
 *    tissue elongation.
 *
 * So the goal (injury-free lifters) is right and the mechanism is wrong. What
 * this file computes is the thing that does help and that nobody argues about:
 * ramped specific warm-up sets, in the exact lift, up to the working weight.
 * Dynamic mobility goes before them, and static stretching is moved to AFTER
 * training, where it improves range of motion just as well (SMD 0.40 vs 0.48
 * for dynamic, no significant difference) without costing anything on the bar.
 *
 * ── WHY THE SETS ARE COMPUTED RATHER THAN DESCRIBED ───────────────────────
 *
 * Same reason as progression. "Work up in singles and doubles" is advice; a
 * lifter who has never done it needs numbers, and the numbers depend on plates
 * they own. Asking the model to do percentage arithmetic and round to loadable
 * weights on every turn is asking it to be a calculator, which it is not.
 *
 * Pure functions. No I/O.
 */

import { BAR, canonicalLift, roundToLoadable, smallestLoadableIncrement } from './progression.js';

/** The empty barbell, which is where every ramp starts. */
export { BAR as BAR_WEIGHT } from './progression.js';

/**
 * The ramp, as fractions of the working weight.
 *
 * Reps fall as load rises: the point of the later sets is to rehearse the
 * groove under something near the working weight without accumulating fatigue
 * that costs you the work sets. This is the conventional powerlifting ramp
 * and is uncontroversial across every source consulted.
 */
export const RAMP = Object.freeze([
  { fraction: 0.4, reps: 5 },
  { fraction: 0.6, reps: 3 },
  { fraction: 0.8, reps: 2 },
  { fraction: 0.9, reps: 1 },
]);

/**
 * Below this, ramping is theater: the working weight is close enough to the
 * empty bar that a couple of sets with the bar is the whole warm-up.
 */
export const RAMP_THRESHOLD_MULTIPLE = 1.5;

/**
 * Warm-up sets for one lift.
 *
 * @returns {{lift: string|null, sets: Array<{weight: number, reps: number}>, note: string}}
 */
export function warmupSets({ lift, workingWeight, units = 'lb', smallestPlatePair = null } = {}) {
  const canonical = canonicalLift(lift);
  const bar = BAR[units] ?? BAR.lb;
  const work = Number(workingWeight);

  if (!canonical || !Number.isFinite(work) || work <= 0) {
    return { lift: canonical, sets: [], note: 'No working weight, so no ramp can be computed.' };
  }

  if (work <= bar) {
    return {
      lift: canonical,
      sets: [{ weight: bar, reps: 5 }],
      note: 'The working weight is at or below the empty bar, so the bar itself is the warm-up.',
    };
  }

  if (work < bar * RAMP_THRESHOLD_MULTIPLE) {
    return {
      lift: canonical,
      sets: [
        { weight: bar, reps: 5 },
        { weight: bar, reps: 5 },
      ],
      note: 'Close enough to the empty bar that two sets with the bar is the whole ramp.',
    };
  }

  const step = smallestLoadableIncrement(smallestPlatePair, units);
  const sets = [{ weight: bar, reps: 5 }];

  for (const { fraction, reps } of RAMP) {
    const target = roundToLoadable(work * fraction, step, units);
    // Skip a rung that rounds onto the bar, or onto a weight already used, or
    // that has crept up to the working weight itself. A warm-up that repeats
    // the same number twice reads as a mistake and costs a set of real work.
    if (target <= bar) continue;
    if (target >= work) continue;
    if (sets.some((s) => s.weight === target)) continue;
    sets.push({ weight: target, reps });
  }

  return {
    lift: canonical,
    sets,
    note: 'Ramped specific sets in the lift itself, which is the part of a warm-up the evidence supports.',
  };
}

/**
 * The whole pre-session routine, in order.
 *
 * The ordering is the substance: general, then dynamic, then specific. Static
 * stretching is absent by construction rather than by instruction — it is not
 * a thing the model is asked to omit, it is a thing this function does not
 * produce.
 */
export function warmupPlan({ prescriptions = {}, units = 'lb', smallestPlatePair = null } = {}) {
  const perLift = [];

  for (const [lift, p] of Object.entries(prescriptions)) {
    if (!p || p.weight === null || p.weight === undefined) continue;
    const { sets, note } = warmupSets({
      lift,
      workingWeight: p.weight,
      units,
      smallestPlatePair,
    });
    if (sets.length) perLift.push({ lift, sets, note });
  }

  return {
    general:
      'Five to ten minutes of easy cardio - bike, rower, brisk walk - until breathing is raised and you have broken a light sweat.',
    dynamic:
      'Dynamic mobility for the joints the session will use: leg swings, hip circles, bodyweight squats to depth, band pull-aparts, shoulder dislocates. Movement through range, not holds.',
    specific: perLift,
    afterTraining:
      'Static stretching belongs here, after training, or in its own session - not before. It improves range of motion just as well afterwards and does not cost you force on the bar.',
  };
}

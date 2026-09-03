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
 * Lifts that start on the floor, where the BAR'S HEIGHT is part of the lift.
 *
 * ── WHY AN EMPTY-BAR DEADLIFT IS NOT A LIGHT DEADLIFT ─────────────────────
 *
 * The IPF technical rules put the largest disc at no more than 45 cm across
 * and the bar between 28 and 29 mm. So a bar loaded with any full-size plate
 * sits with its center 225 mm off the floor, and an EMPTY bar sits at about
 * 15 mm - a difference of roughly 210 mm, or eight inches.
 *
 * Pulling from eight inches lower is a deficit deadlift: more knee and hip
 * flexion to reach the bar, a longer range, and more demand on a lower back
 * that has not warmed up yet. It is a harder variation than the working sets
 * it is supposed to prepare somebody for, which is the wrong way round.
 *
 * This was shipped for a while and was visible on the Program page before
 * anybody noticed, because "start the ramp at the empty bar" is correct for
 * every lift that does not begin on the ground and nothing distinguished
 * them.
 */
const FLOOR_LIFTS = new Set(['deadlift']);

/**
 * The lightest load that puts the bar at its real height, per side pair.
 *
 * A 45 lb / 20 kg plate is the only commonly stocked iron plate at full
 * diameter - a 35 is smaller, a 25 smaller again - so in a gym without bumper
 * plates this is the floor whatever change plates they own. Bumpers would
 * allow lighter, and we do not know whether a given gym has them, so the
 * conservative number is the one used: being told to start heavier than
 * necessary costs a warm-up set, being told to pull from a deficit costs a
 * back.
 */
export const PLATE_HEIGHT_LOAD = { lb: 135, kg: 60 };

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
    return {
      lift: canonical,
      sets: [],
      reason: 'no_weight',
      note: 'No working weight, so no ramp can be computed.',
    };
  }

  if (work <= bar) {
    return {
      lift: canonical,
      sets: [{ weight: bar, reps: 5 }],
      reason: 'ramped',
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
      reason: 'ramped',
      note: 'Close enough to the empty bar that two sets with the bar is the whole ramp.',
    };
  }

  const step = smallestLoadableIncrement(smallestPlatePair, units);

  /*
   * For a lift off the floor the lightest rung is not the empty bar, it is the
   * lightest load that puts the bar at plate height. See FLOOR_LIFTS above:
   * an empty bar on the ground is an eight-inch deficit, which is a harder
   * variation of the thing being warmed up for.
   */
  const onTheFloor = FLOOR_LIFTS.has(canonical);
  const lowest = onTheFloor ? PLATE_HEIGHT_LOAD[units] ?? PLATE_HEIGHT_LOAD.lb : bar;

  if (onTheFloor && work <= lowest) {
    /*
     * Their working weight is below the height-correct minimum, which is
     * ordinary for a novice and has an ordinary answer: raise the bar rather
     * than lower the athlete. Blocks, mats, or the bar resting on a stack of
     * plates all put it back where a deadlift starts.
     *
     * No ramp is returned, because every load it could name would be one this
     * function has just said is the wrong height.
     */
    return {
      lift: canonical,
      sets: [],
      /*
       * Named, because this is NOT the same as having no ramp. It is a piece
       * of advice the athlete needs, and an earlier version of warmupPlan()
       * dropped every entry with no sets - which would have thrown this away
       * silently, leaving a novice deadlifter with no warm-up guidance at all
       * and nothing anywhere saying why.
       */
      reason: 'elevate',
      note:
        'Their working weight is below the lightest load that puts the bar at its normal height, ' +
        'so warming up on the floor would mean pulling from a deficit. Tell them to raise the bar ' +
        'to about the height of a full-size plate - blocks, mats, or resting it on plates - and ' +
        'warm up there.',
    };
  }

  const sets = [{ weight: lowest, reps: 5 }];

  for (const { fraction, reps } of RAMP) {
    const target = roundToLoadable(work * fraction, step, units);
    // Skip a rung that rounds onto the lowest rung, or onto a weight already
    // used, or that has crept up to the working weight itself. A warm-up that
    // repeats the same number twice reads as a mistake and costs a set of real
    // work.
    if (target <= lowest) continue;
    if (target >= work) continue;
    if (sets.some((s) => s.weight === target)) continue;
    sets.push({ weight: target, reps });
  }

  return {
    lift: canonical,
    sets,
    reason: 'ramped',
    note: onTheFloor
      ? 'Ramped specific sets from the lightest load that keeps the bar at its normal height.'
      : 'Ramped specific sets in the lift itself, which is the part of a warm-up the evidence supports.',
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
    const { sets, note, reason } = warmupSets({
      lift,
      workingWeight: p.weight,
      units,
      smallestPlatePair,
    });
    // `no_weight` is the only case with nothing to say. An `elevate` entry has
    // no sets and is the most important thing this module produces for a
    // novice deadlifter, so the old `if (sets.length)` guard threw exactly the
    // wrong one away.
    if (reason !== 'no_weight') perLift.push({ lift, sets, note, reason });
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

/**
 * The warm-up for a STORED program, day by day.
 *
 * ── WHY THE PROGRAM PAGE COMPUTES THIS INSTEAD OF STORING IT ──────────────
 *
 * Reported plainly: "the program is not showing the stretch or warm up
 * exercises." It was not. The coach writes a warm-up into the chat reply, but
 * the `<program_data>` block has no field for one, so the Program page - the
 * only durable copy of a session, and the thing an athlete actually reads at
 * the rack - showed the working sets and nothing before them.
 *
 * The obvious fix is a `warmup` field on the block. It was not taken, for
 * three reasons:
 *
 *   1. It is the ADR-2 shape. Warm-up ramps are already computed here rather
 *      than asked for, because they are percentage arithmetic rounded to
 *      loadable plates and a model is not a calculator. Storing a copy in the
 *      block would put a second, hand-written answer next to the computed one
 *      and invite them to disagree.
 *   2. A stored field only helps programs written AFTER it exists. Computing
 *      it means every program already in the database - including the ones
 *      this athlete is training on today - gains a warm-up the moment the page
 *      is deployed.
 *   3. It cannot be forgotten. The model omitting a block field is a silent
 *      failure of exactly the kind this project keeps finding; a derived value
 *      has no such failure mode.
 *
 * The ramp is derived from the WORKING WEIGHTS ON THE PAGE, so the two can
 * never disagree - a warm-up that ramps to a number the table does not show is
 * worse than no warm-up at all.
 *
 * ── WHICH MOVEMENTS GET A RAMP ────────────────────────────────────────────
 *
 * The ones warmupSets() recognizes, which is the four competition lifts.
 * Accessories are skipped, and that is the correct answer rather than a
 * limitation: nobody ramps to their working weight on a barbell row, and a
 * warm-up listing every movement in the session is the "list nobody does" the
 * coaching prompt warns about.
 *
 * ── DATA ONLY, NO PROSE ───────────────────────────────────────────────────
 *
 * The sentences in warmupPlan() above are written for the MODEL, in English,
 * and they stay there. This returns numbers, because the page that renders
 * them has a Spanish translation and a route that shipped English prose
 * straight into it would be an untranslated paragraph in the middle of a
 * translated page - the same shape as the adherence statuses, which cross the
 * wire as keys and are worded in the locale file.
 *
 * @param {object}   options
 * @param {object}   options.program  a stored program_data object
 * @param {string}   options.units
 * @param {number?}  options.smallestPlatePair
 * @returns {{units: string, bar: number, days: Array<{name: string, specific: Array<object>}>}|null}
 *   null when the program prescribes nothing that can be ramped, so the page
 *   renders no empty heading. The units the ramp was COMPUTED in travel with
 *   it, rather than being defaulted a second time in the browser - two copies
 *   of a fallback is how a page ends up labelling kilos as pounds.
 */
export function warmupForProgram({ program, units = 'lb', smallestPlatePair = null } = {}) {
  const days = Array.isArray(program?.days) ? program.days : [];

  const perDay = days.map((day) => {
    const prescriptions = {};
    for (const exercise of Array.isArray(day?.exercises) ? day.exercises : []) {
      // First spelling wins. A day that programs squats twice is warmed up
      // once, at the load the first entry names.
      const lift = canonicalLift(exercise?.lift);
      if (!lift || lift in prescriptions) continue;
      prescriptions[lift] = { weight: exercise.weight };
    }
    const plan = warmupPlan({ prescriptions, units, smallestPlatePair });
    /*
     * `note` is dropped here on purpose. It is English prose written for the
     * MODEL, and the page that renders this has a Spanish translation - see
     * the note above about shipping sentences into a translated page. What
     * crosses the wire is `reason`, which the page words itself, exactly as
     * the adherence statuses do.
     */
    const specific = plan.specific.map(({ lift, sets, reason }) => ({ lift, sets, reason }));
    return { name: day?.name ?? null, specific };
  });

  // An `elevate` entry counts: it has no sets and is the whole answer for a
  // novice deadlifter, so a check that counted SETS would return null for the
  // one athlete who most needs to read this.
  if (!perDay.some((day) => day.specific.length)) return null;

  /*
   * `bar` travels so the page can say "empty bar" instead of a number that
   * means nothing to a novice. It is the constant this module already uses,
   * sent rather than re-declared: a browser copy of the bar weight is a second
   * copy of a fact, and it would be wrong for exactly the athlete who trains
   * in kilos.
   */
  return { units: units === 'kg' ? 'kg' : 'lb', bar: BAR[units] ?? BAR.lb, days: perDay };
}

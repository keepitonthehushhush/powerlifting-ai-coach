/**
 * The shape of a training day, for a page somebody reads between sets.
 *
 * ── WHAT WAS CONFUSING ────────────────────────────────────────────────────
 *
 * "The program doesn't have a proper structure, it looks oddly confusing."
 *
 * Week 21, day one, as stored: four rows of `bench press (Smith)` at 225, 245,
 * 280 and 310, then five accessories. Rendered as nine equal rows of a
 * five-column table, those first four read as four separate prescriptions -
 * bench press, then bench press again, then again - rather than as one
 * movement worked up to a top set. The athlete is left to notice the ascending
 * weights and infer the intent.
 *
 * Nothing about the prescription is wrong. What is wrong is that a table row
 * is the wrong unit: the athlete does not do nine things, they do five, and
 * one of them has four sets.
 *
 * ── SO THE GROUPING IS BY MOVEMENT, AND IT IS PURELY PRESENTATIONAL ───────
 *
 * Consecutive entries naming the same lift become one group. Nothing is
 * merged, summed, reordered or dropped - every set the coach prescribed is
 * still shown, with its own weight and reps. The only change is that the
 * movement is named once and its sets are listed under it.
 *
 * CONSECUTIVE, not "all entries with this name". A day that opens with squats
 * and closes with a squat-based finisher prescribed those as two separate
 * things, in two places, on purpose; collapsing them across the accessories
 * between would be editing the program rather than laying it out.
 *
 * ── AND WHY THE ORIGINAL INDEX TRAVELS ────────────────────────────────────
 *
 * Adherence is keyed by the exercise's position in the stored array - the
 * server computed it against that array and knows nothing about this grouping.
 * Every set carries the index it came from, so "changed" still lands on the
 * set it describes. A grouping that renumbered them would put the right words
 * on the wrong row, which is worse than the confusion it set out to fix.
 */

/** A day with one entry that prescribes no work is a rest day, not training. */
export const DAY_KINDS = Object.freeze(['training', 'recovery', 'rest']);

/**
 * @param {Array<object>} exercises  the day's exercises, in stored order
 * @returns {Array<{lift: string, sets: Array<{index: number, exercise: object}>}>}
 */
export function groupExercises(exercises) {
  if (!Array.isArray(exercises)) return [];

  const groups = [];
  exercises.forEach((exercise, index) => {
    const lift = exercise?.lift ?? '';
    const previous = groups[groups.length - 1];
    // Compared on the name as WRITTEN. Two spellings of one movement are two
    // movements to a person reading the sheet, and quietly merging them would
    // hide a difference the coach may have meant.
    if (previous && previous.lift === lift) {
      previous.sets.push({ index, exercise });
      return;
    }
    groups.push({ lift, sets: [{ index, exercise }] });
  });
  return groups;
}

/**
 * What kind of day this is, for a page that should not give a full rest day
 * the same weight as twelve movements.
 *
 * Read from the day's own contents rather than from its name: names are
 * written by the model and translated by nobody, so "Day 7 - Full Rest" is a
 * string this code should not be parsing for meaning. A day prescribes work or
 * it does not.
 *
 * `recovery` is the honest middle: a walk and some planks is not training and
 * is not rest either, and a sheet that calls it one of those two is wrong in a
 * way the athlete will notice.
 */
export function dayKind(day) {
  const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
  if (exercises.length === 0) return 'rest';

  const loaded = exercises.filter((e) => typeof e?.weight === 'number' && e.weight > 0);
  if (loaded.length > 0) return 'training';

  // Nothing carries a load. One entry is a rest day with an instruction on it
  // ("full rest", "outdoor walk"); several is a recovery session.
  return exercises.length === 1 ? 'rest' : 'recovery';
}

/**
 * How many movements a day actually asks for, which is the number of groups
 * rather than the number of rows.
 *
 * This is the whole point stated as arithmetic: week 21 day one has nine
 * stored entries and asks for six movements. (Counted by running it. The
 * first draft of this comment said five, from memory, which is the mistake
 * this whole file is a response to.)
 */
export function movementCount(day) {
  return groupExercises(day?.exercises).length;
}

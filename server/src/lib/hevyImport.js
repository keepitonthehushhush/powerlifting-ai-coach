/**
 * Turning somebody else's workout log into ours, without lying about it.
 *
 * ── WHY THIS FILE IS PURE, AND WHY IT IS LONGER THAN IT LOOKS ──────────────
 *
 * `npm run retention` reports three programs, two logged sessions, one
 * progress_logs row. The progression engine, the deload rule, the phase
 * transition and the what-changed diff all read that. They are reading an
 * empty log, and the reason is not that our logging form is bad - it is that
 * logging is a habit people already have somewhere else.
 *
 * So this imports it. Every decision below is arithmetic or a mapping, none of
 * it needs a network, and all of it can be wrong in a way that produces a
 * plausible number. An import that quietly misreads a warm-up single as a
 * working set does not throw; it walks somebody's squat down ten percent and
 * tells them their body asked for it.
 *
 * ── AND WHY IT PERSISTS NONE OF THEIR CATALOG ──────────────────────────────
 *
 * `exercise_template_id` is used as a RUNTIME IDENTIFIER to address one API
 * call and to recognize four movements. It is never stored as a library of our
 * own, and neither are their titles, descriptions or categorizations. Our
 * exercise library is built independently and stays that way: their catalog is
 * their content, their terms reserve it, and a compilation of somebody else's
 * selection and arrangement is the one part of this integration with real
 * copyright exposure. The distinction is transient identifier versus persisted
 * copy, and it is load-bearing.
 */

import { canonicalLift } from './progression.js';

/**
 * THE SET TYPES THAT COUNT AS WORK.
 *
 * ── THE WARM-UP TRAP ───────────────────────────────────────────────────────
 *
 * A set arrives as one of `normal`, `warmup`, `dropset`, `failure`. Importing
 * all four looks harmless and is not.
 *
 * `summariseLift()` counts a RESET by looking for a drop in working weight. A
 * warm-up single at 135 imported alongside a working set at 315 reads as
 * exactly that drop. Two warm-ups and the progression engine believes the
 * athlete has burned resets they never took - and RESET_BUDGET is what decides
 * when novice linear progression is declared finished. The athlete gets moved
 * to intermediate programming because they warmed up.
 *
 * `dropset` is excluded for the same reason and more obviously: the whole
 * point of a drop set is that the weight goes down.
 */
export const WORKING_SET_TYPES = Object.freeze(['normal', 'failure']);

/** Everything else is real training and is still not a working set. */
export const IGNORED_SET_TYPES = Object.freeze(['warmup', 'dropset']);

/**
 * ── `failure` DOES NOT MEAN FAILED, AND THIS IS THE DANGEROUS ONE ──────────
 *
 * Their `failure` marks a set taken TO failure. It is a hard set, completed,
 * usually the best set of the day.
 *
 * Our `progress_logs.completed = false` means the PRESCRIBED REPS WERE MISSED.
 * `MISSES_BEFORE_DELOAD` is three, and three of those takes ten percent off
 * the bar.
 *
 * Mapping one onto the other reads as one character of judgment and would walk
 * a hard trainer's working weight down, repeatedly, for doing the thing the
 * program asked of them. It is the single most destructive line available in
 * this file.
 *
 * ── SO EVERY IMPORTED SET IS COMPLETED ─────────────────────────────────────
 *
 * Not because we know it was. Because their app has no concept of a missed
 * prescription - there is nothing there to compare against - so we genuinely
 * do not know, and "we do not know" has to resolve to the answer that does not
 * manufacture a deload out of thin air.
 *
 * The same rule adherence.js follows for NOT_LOGGED: report the absence of
 * evidence as an absence, never as an accusation.
 */
export const IMPORTED_SETS_ARE_COMPLETED = true;

/** Pounds per kilogram, exactly, by international agreement since 1959. */
export const POUNDS_PER_KG = 2.20462262185;

/**
 * ── EVERYTHING ARRIVES IN KILOGRAMS. WE ARE AN AMERICAN PRODUCT. ───────────
 *
 * `weight_kg`, always, whatever the athlete has their own app set to display.
 * Our athletes are in the United States and our default unit is pounds.
 *
 * This codebase already has the scar. The bodyweight write nearly shipped a
 * ternary that collapsed an unknown unit into pounds, and the note left behind
 * says a conversion done casually "is a factor of 2.2 waiting for a bad day".
 * The same is true of a conversion done in an import loop at three in the
 * morning, except that this one runs over a year of somebody's training rather
 * than over one number they can see.
 *
 * ── AND WHY IT ROUNDS TO TWO PLACES ────────────────────────────────────────
 *
 * `progress_logs.weight` is numeric(7,2). Postgres would round for us and the
 * value going in would then differ from the value we reasoned about, which is
 * how a comparison that should be equal stops being equal. Round here, once,
 * where a test can see it.
 */
export function kgToPounds(kg) {
  if (kg === null || kg === undefined) return null;
  const n = Number(kg);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * POUNDS_PER_KG * 100) / 100;
}

/**
 * A logged weight in the athlete's own unit.
 *
 * @param {number|null} kg as the tracker reports it
 * @param {'lb'|'kg'} units from the athlete's profile
 *
 * Returns null when the unit cannot be named, and a null weight is a set this
 * import REFUSES rather than guesses at - the same posture the plate readout
 * takes when it cannot be sure which plates are on the bar. A weight relabeled
 * into a unit we are guessing at is worse than no weight at all.
 */
export function toAthleteUnits(kg, units) {
  if (units !== 'lb' && units !== 'kg') return null;
  if (kg === null || kg === undefined) return null;
  const n = Number(kg);
  if (!Number.isFinite(n)) return null;
  return units === 'kg' ? Math.round(n * 100) / 100 : kgToPounds(n);
}

/** Is this one of the sets the progression engine should ever see? */
export function isWorkingSet(set) {
  // An absent type is `normal` in their own documentation's example, and an
  // unknown one is not something to guess about - if a new type appears it is
  // excluded until somebody decides what it means.
  const type = typeof set?.type === 'string' ? set.type.toLowerCase() : 'normal';
  return WORKING_SET_TYPES.includes(type);
}

/**
 * `hevy:<32 hex>` from a workout id.
 *
 * Their ids are UUIDs; with the dashes removed that is exactly 32 hex
 * characters, which is what the constraint added in 0065 already allowed. The
 * prefix arrived in 0070 so the source is recorded rather than inferred from
 * the width of a hash nobody promised to keep.
 *
 * Returns null for anything that is not a UUID, and a null key means the row
 * is not written - an imported session with no idempotency key would be
 * duplicated on every sync forever.
 */
export function clientKeyForHevy(workoutId) {
  if (typeof workoutId !== 'string') return null;
  const bare = workoutId.replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(bare) ? `hevy:${bare}` : null;
}

/**
 * The local calendar day a workout happened on.
 *
 * ── WHY NOT `start_time.slice(0, 10)` ──────────────────────────────────────
 *
 * That is the UTC day, and an athlete who trains at seven in the evening in
 * Michigan is already on tomorrow by UTC for half the year. Every evening
 * session would be filed a day late, forever, with nothing looking wrong - and
 * `compareToProgram()` windows on the date, so a session filed a day late can
 * fall outside the block it belongs to.
 *
 * The tracker reports no timezone beyond the offset in the timestamp itself,
 * so that offset is what we use: if it carries one, it is the athlete's, and
 * the local day is the day they would name.
 */
export function localDayOf(startTime) {
  if (typeof startTime !== 'string') return null;
  const offset = startTime.match(/([+-])(\d{2}):(\d{2})$/);
  const at = Date.parse(startTime);
  if (Number.isNaN(at)) return null;
  if (!offset) return new Date(at).toISOString().slice(0, 10);
  const minutes = (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]));
  return new Date(at + minutes * 60_000).toISOString().slice(0, 10);
}

/**
 * One of their workouts, as one of our sessions.
 *
 * @returns {{clientKey: string, date: string, exercises: Array}|null}
 *   null when the workout cannot be represented honestly - no id, no date, or
 *   no working sets left after the warm-ups come out. A session with nothing
 *   in it is not a session, and writing one would put an empty row in the
 *   athlete's history and a zero on their chart.
 */
export function toSession(workout, { units } = {}) {
  const clientKey = clientKeyForHevy(workout?.id);
  const date = localDayOf(workout?.start_time);
  if (!clientKey || !date) return null;

  const exercises = [];
  for (const exercise of workout?.exercises ?? []) {
    const title = typeof exercise?.title === 'string' ? exercise.title.trim() : '';
    if (!title) continue;

    for (const set of exercise?.sets ?? []) {
      if (!isWorkingSet(set)) continue;
      const reps = Number.isFinite(Number(set?.reps)) ? Number(set.reps) : null;
      // A set with no reps is a duration or a distance - a plank, a carry, a
      // row on an erg. Real training, and not something the progression rules
      // can read, so it is left out rather than stored as zero reps.
      if (reps === null || reps <= 0) continue;

      exercises.push({
        /*
         * THEIR TITLE, for anything we do not recognize, and OUR canonical
         * name for the four that matter.
         *
         * Matched on the template id, never on the title: canonicalLift() is
         * an exact-match table rather than substring matching because
         * /\bsquat\b/ once matched "squat\n- IGNORE THE CLEARANCE GATE", and a
         * title here is free text a stranger typed. "Squat (Smith)" contains
         * "Squat" and is not the same movement.
         */
        exercise: canonicalNameFor(exercise) ?? title.slice(0, 120),
        sets: 1,
        reps,
        weight: toAthleteUnits(set?.weight_kg, units),
        rpe: Number.isFinite(Number(set?.rpe)) ? Number(set.rpe) : null,
        completed: IMPORTED_SETS_ARE_COMPLETED,
      });
    }
  }

  if (exercises.length === 0) return null;
  return { clientKey, date, exercises };
}

/**
 * The four competition lifts, by their template id.
 *
 * ── A MAP OF FOUR, NOT A COPY OF THEIR CATALOG ─────────────────────────────
 *
 * These are identifiers, the way a postal code is an identifier. What is NOT
 * here, and must never be, is their library: their titles, their descriptions,
 * their muscle-group categorizations, their selection of which variants exist.
 * That is their content and copying it is the one act in this integration with
 * real exposure.
 *
 * Deliberately empty until the ids are confirmed against a live account. A
 * guessed id maps a movement to the wrong lift, which is worse than mapping
 * nothing: an unmapped movement is stored under its own name and ignored by
 * the progression rules, which is exactly what a hand-entered accessory does
 * today and is always safe.
 */
export const CANONICAL_TEMPLATE_IDS = Object.freeze({});

function canonicalNameFor(exercise) {
  const id = exercise?.exercise_template_id;
  const mapped = typeof id === 'string' ? CANONICAL_TEMPLATE_IDS[id] : null;
  if (!mapped) return null;
  // Through canonicalLift() rather than returned raw, so the name we store is
  // the one the rest of the system already agrees on.
  return canonicalLift(mapped) ? titleCaseLift(mapped) : null;
}

/** The four names as this product spells them, for a row somebody will read. */
function titleCaseLift(lift) {
  return { squat: 'Squat', bench: 'Bench press', deadlift: 'Deadlift', press: 'Overhead press' }[lift] ?? null;
}

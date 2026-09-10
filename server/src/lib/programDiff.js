import { canonicalLift } from './progression.js';

/**
 * What changed between one training block and the next, and whether the logs
 * asked for it.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * The adaptation already happens. `lib/adherence.js` cross-references the
 * program against the log, `lib/progression.js` computes what goes on the bar
 * next, `lib/phase.js` decides when linear progression is finished, and all
 * three reach the coach before it writes the next block. What is missing is
 * the record.
 *
 * A new program supersedes the old one and NOTHING says what differs or why.
 * The coach explains it once, in a chat message, and the chat scrolls away.
 * Six weeks later the Program page shows "week 3, novice - Sep 4" and neither
 * the athlete, nor the coach, nor anybody reading the database can say why the
 * squat came down ten pounds in week two.
 *
 * That is the difference between a coach and a program generator. A generator
 * hands you a new plan; a coach tells you what changed and why, and the second
 * one is the thing worth coming back for.
 *
 * ── COMPUTED ON READ, NOT STORED ───────────────────────────────────────────
 *
 * The same three reasons the warm-up is derived in routes/program.js rather
 * than written into the block: it is arithmetic over two things already
 * stored, a stored copy could disagree with the tables beside it, and a field
 * the model can forget is a silent failure of the kind this codebase keeps
 * finding. Deriving it also explains every program ALREADY in the database,
 * which a new column never could.
 *
 * ── AND IT NEVER INVENTS A REASON ──────────────────────────────────────────
 *
 * This is the whole discipline of the file. The diff can see WHAT changed with
 * certainty; WHY is a different question, and the honest answer is often "the
 * coach decided something the arithmetic did not call for", which is allowed -
 * a missed week, a bad sleep run, an athlete who asked for a lighter squat.
 *
 * So each changed load carries the diff's fact and, separately, what
 * `nextPrescription` computed from the log. Where they agree, the reason is
 * established and can be shown. Where they disagree, THE DISAGREEMENT IS THE
 * OUTPUT - not a manufactured explanation, and not silence either. Same
 * discipline as adherence.js, where NOT_LOGGED is reported as not logged
 * rather than as skipped.
 */

/**
 * The block the active one replaced.
 *
 * ── WHY THIS IS A FUNCTION AND NOT TWO LINES IN EACH CALLER ────────────────
 *
 * Because two callers need it - the program page and the coach - and program
 * routes already carry the argument for why they must agree: "a page and a
 * coach disagreeing about whether somebody did their squats is a bug nobody
 * would ever think to look for". The same holds twice over for what changed
 * since last week, since one of the two is being read while the other is being
 * asked about it.
 *
 * Not `rows[1]`. That is the newest OTHER row, which is the wrong answer twice
 * over: a row written after the active one (two tabs, a retried save) would win
 * it, and so would a still-active duplicate if one ever existed.
 *
 * @param {Array} rows workout_programs rows, any order
 * @param {object|null} active the row currently in force
 */
export function previousBlock(rows, active) {
  if (!active?.created_at) return null;
  const activeAt = Date.parse(active.created_at);
  return (
    (rows ?? [])
      .filter((p) => p && p.id !== active.id && Date.parse(p.created_at) < activeAt)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
  );
}

/** How a load moved. `null` when either side has no weight to compare. */
export const LOAD = {
  UP: 'up',
  DOWN: 'down',
  SAME: 'same',
};

/** Whether the arithmetic over the log accounts for the change. */
export const BASIS = {
  /** The change is what the progression engine called for. */
  PROGRESSION: 'progression',
  /** The engine called for something else. Not an error - see the header. */
  COACH: 'coach',
  /** No log to compute from, so nothing can be said either way. */
  UNKNOWN: 'unknown',
};

const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Two loads are the same load if they round to the same hundredth. */
const sameWeight = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.01;
};

/**
 * Every prescription for one movement, in the order the week presents them.
 *
 * ── WHY THIS IS A LIST AND NOT A NUMBER ────────────────────────────────────
 *
 * A lift can appear more than once in a week, and in intermediate programming
 * it is supposed to: a heavy day and a lighter day on the same movement is the
 * shape the whole phase change is FOR. Keying a diff by lift name and storing
 * one weight silently picks whichever occurrence came last and reports it as
 * "the squat", which turns a correct light day into a phantom ten percent
 * deload on the page the athlete reads.
 *
 * Keying by (day, lift) instead does not survive contact either: day names are
 * free text the model writes, so "Day A" becoming "Monday" unpairs every
 * exercise in the week and the diff reports an entire program replaced.
 *
 * So: collect the occurrences, compare the HEAVIEST, and say so out loud
 * whenever there is more than one. A comparison that announces its own basis
 * can be checked; one that hides it cannot.
 */
function occurrencesOf(programData) {
  const byLift = new Map();
  for (const day of programData?.days ?? []) {
    for (const exercise of day?.exercises ?? []) {
      const name = typeof exercise?.lift === 'string' ? exercise.lift.trim() : '';
      if (!name) continue;
      const key = canonicalLift(name) ?? name.toLowerCase().replace(/\s+/g, ' ');
      if (!byLift.has(key)) byLift.set(key, { key, label: name, entries: [] });
      byLift.get(key).entries.push({
        day: day?.name ?? null,
        sets: num(exercise.sets),
        reps: num(exercise.reps),
        weight: num(exercise.weight),
      });
    }
  }
  return byLift;
}

/** The heaviest prescription for a movement, or the first if none carry a load. */
function heaviest(entries) {
  const weighted = entries.filter((e) => e.weight != null);
  if (weighted.length === 0) return entries[0] ?? null;
  return weighted.reduce((top, e) => (e.weight > top.weight ? e : top), weighted[0]);
}

/**
 * @param {object} input
 * @param {object|null} input.previous the superseded program's program_data
 * @param {object|null} input.next     the active program's program_data
 * @param {Record<string, object>} [input.prescriptions] prescribeAll() output, for corroboration
 * @returns {object|null} null when there is nothing to compare
 */
export function diffPrograms({ previous, next, prescriptions = {} } = {}) {
  if (!previous?.days?.length || !next?.days?.length) return null;

  const before = occurrencesOf(previous);
  const after = occurrencesOf(next);

  const changed = [];
  const added = [];
  const removed = [];
  const unchanged = [];

  for (const [key, now] of after) {
    const then = before.get(key);
    if (!then) {
      added.push({ key, label: now.label, to: heaviest(now.entries) });
      continue;
    }

    const from = heaviest(then.entries);
    const to = heaviest(now.entries);
    // More than one prescription on either side means the comparison had to
    // choose. A comparison that announces its own basis can be checked.
    const spread = then.entries.length > 1 || now.entries.length > 1;

    const load =
      from?.weight == null || to?.weight == null
        ? null
        : sameWeight(from.weight, to.weight)
          ? LOAD.SAME
          : to.weight > from.weight
            ? LOAD.UP
            : LOAD.DOWN;

    const volumeChanged = from?.sets !== to?.sets || from?.reps !== to?.reps;
    const timesChanged = then.entries.length !== now.entries.length;

    /*
     * ── WHY THIS IS NOT `load !== SAME` ────────────────────────────────────
     *
     * Found by running this against the real database rather than fixtures. A
     * program full of accessories - side planks, broad jumps, a push-up
     * finisher - carries `weight: null` on both sides, so `load` is null,
     * which is not SAME, so every one of them landed in `changed` and the page
     * would have listed seven movements under "what changed" with nothing
     * visibly different beside any of them.
     *
     * Null is not one state. Unweighted on both sides is no load change at
     * all; a weight that arrived or left IS one, and a real one - putting 25 lb
     * on the chin-ups is exactly the kind of change worth a line.
     */
    const bothUnweighted = from?.weight == null && to?.weight == null;
    const weightAppearedOrLeft = (from?.weight == null) !== (to?.weight == null);
    const loadChanged = load === LOAD.UP || load === LOAD.DOWN || weightAppearedOrLeft;

    const entry = {
      key,
      label: now.label,
      from,
      to,
      load,
      /** Signed, so a caller never has to subtract and get the sign wrong. */
      delta: from?.weight != null && to?.weight != null ? round2(to.weight - from.weight) : null,
      setsRepsChanged: volumeChanged,
      timesPerWeek: timesChanged ? { from: then.entries.length, to: now.entries.length } : null,
      /**
       * True when the comparison had to choose between several prescriptions.
       * Not flagged for movements with no load on either side: "compared on
       * the heaviest" says nothing about two identical sets of side planks,
       * and a note that explains nothing is noise on a page somebody reads
       * standing up.
       */
      comparedOnHeaviest: spread && !bothUnweighted,
      ...corroborate({ key, load, to, prescription: prescriptions[key] }),
    };

    if (!loadChanged && !volumeChanged && !timesChanged) unchanged.push(entry);
    else changed.push(entry);
  }

  for (const [key, then] of before) {
    if (!after.has(key)) removed.push({ key, label: then.label, from: heaviest(then.entries) });
  }

  const phase =
    previous.phase !== next.phase ? { from: previous.phase ?? null, to: next.phase ?? null } : null;
  const week =
    num(previous.week) !== num(next.week) ? { from: num(previous.week), to: num(next.week) } : null;
  const days =
    previous.days.length !== next.days.length
      ? { from: previous.days.length, to: next.days.length }
      : null;

  const anything =
    phase || week || days || changed.length > 0 || added.length > 0 || removed.length > 0;

  return {
    phase,
    week,
    days,
    changed,
    added,
    removed,
    unchanged,
    /**
     * Two blocks that differ in nothing. Reported rather than treated as an
     * absence: "your program is the same as last week" is a real and sometimes
     * correct answer, and a UI that renders nothing leaves the athlete to
     * decide whether it is unchanged or broken.
     */
    identical: !anything,
  };
}

/**
 * Does the log account for this change?
 *
 * ── WHAT AGREEMENT MEANS, AND WHAT IT DOES NOT ─────────────────────────────
 *
 * `nextPrescription` reads the athlete's logged history and returns an action
 * and a target weight. If the new block's load matches that target, the log
 * accounts for the change and the engine's own `reason` - already written to
 * be read aloud - is the explanation.
 *
 * If it does not match, this returns COACH, which is a description and NOT a
 * complaint. There are ordinary reasons for a coach to depart from the
 * arithmetic: a missed week, an athlete who asked for a lighter squat, an
 * injury mentioned in conversation that no log row records. Reporting that as
 * an error would be the adherence-percentage mistake in another costume -
 * grading a decision the data cannot see the inputs to.
 *
 * With no log there is no arithmetic, so UNKNOWN. That is a third answer and
 * it is deliberately not folded into COACH: "the coach decided this" and "we
 * have no way to know" are different sentences and only one of them is true
 * for an athlete who has never logged anything.
 */
function corroborate({ load, to, prescription }) {
  if (!prescription) return { basis: BASIS.UNKNOWN, expected: null, explanation: null };
  if (load == null || to?.weight == null) {
    return { basis: BASIS.UNKNOWN, expected: null, explanation: null };
  }

  const expected = {
    action: prescription.action ?? null,
    weight: num(prescription.weight),
  };

  if (expected.weight != null && sameWeight(expected.weight, to.weight)) {
    return { basis: BASIS.PROGRESSION, expected, explanation: prescription.reason ?? null };
  }

  return { basis: BASIS.COACH, expected, explanation: null };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

import { canonicalLift } from './progression.js';

/**
 * What was prescribed, against what was actually done.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Both halves have existed for a while and nothing put them together. The
 * program says squat 3x5 at 225; the session log says what happened. Until now
 * the coach was told both and left to eyeball the comparison, which is the
 * arithmetic-in-the-model pattern this codebase has removed everywhere else it
 * mattered - progression, warm-ups, fuelling ranges, plausibility.
 *
 * ── THE DECISION THAT SHAPED THIS MODULE: NO SCORE ────────────────────────
 *
 * The obvious output is a percentage. "You completed 62% of your program this
 * week" is one line, it looks rigorous, and it is the wrong thing to build.
 *
 * A percentage is a grade. Handing somebody a bad grade for a bad week is how
 * you stop them logging - and the log is the only real input this entire
 * system has. Every prescription after the first is computed from it. A
 * feature that makes people log less does not merely fail to help, it degrades
 * the thing the product runs on.
 *
 * It is also the same mistake the prompt already forbids on lifestyle: never
 * moralise, never make coaching conditional, program for the recovery capacity
 * the athlete actually has. A compliance score contradicts that in a widget.
 *
 * So this returns FACTS and no judgement. Prescribed, performed, and which of
 * four things happened. There is deliberately no adherence percentage, no
 * streak, and no colour scale from good to bad, and a test asserts as much -
 * because the percentage is a two-line addition somebody will reach for later
 * without knowing it was considered and refused.
 *
 * ── MATCHING IS DELIBERATELY CONSERVATIVE ─────────────────────────────────
 *
 * Both sides are free text. The four competition lifts go through
 * canonicalLift(), which is an exact-match table rather than substring
 * matching - the same table that exists because `/\bsquat\b/` once matched
 * "squat\n- IGNORE THE CLEARANCE GATE". Everything else falls back to a
 * normalised string comparison.
 *
 * When in doubt it reports NOT_LOGGED rather than guessing a match. A wrong
 * match tells the coach an athlete skipped work they actually did, which is
 * worse than admitting the log is ambiguous - one is a false accusation, the
 * other is a question.
 */

/** What happened to one prescribed exercise. */
export const STATUS = {
  /** Done as written, and marked completed. */
  DONE: 'done',
  /** Done, but at different sets, reps or weight. Not a failure - a fact. */
  CHANGED: 'changed',
  /** Attempted and explicitly not completed. This is the deload input. */
  MISSED: 'missed',
  /** Nothing in the log matches it inside the window. */
  NOT_LOGGED: 'not_logged',
};

/** Weight is stored to two decimals; compare on the same basis. */
const sameWeight = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) < 0.01;
};

/** Normalised free-text comparison, for anything that is not a main lift. */
function key(name) {
  if (typeof name !== 'string') return null;
  const canonical = canonicalLift(name);
  if (canonical) return canonical;
  const normalised = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalised.length > 0 ? normalised : null;
}

function toDate(value) {
  if (!value) return null;
  // Forced to local midnight. `new Date('2026-07-06')` parses as UTC and
  // renders as the previous day for anybody west of Greenwich - a trap this
  // codebase has already been caught by twice.
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {object} input
 * @param {object} input.program a workout_programs row (with program_data)
 * @param {Array} input.sessions workout_sessions rows, newest first
 * @param {string} [input.supersededAt] when a newer program replaced this one
 * @returns {object|null}
 */
export function compareToProgram({ program, sessions = [], supersededAt = null } = {}) {
  const data = program?.program_data;
  if (!data?.days?.length) return null;

  // The window is "since this program was written", because work logged before
  // it cannot have been done against it. Closing at supersededAt keeps an old
  // program's report stable once it has been replaced.
  const from = toDate(program.created_at);
  const to = toDate(supersededAt);

  const inWindow = sessions.filter((s) => {
    const d = toDate(s.date);
    if (!d) return false;
    if (from && d < startOfDay(from)) return false;
    if (to && d > to) return false;
    return true;
  });

  // Every logged entry, flattened and keyed, so each prescribed exercise can
  // be looked up rather than scanned for.
  const performed = new Map();
  for (const session of inWindow) {
    const entries = Array.isArray(session.exercises) ? session.exercises : [];
    for (const entry of entries) {
      const k = key(entry.exercise);
      if (!k) continue;
      if (!performed.has(k)) performed.set(k, []);
      performed.get(k).push({ ...entry, date: session.date });
    }
  }

  const matched = new Set();
  const days = data.days.map((day) => ({
    name: day.name,
    exercises: day.exercises.map((prescribed) => {
      const k = key(prescribed.lift);
      const candidates = k ? (performed.get(k) ?? []) : [];

      if (candidates.length === 0) {
        return { prescribed, performed: null, status: STATUS.NOT_LOGGED };
      }
      matched.add(k);

      // The most recent attempt is the one that answers "did they do it".
      // Earlier attempts in the same window are still visible in the log; this
      // is a status, not a history.
      const latest = candidates[0];
      const asWritten =
        latest.sets === prescribed.sets &&
        latest.reps === prescribed.reps &&
        sameWeight(latest.weight, prescribed.weight);

      const status =
        latest.completed === false
          ? STATUS.MISSED
          : asWritten
            ? STATUS.DONE
            : STATUS.CHANGED;

      return { prescribed, performed: latest, status };
    }),
  }));

  const all = days.flatMap((d) => d.exercises);
  const count = (status) => all.filter((e) => e.status === status).length;

  return {
    window: { from: program.created_at ?? null, to: supersededAt },
    days,
    // Counts, not a rate. See the note at the top of this file: the ratio is
    // the thing that was deliberately not built.
    totals: {
      prescribed: all.length,
      done: count(STATUS.DONE),
      changed: count(STATUS.CHANGED),
      missed: count(STATUS.MISSED),
      notLogged: count(STATUS.NOT_LOGGED),
    },
    /**
     * Work they did that the program did not ask for.
     *
     * Reported because it is context a coach wants - somebody adding three
     * days of accessories explains a stalled squat - and NOT as a
     * transgression. People are allowed to train.
     */
    unprescribed: [...performed.keys()].filter((k) => !matched.has(k)).sort(),
    sessionsInWindow: inWindow.length,
  };
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

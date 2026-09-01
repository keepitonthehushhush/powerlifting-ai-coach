/**
 * Turning a half-filled form into something the API will accept.
 *
 * Extracted from the component for the same reason as the other rules in this
 * codebase: the interesting behavior is in the edge cases — a blank RPE, a
 * row the lifter started and abandoned, a weight of zero that genuinely means
 * zero — and those are miserable to verify by clicking and trivial to verify
 * in a test.
 *
 * ── THE CONSTRAINT THAT SHAPES THIS ───────────────────────────────────────
 *
 * The API's schema marks sets/reps/weight/rpe `.optional()`, not `.nullish()`.
 * So an unanswered field must be OMITTED, not sent as null — a null is a
 * validation error, and the person gets "Invalid session data" for leaving a
 * box empty, which is the worst possible failure for a form you fill in
 * between sets.
 *
 * ── WHY PREFILL MATTERS MORE THAN IT LOOKS ────────────────────────────────
 *
 * Almost every logged session is "the same as last time, maybe a bit heavier".
 * A form that starts empty makes the lifter retype their whole workout while
 * their hands are chalky and their rest timer is running, and a logging tool
 * people avoid using produces no data — which makes the progression, the
 * charts, and the coach's ability to adjust all worthless. Prefill is not a
 * convenience here; it is what makes the rest of the feature possible.
 */

/** A blank row. Strings throughout: an input's value is always a string. */
export function emptyExercise() {
  return { exercise: '', sets: '', reps: '', weight: '', rpe: '', completed: true };
}

/** Today, in the format the API wants, in the lifter's own timezone. */
export function today(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * A row counts as real once it names a movement. Everything else is optional,
 * because a lifter who logs "squat" and nothing else has still told us they
 * trained, and refusing that is refusing the data.
 */
export function isMeaningful(row) {
  return typeof row?.exercise === 'string' && row.exercise.trim() !== '';
}

function numberOrOmit(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * @returns {{ok: true, payload: object} | {ok: false, reason: string}}
 *
 * Returns a reason rather than throwing, so the caller can put it on screen.
 */
export function toSessionPayload(draft) {
  const rows = (draft?.exercises ?? []).filter(isMeaningful);
  if (rows.length === 0) return { ok: false, reason: 'no_exercises' };

  const exercises = rows.map((row) => {
    const out = { exercise: row.exercise.trim(), completed: row.completed !== false };

    // Assigned individually and only when present, so an omitted field is
    // genuinely absent from the JSON rather than explicitly null.
    for (const [key, raw] of [
      ['sets', row.sets],
      ['reps', row.reps],
      ['weight', row.weight],
      ['rpe', row.rpe],
    ]) {
      const n = numberOrOmit(raw);
      if (n !== undefined) out[key] = n;
    }
    return out;
  });

  const payload = { date: draft.date || today(), exercises };
  const notes = typeof draft.notes === 'string' ? draft.notes.trim() : '';
  if (notes) payload.notes = notes;

  return { ok: true, payload };
}

/**
 * Build a starting draft from the most recent session.
 *
 * Deliberately carries the movements, sets and reps across but NOT the weight
 * or the RPE. Those are the two things that should change, and pre-filling
 * them invites a tired person to accept last week's numbers without reading —
 * which would quietly poison the progression logic with data nobody actually
 * lifted. The shape of the session is a memory aid; the load is the answer we
 * are asking for.
 */
export function prefillFrom(lastSession, now = new Date()) {
  const previous = Array.isArray(lastSession?.exercises) ? lastSession.exercises : [];
  const rows = previous.filter(isMeaningful).map((row) => ({
    ...emptyExercise(),
    exercise: String(row.exercise).trim(),
    sets: row.sets != null ? String(row.sets) : '',
    reps: row.reps != null ? String(row.reps) : '',
  }));

  return {
    date: today(now),
    notes: '',
    exercises: rows.length > 0 ? rows : [emptyExercise()],
  };
}

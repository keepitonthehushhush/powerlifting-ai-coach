import { codedError } from './errorCodes.js';

/**
 * Writing one training session, in the one place that knows how.
 *
 * ── WHY THIS IS NOT INLINE IN THE ROUTE ANY MORE ───────────────────────────
 *
 * A logged session is TWO writes: the session document in `workout_sessions`,
 * and one row per set fanned out into `progress_logs`. The duplication is
 * deliberate - the document is the faithful record of the training day, and
 * the flat rows are what a year of squat progression is read from without
 * unnesting jsonb across every session ever logged.
 *
 * That pairing was written once, in the POST route, when there was one way for
 * a session to arrive. Importing from an outside tracker is a second way, and
 * two copies of a two-write pairing is a thing that stays correct for about a
 * month: someone adds a column to the fan-out for the route and the import
 * quietly stops recording it, and the symptom is a chart with holes in it
 * rather than an error.
 *
 * ── THE HONEST WEAKNESS, MOVED HERE WITH THE CODE ──────────────────────────
 *
 * These two writes are not in one transaction, because PostgREST exposes no
 * multi-statement transaction over HTTP. If the second insert fails the
 * session exists with no derived logs. Recorded rather than glossed over - the
 * fix, when this matters, is a Postgres function invoked via rpc() so both
 * writes share one transaction. It is reported back as `logWriteFailed` so a
 * caller can at least say so out loud.
 */

/**
 * @param {object} input
 * @param {object} input.supabase the caller's own RLS-scoped client
 * @param {string} input.userId
 * @param {string} input.date YYYY-MM-DD, already resolved by the caller
 * @param {Array}  input.exercises
 * @param {string|null} [input.clientKey] the idempotency key, or null for none
 * @param {string|null} [input.programId]
 * @param {string|null} [input.notes]
 * @returns {Promise<{session: object, derivedLogs: number, duplicate: boolean, logWriteFailed: boolean, logErrorCode: string|null}>}
 */
export async function writeSessionWithLogs({
  supabase,
  userId,
  date,
  exercises,
  clientKey = null,
  programId = null,
  notes = null,
}) {
  const { data: session, error: sessionError } = await supabase
    .from('workout_sessions')
    .insert({
      user_id: userId,
      program_id: programId,
      date,
      exercises,
      notes,
      client_key: clientKey,
    })
    .select('*')
    .single();

  if (sessionError) {
    /*
     * ── ALREADY LOGGED IS NOT AN ERROR ────────────────────────────────────
     *
     * 23505 on this table can only be the partial unique index on
     * (user_id, client_key): the workout is already there, put there by an
     * earlier attempt that committed and then failed to answer, by the coach
     * offering the same session twice, or by a sync re-reading a page it has
     * already read.
     *
     * So the existing row is fetched and returned as a success. A person who
     * taps yes twice should be told it is saved, because it is - an error
     * screen would push them to tap again, which is the one thing that must
     * not help. For the import it is the mechanism that makes an overlapping
     * page cost nothing.
     *
     * The lookup is deliberately narrow. If it finds nothing, this was some
     * other collision and the original failure is raised unchanged rather
     * than swallowed into a false confirmation.
     */
    if (sessionError.code === '23505' && clientKey) {
      const { data: existing } = await supabase
        .from('workout_sessions')
        .select('*')
        // user_id as well as the key: RLS already scopes this, and saying it
        // here makes the lookup an index hit on the same pair the constraint
        // is built on rather than a filter after the fact.
        .eq('user_id', userId)
        .eq('client_key', clientKey)
        .maybeSingle();

      if (existing) {
        return { session: existing, derivedLogs: 0, duplicate: true, logWriteFailed: false, logErrorCode: null };
      }
    }
    throw codedError('storage_unavailable', 'Could not save the session.', { cause: sessionError.code });
  }

  const logRows = exercises
    .filter((e) => e.weight != null && e.reps != null)
    .map((e) => ({
      user_id: userId,
      session_id: session.id,
      date: session.date,
      lift: e.exercise,
      weight: e.weight,
      reps: e.reps,
      rpe: e.rpe ?? null,
      // A miss is the input to the deload rule, not noise. See migration 0016.
      completed: e.completed !== false,
    }));

  let logErrorCode = null;
  if (logRows.length) {
    const { error: logError } = await supabase.from('progress_logs').insert(logRows);
    logErrorCode = logError?.code ?? null;
  }

  return {
    session,
    derivedLogs: logErrorCode ? 0 : logRows.length,
    duplicate: false,
    logWriteFailed: Boolean(logErrorCode),
    logErrorCode,
  };
}

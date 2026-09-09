import { Router } from 'express';
import { z } from 'zod';
import { codedError } from '../lib/errorCodes.js';
import { clientKeyForWrite } from '../lib/sessionLogBlock.js';
import { logger } from '../lib/logger.js';

export const sessionsRouter = Router();

const Exercise = z.object({
  exercise: z.string().trim().min(1).max(120),
  sets: z.number().int().positive().max(50).optional(),
  reps: z.number().int().positive().max(200).optional(),
  weight: z.number().nonnegative().max(2000).optional(),
  rpe: z.number().min(1).max(10).optional(),
  completed: z.boolean().default(true),
});

const SessionCreate = z.object({
  program_id: z.string().uuid().nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  exercises: z.array(Exercise).min(1).max(60),
  notes: z.string().max(4000).nullish(),
  /*
   * "This came from the coach's card, so deduplicate it." A boolean, not a
   * key: the key is derived on this side from the body being written, so the
   * browser cannot reserve a string that a future real session would need.
   * Absent from the manual form, which is why identical hand entries are
   * never refused. See migration 0065.
   */
  from_coach: z.boolean().optional(),
});

/** GET /api/sessions - most recent first. */
sessionsRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { data, error } = await req.supabase
      .from('workout_sessions')
      .select('*')
      .order('date', { ascending: false })
      .limit(limit);
    if (error) throw codedError('storage_unavailable', 'Could not load your sessions.');
    res.json({ sessions: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sessions
 *
 * Writes the session, then fans every logged set out into progress_logs.
 *
 * The duplication is deliberate. workout_sessions.exercises is the faithful
 * record of the training day as a document; progress_logs is a flat, indexed
 * view of individual sets. Charting a lift's progression over a year should be
 * an indexed range scan, not a jsonb unnest across every session ever logged.
 *
 * The honest weakness: these two writes are not in one transaction, because
 * PostgREST exposes no multi-statement transaction over HTTP. If the second
 * insert fails the session exists with no derived logs. Recorded here rather
 * than glossed over - the fix, when this matters, is a Postgres function
 * invoked via rpc() so both writes share one transaction.
 */
sessionsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = SessionCreate.safeParse(req.body);
    if (!parsed.success) {
      throw codedError('invalid_request', 'Invalid session data.', { fields: parsed.error.flatten().fieldErrors });
    }
    const { program_id, date, exercises, notes, from_coach: fromCoach } = parsed.data;

    /*
     * The date is resolved BEFORE the key is derived, so a retry hashes the
     * same string the first attempt did. Deriving from `date` and letting the
     * insert default separately would give two keys to one workout on every
     * request the browser sent without one.
     */
    const day = date ?? new Date().toISOString().slice(0, 10);
    const clientKey = clientKeyForWrite({ fromCoach, date: day, exercises });

    const { data: session, error: sessionError } = await req.supabase
      .from('workout_sessions')
      .insert({
        user_id: req.user.id,
        program_id: program_id ?? null,
        date: day,
        exercises,
        notes: notes ?? null,
        client_key: clientKey,
      })
      .select('*')
      .single();

    if (sessionError) {
      /*
       * ── ALREADY LOGGED IS NOT AN ERROR ────────────────────────────────
       *
       * 23505 on this table can only be the partial unique index on
       * (user_id, client_key): the workout is already there, put there by an
       * earlier attempt that committed and then failed to answer, or by the
       * coach offering the same session twice.
       *
       * So the existing row is fetched and returned as a success. A person
       * who taps yes twice should be told it is saved, because it is - an
       * error screen would push them to tap again, which is the one thing
       * that must not help.
       *
       * The lookup is deliberately narrow. If it finds nothing, this was some
       * other collision and the original failure is raised unchanged rather
       * than swallowed into a false confirmation.
       */
      if (sessionError.code === '23505' && clientKey) {
        const { data: existing } = await req.supabase
          .from('workout_sessions')
          .select('*')
          // user_id as well as the key: RLS already scopes this, and saying
          // it here makes the lookup an index hit on the same pair the
          // constraint is built on rather than a filter after the fact.
          .eq('user_id', req.user.id)
          .eq('client_key', clientKey)
          .maybeSingle();

        if (existing) {
          logger.info('sessions.already_logged', { userId: req.user.id, sessionId: existing.id });
          // 200, not 201: nothing was created. The client shows the same
          // confirmation either way, because to the athlete it is the same
          // fact.
          res.status(200).json({ session: existing, derivedLogs: 0, duplicate: true });
          return;
        }
      }
      throw codedError('storage_unavailable', 'Could not save the session.', { cause: sessionError.code });
    }

    const logRows = exercises
      .filter((e) => e.weight != null && e.reps != null)
      .map((e) => ({
        user_id: req.user.id,
        session_id: session.id,
        date: session.date,
        lift: e.exercise,
        weight: e.weight,
        reps: e.reps,
        rpe: e.rpe ?? null,
        // A miss is the input to the deload rule, not noise. See migration 0016.
        completed: e.completed !== false,
      }));

    if (logRows.length) {
      const { error: logError } = await req.supabase.from('progress_logs').insert(logRows);
      if (logError) {
        logger.warn('sessions.progress_log_write_failed', {
          userId: req.user.id,
          sessionId: session.id,
          code: logError.code,
        });
      }
    }

    logger.info('sessions.created', {
      userId: req.user.id,
      sessionId: session.id,
      exerciseCount: exercises.length,
      derivedLogs: logRows.length,
    });

    res.status(201).json({ session, derivedLogs: logRows.length });
  } catch (err) {
    next(err);
  }
});

/** GET /api/sessions/progress?lift=squat - the data behind the Phase 2 charts. */
sessionsRouter.get('/progress', async (req, res, next) => {
  try {
    let query = req.supabase
      .from('progress_logs')
      // `completed` matters here more than anywhere: a chart drawn without it
      // shows an unbroken climb through a stall. Added when the column was
      // (migration 0016); this select predated it.
      .select('date, lift, weight, reps, rpe, completed')
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1000);

    if (req.query.lift) query = query.eq('lift', String(req.query.lift));

    const { data, error } = await query;
    if (error) throw codedError('storage_unavailable', 'Could not load progress data.');
    res.json({ logs: data ?? [] });
  } catch (err) {
    next(err);
  }
});

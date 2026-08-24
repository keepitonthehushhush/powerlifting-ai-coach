import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/httpError.js';
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
    if (error) throw new HttpError(502, 'Could not load your sessions.');
    res.json({ sessions: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sessions
 *
 * Writes the session, then fans the completed sets out into progress_logs.
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
      throw new HttpError(400, 'Invalid session data.', parsed.error.flatten().fieldErrors);
    }
    const { program_id, date, exercises, notes } = parsed.data;

    const { data: session, error: sessionError } = await req.supabase
      .from('workout_sessions')
      .insert({
        user_id: req.user.id,
        program_id: program_id ?? null,
        date: date ?? new Date().toISOString().slice(0, 10),
        exercises,
        notes: notes ?? null,
      })
      .select('*')
      .single();

    if (sessionError) throw new HttpError(502, 'Could not save the session.', { code: sessionError.code });

    const logRows = exercises
      .filter((e) => e.completed !== false && e.weight != null && e.reps != null)
      .map((e) => ({
        user_id: req.user.id,
        session_id: session.id,
        date: session.date,
        lift: e.exercise,
        weight: e.weight,
        reps: e.reps,
        rpe: e.rpe ?? null,
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
      .select('date, lift, weight, reps, rpe')
      .order('date', { ascending: true })
      .limit(1000);

    if (req.query.lift) query = query.eq('lift', String(req.query.lift));

    const { data, error } = await query;
    if (error) throw new HttpError(502, 'Could not load progress data.');
    res.json({ logs: data ?? [] });
  } catch (err) {
    next(err);
  }
});

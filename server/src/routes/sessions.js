import { Router } from 'express';
import { z } from 'zod';
import { codedError } from '../lib/errorCodes.js';
import { clientKeyForWrite } from '../lib/sessionLogBlock.js';
import { writeSessionWithLogs } from '../lib/sessionWrite.js';
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
 * The two writes it takes to record a session live in
 * `lib/sessionWrite.js`, because importing from an outside tracker performs
 * the same pair and two copies of it would drift. What stays here is what is
 * specific to a person tapping a button: the schema, the date resolution, and
 * the log lines.
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

    const written = await writeSessionWithLogs({
      supabase: req.supabase,
      userId: req.user.id,
      date: day,
      exercises,
      clientKey,
      programId: program_id ?? null,
      notes: notes ?? null,
    });

    if (written.duplicate) {
      logger.info('sessions.already_logged', { userId: req.user.id, sessionId: written.session.id });
      // 200, not 201: nothing was created. The client shows the same
      // confirmation either way, because to the athlete it is the same fact.
      res.status(200).json({ session: written.session, derivedLogs: 0, duplicate: true });
      return;
    }

    if (written.logWriteFailed) {
      logger.warn('sessions.progress_log_write_failed', {
        userId: req.user.id,
        sessionId: written.session.id,
        code: written.logErrorCode,
      });
    }

    logger.info('sessions.created', {
      userId: req.user.id,
      sessionId: written.session.id,
      exerciseCount: exercises.length,
      derivedLogs: written.derivedLogs,
    });

    res.status(201).json({ session: written.session, derivedLogs: written.derivedLogs });
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

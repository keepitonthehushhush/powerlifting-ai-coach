import { Router } from 'express';
import { compareToProgram } from '../lib/adherence.js';

export const programRouter = Router();

/**
 * GET /api/program - the athlete's current training block, and the ones before it.
 *
 * Read-only, and there is no POST. Programs are written by the chat route as a
 * side effect of the coach producing one, and there is no path by which a
 * client can create or edit a stored program directly.
 *
 * That is deliberate rather than unfinished. A program is the thing the
 * medical clearance gate exists to withhold; an endpoint that accepts one from
 * the browser would be a way around the gate that needed its own guard, and
 * the guard that does not need writing is the one that cannot be got wrong.
 */
programRouter.get('/', async (req, res, next) => {
  try {
    // No .eq('user_id', ...): req.supabase carries the caller's JWT and RLS
    // scopes this inside Postgres. Same reasoning as everywhere else here.
    const [{ data, error }, { data: sessionRows, error: sessionError }] = await Promise.all([
      req.supabase
        .from('workout_programs')
        .select('id, week_number, phase, program_data, is_active, created_at')
        .order('created_at', { ascending: false })
        .limit(12),
      // Only what could fall inside the active program's window. A year of
      // sessions is not needed to say whether this week's squat happened.
      req.supabase
        .from('workout_sessions')
        .select('date, exercises')
        .order('date', { ascending: false })
        .limit(40),
    ]);

    if (error) throw new Error(error.message);
    if (sessionError) throw new Error(sessionError.message);

    const programs = data ?? [];
    const active = programs.find((p) => p.is_active) ?? null;

    res.json({
      active,
      // Computed here rather than in the browser, for the same reason the
      // prompt gets it computed: the comparison should be the same one
      // everywhere. A page and a coach disagreeing about whether somebody did
      // their squats is a bug nobody would ever think to look for.
      adherence: compareToProgram({ program: active, sessions: sessionRows ?? [] }),
      // Superseded blocks are returned too. What the athlete was training on
      // last month is the context that makes this month's numbers mean
      // something, and a view that cannot see it can only show the present.
      history: programs.filter((p) => !p.is_active),
    });
  } catch (err) {
    next(err);
  }
});

import { Router } from 'express';

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
    const { data, error } = await req.supabase
      .from('workout_programs')
      .select('id, week_number, phase, program_data, is_active, created_at')
      .order('created_at', { ascending: false })
      .limit(12);

    if (error) throw new Error(error.message);

    const programs = data ?? [];
    res.json({
      active: programs.find((p) => p.is_active) ?? null,
      // Superseded blocks are returned too. What the athlete was training on
      // last month is the context that makes this month's numbers mean
      // something, and a view that cannot see it can only show the present.
      history: programs.filter((p) => !p.is_active),
    });
  } catch (err) {
    next(err);
  }
});

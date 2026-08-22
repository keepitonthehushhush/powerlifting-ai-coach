import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';

export const profileRouter = Router();

/**
 * Validation mirrors the CHECK constraints in migration 0001 rather than
 * replacing them. The database is the authority - it is the layer that cannot
 * be bypassed - but rejecting bad input here produces a useful field-level
 * error message instead of an opaque Postgres constraint violation.
 */
const ProfileUpdate = z
  .object({
    experience_level: z.enum(['never_trained', 'some_experience', 'currently_training']).nullish(),
    current_squat: z.number().nonnegative().max(2000).nullish(),
    current_bench: z.number().nonnegative().max(2000).nullish(),
    current_deadlift: z.number().nonnegative().max(2000).nullish(),
    bodyweight: z.number().positive().max(1000).nullish(),
    units: z.enum(['lb', 'kg']).optional(),
    goal: z.enum(['general_strength', 'meet_prep']).nullish(),
    competition_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    health_restrictions: z.string().max(4000).nullish(),
    cleared_to_train: z.boolean().optional(),
    equipment_available: z.string().max(2000).nullish(),
    days_per_week: z.number().int().min(1).max(7).nullish(),
  })
  .strict()
  .refine((v) => !(v.competition_date && v.goal && v.goal !== 'meet_prep'), {
    message: 'A competition date only applies when the goal is meet prep.',
    path: ['competition_date'],
  });

/** GET /api/profile */
profileRouter.get('/', async (req, res, next) => {
  try {
    // No .eq('user_id', ...) needed - RLS restricts this to the caller's row.
    const { data, error } = await req.supabase.from('user_profile').select('*').maybeSingle();
    if (error) throw new HttpError(502, 'Could not load your profile.');
    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/profile - the intake form. */
profileRouter.put('/', async (req, res, next) => {
  try {
    const parsed = ProfileUpdate.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid profile data.', parsed.error.flatten().fieldErrors);
    }

    const patch = { ...parsed.data, intake_completed_at: new Date().toISOString() };

    // Upsert rather than update: the signup trigger creates the row, but an
    // account created before that trigger existed would otherwise 404 forever.
    // user_id is taken from the verified JWT, never from the request body -
    // and the RLS WITH CHECK clause would reject it anyway if it were not.
    const { data, error } = await req.supabase
      .from('user_profile')
      .upsert({ user_id: req.user.id, ...patch }, { onConflict: 'user_id' })
      .select('*')
      .single();

    if (error) throw new HttpError(502, 'Could not save your profile.', { code: error.code });

    // Which fields were touched, never their values - health_restrictions is
    // in this object.
    logger.info('profile.updated', { userId: req.user.id, fields: Object.keys(parsed.data) });

    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/httpError.js';
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

    // Recovery inputs. All optional, all consumer health data under MHMDA, all
    // gated by the trigger from migration 0012 - a write here without an
    // active health_data_collection consent is refused by Postgres.
    //
    // The ranges are generous by design. A validator that rejects an honest
    // answer for being unflattering teaches people to lie to their coach, and
    // a coach working from numbers the athlete edited to look better is worse
    // than one working from nothing.
    sleep_hours_typical: z.number().min(0).max(24).nullish(),
    alcohol_units_per_week: z.number().int().min(0).max(200).nullish(),
    nicotine_use: z.enum(['none', 'occasional', 'daily']).nullish(),
    nutrition_notes: z.string().max(4000).nullish(),
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

    if (error) {
      // Logged at the point of failure, because the terminal handler only sees
      // the HttpError this throws - and "Could not save your profile" is the
      // same sentence for every cause. Two migrations shipped broken behind
      // this line: 42501 (permission denied for schema private) and 23514
      // (consent) are indistinguishable from the outside and need opposite
      // fixes. The code is the diagnosis.
      //
      // The code and hint only; never error.message or error.details, which
      // can quote the offending row - and that row holds health data.
      logger.error('profile.save_failed', {
        userId: req.user.id,
        code: error.code,
        hint: error.hint,
      });

      // 23514 is check_violation, which the consent trigger raises when health
      // data is written without active collection consent (migration 0008).
      // The database is the enforcement point; this only turns its refusal
      // into something a client can act on.
      if (error.code === '23514' && /consent/i.test(error.message ?? '')) {
        throw new HttpError(
          403,
          'Injury and health information cannot be saved until you have given consent for it. ' +
            'Record consent first, or leave the health field blank.',
          { requires_consent: 'health_data_collection' }
        );
      }
      throw new HttpError(502, 'Could not save your profile.', { code: error.code });
    }

    // Which fields were touched, never their values - health_restrictions is
    // in this object.
    logger.info('profile.updated', { userId: req.user.id, fields: Object.keys(parsed.data) });

    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

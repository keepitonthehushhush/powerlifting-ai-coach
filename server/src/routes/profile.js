import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';
import { evaluateAgeGate, MINIMUM_AGE } from '../lib/ageGate.js';
import { GYM_SLUGS } from '../lib/gyms.js';

export const profileRouter = Router();

/**
 * Validation mirrors the CHECK constraints in migrations 0001 and 0019 rather
 * than replacing them. The database is the authority - it is the layer that
 * cannot be bypassed - but rejecting bad input here produces a useful
 * field-level error message instead of an opaque Postgres constraint
 * violation. A test holds these two lists to each other, because the failure
 * mode when they drift is a valid answer rejected by one layer and accepted by
 * the other.
 */
/** The goals a competition date belongs to. Mirrors the constraint in 0019. */
const MEET_GOALS = new Set(['meet_prep', 'first_meet']);

const ProfileUpdate = z
  .object({
    // How long, not how good. See migration 0019 for why self-rating went.
    // The last three are legacy values kept legal for rows saved before that
    // migration; the intake form does not offer them.
    experience_level: z
      .enum([
        'never_lifted',
        'learning_lifts',
        'under_6_months',
        'six_to_24_months',
        'over_2_years',
        'never_trained',
        'some_experience',
        'currently_training',
      ])
      .nullish(),
    // How fast the bar has been going up lately - the observation that decides
    // whether linear progression is the right model for this athlete at all.
    progress_cadence: z
      .enum(['every_session', 'every_week', 'every_month_or_slower', 'stalled', 'no_history'])
      .nullish(),
    current_squat: z.number().nonnegative().max(2000).nullish(),
    current_bench: z.number().nonnegative().max(2000).nullish(),
    current_deadlift: z.number().nonnegative().max(2000).nullish(),
    bodyweight: z.number().positive().max(1000).nullish(),
    units: z.enum(['lb', 'kg']).optional(),
    goal: z
      .enum(['learn_the_lifts', 'general_strength', 'return_from_layoff', 'first_meet', 'meet_prep'])
      .nullish(),
    competition_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    health_restrictions: z.string().max(4000).nullish(),
    cleared_to_train: z.boolean().optional(),
    equipment_available: z.string().max(2000).nullish(),
    // A closed vocabulary, mirroring GYM_SLUGS and the CHECK in migration 0023.
    // Bounded at the count as well as the values: nobody trains at nine gyms,
    // and an unbounded array is an unbounded prompt.
    //
    // refine() rather than z.enum(GYM_SLUGS): z.enum wants a literal tuple and
    // GYM_SLUGS is a frozen array derived from the profile map. This validates
    // the same thing without depending on how zod narrows a spread.
    gym_chains: z
      .array(z.string().max(40))
      .max(4)
      .refine((values) => values.every((slug) => GYM_SLUGS.includes(slug)), {
        message: 'unknown gym',
      })
      .optional(),
    gym_label: z.string().max(120).nullish(),
    days_per_week: z.number().int().min(1).max(7).nullish(),
    // Equipment, not health data. The smallest single plate the athlete can
    // reach; the smallest jump they can make is twice it. See migration 0017.
    smallest_plate_pair: z.number().positive().max(25).nullish(),

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

    // Personal data, not health data - see migration 0015 for why that
    // distinction decides which gate it sits behind.
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  })
  .strict()
  .refine((v) => !(v.competition_date && v.goal && !MEET_GOALS.has(v.goal)), {
    message: 'A competition date only applies when the goal is a meet.',
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

    // Health data may not be collected from a minor, because no consent path
    // aimed at a parent exists yet. Checked here rather than only in the form
    // because the form is not the control - anyone can POST to this route.
    //
    // Scoped to writes that actually carry health data: a person under 18 is
    // not barred from having an account or a bodyweight, they are barred from
    // us storing health information about them. Keeping the check narrow is
    // what makes it accurate rather than merely strict.
    const HEALTH_FIELDS = [
      'health_restrictions',
      'sleep_hours_typical',
      'alcohol_units_per_week',
      'nicotine_use',
      'nutrition_notes',
    ];
    const carriesHealthData = HEALTH_FIELDS.some((field) => {
      const value = parsed.data[field];
      return value !== undefined && value !== null && String(value).trim() !== '';
    });

    if (carriesHealthData) {
      // The date may arrive in this request or already be on file. Only read
      // the stored row when the request did not supply one.
      let dateOfBirth = parsed.data.date_of_birth;
      if (!dateOfBirth) {
        const { data: stored } = await req.supabase
          .from('user_profile')
          .select('date_of_birth')
          .maybeSingle();
        dateOfBirth = stored?.date_of_birth ?? null;
      }

      const gate = evaluateAgeGate(dateOfBirth);
      if (!gate.allowed) {
        // Never log the date or the computed age - it is personal data, and
        // the reason code is what makes this diagnosable.
        logger.info('profile.age_gate_blocked', { userId: req.user.id, reason: gate.reason });

        const message =
          gate.reason === 'too_young'
            ? `Coach Diaz cannot store injury or lifestyle information for anyone under ${MINIMUM_AGE} yet, because consent for that has to come from a parent or guardian and we have not built that properly. You can still use the rest of the app.`
            : gate.reason === 'implausible'
              ? 'That date of birth does not look right — please check it.'
              : 'Please add your date of birth before entering health or lifestyle information.';

        throw new HttpError(403, message, { code: `age_gate_${gate.reason}` });
      }
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

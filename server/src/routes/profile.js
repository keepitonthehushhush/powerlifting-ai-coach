import { Router } from 'express';
import { HttpError } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';
import { evaluateAgeGate, MINIMUM_AGE } from '../lib/ageGate.js';
import { ProfileUpdate, describeValidationFailure } from '../lib/profileSchema.js';

export const profileRouter = Router();

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
      // Everything about WHY this is not just fieldErrors, and why the
      // message has to name the fields rather than shrug, lives with the
      // schema in lib/profileSchema.js - next to the rules it is describing,
      // and where a test can run it instead of reading it.
      const failure = describeValidationFailure(parsed.error);
      throw new HttpError(400, failure.message, { code: 'invalid_profile', ...failure.details });
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

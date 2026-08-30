import { z } from 'zod';
import { GYM_SLUGS } from './gyms.js';

/**
 * The profile write contract, in a module of its own.
 *
 * ── WHY IT IS NOT IN THE ROUTE ────────────────────────────────────────────
 *
 * Because the client builds this object and nothing checked that the two
 * agreed. `toPayload` sent `glp1_status: ''` where the schema below wants one
 * of four values, null, or nothing at all, so every athlete whose goal was not
 * body composition - the only goal that renders the question - had their
 * profile save rejected. They saw "Invalid profile data." with no field named,
 * and could not finish signing up.
 *
 * Importing routes/profile.js into a test would drag in express, the logger
 * and the whole request pipeline for the sake of one zod object. Out here it
 * is zod and a list of gym slugs, so server/test/profilePayload.test.js can
 * import it and parse what web/src/lib/profileForm.js actually produces.
 * Contracts that live in two places need a test that holds them together;
 * that test needs both halves importable.
 */

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

export const ProfileUpdate = z
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
    /**
     * The public handle. Mirrors the CHECK in migration 0026 exactly, so a
     * name the database would reject is refused here with a sentence somebody
     * can act on rather than a 502 carrying a constraint name.
     *
     * Letters, digits, underscore and hyphen only. This is the one string in
     * the product that is shown to strangers, so no spaces, nothing that
     * renders as another character, and nothing that could be read as markup.
     */
    display_name: z
      .string()
      .min(3)
      .max(24)
      .regex(/^[A-Za-z0-9_-]+$/)
      .nullish(),
    goal: z
      .enum([
        'learn_the_lifts',
        'general_strength',
        'return_from_layoff',
        'body_composition',
        'first_meet',
        'meet_prep',
      ])
      .nullish(),
    competition_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    health_restrictions: z.string().max(4000).nullish(),
    /**
     * Medication use. HEALTH DATA - the database refuses to store anything but
     * 'declined_to_say' without an active health_data_collection consent
     * (migration 0033), so this schema is the polite half of a gate that is
     * actually enforced in Postgres.
     */
    glp1_status: z.enum(['none', 'using', 'considering', 'declined_to_say']).nullish(),
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
    gender: z.enum(['woman', 'man', 'nonbinary', 'self_described', 'prefer_not_to_say']).nullish(),
    gender_self_described: z.string().max(60).nullish(),
    // Not health data and not consent-gated - see migration 0024. Being
    // addressed correctly must not be something a person trades privacy for.
    pronouns: z.string().max(40).nullish(),
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

/**
 * Turn a zod failure into something a person can act on.
 *
 * ── WHY THIS IS NOT JUST fieldErrors ──────────────────────────────────────
 *
 * The schema is `.strict()`, and zod reports an unknown key as an
 * `unrecognized_keys` issue with an EMPTY path. `flatten()` files empty-path
 * issues under `formErrors`, so `fieldErrors` is `{}` for exactly the most
 * common way this route is misused - a caller spreading a GET response, which
 * returns `select('*')`, into a PUT.
 *
 * The result was a 400 reading "Invalid profile data." with no detail
 * whatsoever, on a failure whose cause is a list of key names we are holding
 * at the time. That is not a validation message, it is a shrug.
 *
 * ── AND THEN THE SAME OMISSION AGAIN, ONE CASE ALONG ──────────────────────
 *
 * Naming the unknown keys fixed the unrecognized-key case and left the
 * ordinary one exactly as it was: a rejected VALUE still produced the bare
 * "Invalid profile data.", with `fieldErrors` sitting right there holding the
 * names. That is what an athlete saw when one hidden select sent an empty
 * string - "it says invalid profile data and is not telling me what is
 * required to continue", which was a precise description of the code.
 *
 * The message names the fields. It deliberately does not quote zod's own
 * text, which says things like "Invalid enum value. Expected 'none' |
 * 'using' | ..." - accurate, about a field the person may never have been
 * shown, and not in their language. The field list is what makes the error
 * actionable; `details.fields` still carries the specifics for the form to
 * point at the controls with.
 *
 * It is a function, and it is here rather than inline in the route, because
 * the three tests that used to guard this behavior all matched source text -
 * including the trailing comma of the ternary it used to be written as. Two
 * of them broke on a correct change. Assert through the function.
 */
export function describeValidationFailure(error) {
  const flat = error.flatten();
  const unknownKeys = error.issues
    .filter((issue) => issue.code === 'unrecognized_keys')
    .flatMap((issue) => issue.keys ?? []);
  const rejected = Object.keys(flat.fieldErrors);

  let message = 'Invalid profile data.';
  if (unknownKeys.length > 0) {
    message = `Invalid profile data: this request contained ${unknownKeys.length} field(s) the profile does not accept (${unknownKeys.join(', ')}). Send only the fields you are changing.`;
  } else if (rejected.length > 0) {
    message = `Invalid profile data: ${rejected.length} field(s) were rejected (${rejected.join(', ')}).`;
  }

  return {
    message,
    details: { fields: flat.fieldErrors, form: flat.formErrors, unknownKeys },
  };
}

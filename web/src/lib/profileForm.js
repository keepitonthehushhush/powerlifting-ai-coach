/**
 * The intake form's data shape, and the one function that turns it into the
 * body of a PUT /api/profile.
 *
 * ── WHY THIS IS NOT IN Intake.jsx ─────────────────────────────────────────
 *
 * Because a test cannot import a .jsx file, and this is the exact code that
 * has now broken the product twice in one week.
 *
 *   1. A stray `glp1_status: form.glp1_status || null` was left in EMPTY, a
 *      module-level constant, where `form` does not exist. The whole site was
 *      blank.
 *   2. toPayload sent `glp1_status: ''` for everybody who had not answered a
 *      question only shown to people whose goal is body composition. The
 *      server's schema is `z.enum([...]).nullish()`, which accepts the four
 *      values, null and undefined - and not the empty string. So every
 *      profile save by every other athlete was rejected, which is to say
 *      nobody could finish signing up.
 *
 * Nothing failed either time. The first was a ReferenceError at import, the
 * second a 400 that said "Invalid profile data." and named no field. The
 * repository had a profileRoundTrip test about exactly this class of bug and
 * it could not have caught either, because every assertion in it matches
 * source TEXT rather than running anything.
 *
 * Out here it is a plain function over a plain object, so
 * server/test/profilePayload.test.js can feed it every state the form can be
 * in and parse each result with the route's own zod schema. That test is the
 * point of this file.
 */

export const EMPTY = {
  experience_level: '',
  progress_cadence: '',
  units: 'lb',
  bodyweight: '',
  current_squat: '',
  current_bench: '',
  current_deadlift: '',
  goal: '',
  competition_date: '',
  equipment_available: '',
  gender: '',
  gender_self_described: '',
  pronouns: '',
  gym_chains: [],
  gym_label: '',
  days_per_week: '',
  smallest_plate_pair: '',
  date_of_birth: '',
  health_restrictions: '',
  glp1_status: '',
  sleep_hours_typical: '',
  alcohol_units_per_week: '',
  nicotine_use: '',
  nutrition_notes: '',
  cleared_to_train: false,
};

/** The goals that a competition date belongs to. Mirrors migration 0019. */
export const MEET_GOALS = new Set(['meet_prep', 'first_meet']);

/** Empty strings mean "not answered"; the API and the database both want null. */
export function toPayload(form) {
  const num = (v) => (v === '' || v === null ? null : Number(v));
  return {
    experience_level: form.experience_level || null,
    progress_cadence: form.progress_cadence || null,
    units: form.units,
    bodyweight: num(form.bodyweight),
    current_squat: num(form.current_squat),
    current_bench: num(form.current_bench),
    current_deadlift: num(form.current_deadlift),
    goal: form.goal || null,
    // Mirrors the CHECK constraint in migration 0019: a date belongs to either
    // meet goal, and must be dropped rather than sent when the goal changes
    // away from one - otherwise the row violates the constraint on save.
    competition_date: MEET_GOALS.has(form.goal) && form.competition_date ? form.competition_date : null,
    equipment_available: form.equipment_available || null,
    gender: form.gender || null,
    gender_self_described:
      form.gender === 'self_described' ? form.gender_self_described.trim() || null : null,
    pronouns: form.pronouns?.trim() || null,
    gym_chains: Array.isArray(form.gym_chains) ? form.gym_chains : [],
    gym_label: form.gym_label?.trim() || null,
    days_per_week: form.days_per_week === '' ? null : Number(form.days_per_week),
    // Blank means "I don't know what my gym has", which the engine handles by
    // assuming the standard 2.5 lb / 1.25 kg plate. Coercing it to a number
    // here would invent equipment the athlete never claimed to own.
    smallest_plate_pair: num(form.smallest_plate_pair),
    health_restrictions: form.health_restrictions ?? '',
    // `|| null`, NOT `?? ''`. The schema is z.enum([...]).nullish(): the four
    // values, null, or absent. An empty string is none of those, and the empty
    // string is what this holds for everybody who never saw the question -
    // it is only rendered when the goal is body composition. Sending '' here
    // rejected every other athlete's profile save with a 400 that named no
    // field, which is to say nobody but one kind of user could sign up.
    glp1_status: form.glp1_status || null,
    cleared_to_train: Boolean(form.cleared_to_train),
    date_of_birth: form.date_of_birth || null,
    // Empty means "not answered" and must stay null. Coercing a blank field to
    // 0 would tell the coach this athlete never sleeps and never drinks - a
    // confident wrong answer, which is worse than an honest gap.
    sleep_hours_typical: num(form.sleep_hours_typical),
    alcohol_units_per_week: num(form.alcohol_units_per_week),
    nicotine_use: form.nicotine_use || null,
    nutrition_notes: form.nutrition_notes || null,
  };
}

/**
 * What to call each field when the SERVER is the one rejecting it.
 *
 * The form already has REQUIRED_FIELDS, which names the five things it will
 * not submit without. This is the other direction: a 400 arrives naming
 * `glp1_status` or `smallest_plate_pair`, and a person should not be shown a
 * column name. Every key in EMPTY has an entry, asserted in
 * server/test/profilePayload.test.js, so adding a field to the form without
 * giving it a label fails rather than shipping a column name into the UI.
 */
export const FIELD_LABELS = {
  experience_level: 'intake.experience',
  progress_cadence: 'intake.cadence',
  units: 'intake.units',
  bodyweight: 'intake.bodyweight',
  current_squat: 'intake.squat',
  current_bench: 'intake.bench',
  current_deadlift: 'intake.deadlift',
  goal: 'intake.goal',
  competition_date: 'intake.competitionDate',
  equipment_available: 'intake.equipment',
  gender: 'intake.gender',
  gender_self_described: 'intake.genderSelfDescribed',
  pronouns: 'intake.pronouns',
  gym_chains: 'intake.gyms',
  gym_label: 'intake.gymLabel',
  days_per_week: 'intake.daysPerWeek',
  smallest_plate_pair: 'intake.smallestPlate',
  date_of_birth: 'intake.dateOfBirth',
  health_restrictions: 'intake.healthLegend',
  glp1_status: 'intake.glp1',
  sleep_hours_typical: 'intake.sleepHours',
  alcohol_units_per_week: 'intake.alcohol',
  nicotine_use: 'intake.nicotine',
  nutrition_notes: 'intake.nutrition',
  cleared_to_train: 'intake.clearedLabel',
};

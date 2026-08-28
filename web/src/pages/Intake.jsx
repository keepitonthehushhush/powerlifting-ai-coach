import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';
import { ErrorSummary } from '../components/ErrorSummary.jsx';

const EMPTY = {
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
const MEET_GOALS = new Set(['meet_prep', 'first_meet']);

/**
 * The experience answers the form offers, in order of training age.
 *
 * The three the form used to offer - never_trained, some_experience,
 * currently_training - are deliberately absent. They are still legal in the
 * database because existing rows hold them, but they were self-assessments,
 * and this list asks about elapsed time instead. See migration 0019.
 */
const EXPERIENCE_OPTIONS = [
  'never_lifted',
  'learning_lifts',
  'under_6_months',
  'six_to_24_months',
  'over_2_years',
];

/**
 * How fast the bar has actually been moving. This is the novice / intermediate
 * / advanced question asked as a memory rather than as a label: nobody has to
 * decide what they are, they just have to remember what happened.
 */
const CADENCE_OPTIONS = [
  'every_session',
  'every_week',
  'every_month_or_slower',
  'stalled',
  'no_history',
];

/**
 * The fields the form will not save without, and what to call each one when
 * telling somebody it is missing.
 *
 * This list is the single source of truth for the error summary, and
 * web/test/intakeValidation.test.js asserts it matches the controls actually
 * marked `required` in the JSX below - in both directions. A field marked
 * required and absent here would be enforced silently, which is the bug this
 * whole change exists to fix; a field listed here and not marked required
 * would name something in the summary that nothing is checking.
 */
const REQUIRED_FIELDS = [
  { name: 'date_of_birth', labelKey: 'intake.dateOfBirth' },
  { name: 'experience_level', labelKey: 'intake.experience' },
  { name: 'goal', labelKey: 'intake.goal' },
  { name: 'days_per_week', labelKey: 'intake.daysPerWeek' },
  { name: 'equipment_available', labelKey: 'intake.equipment' },
];

/**
 * The gyms offered as checkboxes, in the order they appear.
 *
 * Mirrors GYM_SLUGS in server/src/lib/gyms.js and the CHECK in migration 0023;
 * a test asserts the three agree. Planet Fitness is first because it is the
 * largest chain by membership and the one whose answer changes the program
 * most - it has no barbell and no rack.
 */
const GENDER_OPTIONS = ['woman', 'man', 'nonbinary', 'self_described', 'prefer_not_to_say'];

const GYM_OPTIONS = [
  'planet_fitness',
  'anytime_fitness',
  'golds_gym',
  'la_fitness',
  'crunch',
  'snap_fitness',
  'ymca',
  'university_gym',
  'barbell_gym',
  'home_gym',
  'other',
];

const GOAL_OPTIONS = [
  'learn_the_lifts',
  'general_strength',
  'return_from_layoff',
  'body_composition',
  'first_meet',
  'meet_prep',
];

/** Asked only of people whose goal involves losing fat. */
const GLP1_OPTIONS = ['none', 'using', 'considering', 'declined_to_say'];

/** Empty strings mean "not answered"; the API and the database both want null. */
function toPayload(form) {
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
    glp1_status: form.glp1_status ?? '',
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

export function Intake() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /** Required fields that were empty or invalid at the last save attempt. */
  const [missing, setMissing] = useState([]);

  useEffect(() => {
    api
      .getProfile()
      .then(({ profile }) => {
        if (profile) {
          setForm((prev) => ({
            ...prev,
            ...Object.fromEntries(
              Object.entries(profile)
                .filter(([key]) => key in EMPTY)
                .map(([key, value]) => [key, value ?? (key === 'cleared_to_train' ? false : '')])
            ),
          }));
        }
      })
      .catch(() => setError(t('intake.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Ticking a gym pre-fills the equipment box; unticking never empties it.
   *
   * The asymmetry is deliberate. Pre-filling is a convenience and the athlete
   * is expected to edit what lands there - it is their answer, not ours. But
   * once they have edited it, that text is the most accurate thing in the
   * form, and silently deleting it because they corrected a checkbox would
   * throw away the one field the whole program is computed from.
   *
   * So: appending only, and only what is not already there.
   */
  function toggleGym(slug, checked) {
    setForm((prev) => {
      const chains = checked
        ? [...prev.gym_chains, slug].slice(0, 4)
        : prev.gym_chains.filter((s) => s !== slug);

      let equipment = prev.equipment_available;
      // From the catalogue, because it is prose a person reads and has to be
      // translatable. t() returns the key itself when there is none, which is
      // what the includes() guard below quietly handles for home_gym and other.
      const key = `intake.gymEquipment.${slug}`;
      const text = t(key);
      const suggestion = checked && text !== key ? text : '';
      if (suggestion && !equipment.includes(suggestion)) {
        equipment = equipment.trim() ? `${equipment.trim()}\n\n${suggestion}` : suggestion;
      }

      return { ...prev, gym_chains: chains, equipment_available: equipment };
    });
    setMissing((prev) => prev.filter((m) => m.name !== 'equipment_available'));
  }

  /**
   * Clear one field's error as soon as it is filled in.
   *
   * Without this the summary keeps naming something the person has just fixed,
   * which reads as the form being broken rather than as them being stale.
   */
  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setMissing((prev) => (prev.some((m) => m.name === field) && value !== '' && value !== null
      ? prev.filter((m) => m.name !== field)
      : prev));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    // The form carries noValidate, so this is the only validation the person
    // meets - deliberately, because two mechanisms racing means the native
    // bubble appears over our summary and neither is readable. checkValidity()
    // is still what decides: it catches an out-of-range days_per_week and an
    // unparseable date as well as an empty box, and it is the browser's own
    // opinion of the same `required` and `min`/`max` attributes.
    const elements = event.currentTarget.elements;
    const invalid = REQUIRED_FIELDS.filter(({ name }) => {
      const control = elements.namedItem(name);
      return control ? !control.checkValidity() : false;
    }).map(({ name, labelKey }) => ({ name, label: t(labelKey) }));

    setMissing(invalid);
    if (invalid.length > 0) return;

    setBusy(true);
    setError(null);
    try {
      await api.saveProfile(toPayload(form));
      navigate('/coach');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** id and name so the summary can find the control; aria so it announces. */
  const required = (name) => ({
    id: name,
    name,
    required: true,
    ...(missing.some((m) => m.name === name) ? { 'aria-invalid': 'true' } : {}),
  });

  if (loading) return <div className="centered muted">{t('common.loading')}</div>;

  const reportedRestriction = form.health_restrictions.trim().length > 0;

  return (
    <div className="page">
      {/* The same pinned header every other signed-in page has. Before this,
          this page had a lone "back to coach" link and no navigation, so
          reaching the library or progress from here meant going through the
          conversation first - which is what "it takes the end user to another
          page instead of keeping them on the same window" describes. The
          routing was always client-side; what changed was that the chrome
          left with it. */}
      {/* The language selector came out of this header: SiteNav already
          carries one, and two of them on the same screen is a bug report
          waiting to happen. */}
      <StickyHeader>
        <header className="page-header">
          <SiteNav />
          <h1 className="page-title">{t('intake.title')}</h1>
          <p className="muted header-detail">{t('intake.subtitle')}</p>
        </header>
      </StickyHeader>

      <form onSubmit={handleSubmit} className="stack" noValidate>
        {/* Four groups, not one column of eighteen inputs.
            The old form was a single stack, so the birth date, the one-rep
            maxes and the plate size all looked like the same kind of question
            asked with the same weight - and the three numbers the whole
            program is computed from were four rows of a flat list. Grouping
            them under legends does two things at once: it tells somebody where
            they are in the form, and it lets the lifts carry a note that
            plainly belongs to those three fields and nothing else. */}
        <fieldset className="card stack">
          <legend className="section-legend">{t('intake.aboutYouLegend')}</legend>

          <label>
            {t('intake.dateOfBirth')}
            <input
              type="date"
              value={form.date_of_birth}
              onChange={(e) => update('date_of_birth', e.target.value)}
              {...required('date_of_birth')}
            />
            <span className="muted small">{t('intake.dateOfBirthHint')}</span>
          </label>

          {/* Two questions, not one, and they are treated differently on
              purpose. Pronouns are how the coach refers to you and are NOT
              behind the health consent - being addressed correctly should not
              be something anybody trades privacy for. Gender IS treated as
              consumer health data, sits with the injury fields, and is used
              for exactly two things, both spelled out in the hint. */}
          <label>
            {t('intake.pronouns')}
            <input
              type="text"
              maxLength={40}
              value={form.pronouns}
              onChange={(e) => update('pronouns', e.target.value)}
              placeholder={t('intake.pronounsPlaceholder')}
            />
            <span className="muted small">{t('intake.pronounsHint')}</span>
          </label>

          <label>
            {t('intake.gender')}
            <select value={form.gender} onChange={(e) => update('gender', e.target.value)}>
              <option value="">{t('intake.select')}</option>
              {GENDER_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {t(`intake.genderOptions.${key}`)}
                </option>
              ))}
            </select>
            <span className="muted small">{t('intake.genderHint')}</span>
          </label>

          {form.gender === 'self_described' && (
            <label>
              {t('intake.genderSelfDescribed')}
              <input
                type="text"
                maxLength={60}
                value={form.gender_self_described}
                onChange={(e) => update('gender_self_described', e.target.value)}
              />
            </label>
          )}

          <label>
            {t('intake.units')}
            <select value={form.units} onChange={(e) => update('units', e.target.value)}>
              <option value="lb">{t('intake.unitOptions.lb')}</option>
              <option value="kg">{t('intake.unitOptions.kg')}</option>
            </select>
          </label>

          <label>
            {t('intake.bodyweight')} ({form.units})
            <input
              type="number"
              min="0"
              step="0.5"
              value={form.bodyweight}
              onChange={(e) => update('bodyweight', e.target.value)}
              placeholder="—"
            />
          </label>
        </fieldset>

        <fieldset className="card stack">
          <legend className="section-legend">{t('intake.liftsLegend')}</legend>
          <p className="muted small">{t('intake.liftsNote')}</p>

          {/* One per row rather than a four-across grid. Each of these needs a
              hint under it saying "one rep, not a set", which is the entire
              point of the rewrite, and there is nowhere to put that in a grid
              cell 90px wide on a phone. */}
          {[
            ['current_squat', 'intake.squat'],
            ['current_bench', 'intake.bench'],
            ['current_deadlift', 'intake.deadlift'],
          ].map(([field, labelKey]) => (
            <label key={field}>
              {t(labelKey)} ({form.units})
              <input
                type="number"
                min="0"
                step="0.5"
                value={form[field]}
                onChange={(e) => update(field, e.target.value)}
                placeholder="—"
              />
              <span className="muted small">{t('intake.oneRepHint')}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="card stack">
          <legend className="section-legend">{t('intake.trainingLegend')}</legend>

          <label>
            {t('intake.experience')}
            <select
              value={form.experience_level}
              onChange={(e) => update('experience_level', e.target.value)}
              {...required('experience_level')}
            >
              <option value="">{t('intake.select')}</option>
              {EXPERIENCE_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {t(`intake.experienceOptions.${key}`)}
                </option>
              ))}
            </select>
            <span className="muted small">{t('intake.experienceHint')}</span>
          </label>

          <label>
            {t('intake.cadence')}
            <select
              value={form.progress_cadence}
              onChange={(e) => update('progress_cadence', e.target.value)}
            >
              <option value="">{t('intake.select')}</option>
              {CADENCE_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {t(`intake.cadenceOptions.${key}`)}
                </option>
              ))}
            </select>
            <span className="muted small">{t('intake.cadenceHint')}</span>
          </label>

          <label>
            {t('intake.goal')}
            <select
              value={form.goal}
              onChange={(e) => update('goal', e.target.value)}
              {...required('goal')}
            >
              <option value="">{t('intake.select')}</option>
              {GOAL_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {t(`intake.goalOptions.${key}`)}
                </option>
              ))}
            </select>
          </label>

          {/* Asked only when the goal involves losing fat, and never as a
              precondition. This is medication data: the database refuses to
              store anything but "prefer not to say" without health-data
              consent, so somebody who has not given it simply cannot be asked
              to answer - which is why the option to decline is a real answer
              and not a cop-out. */}
          {form.goal === 'body_composition' && (
            <label>
              {t('intake.glp1')}
              <select value={form.glp1_status || ''} onChange={(e) => update('glp1_status', e.target.value)}>
                <option value="">{t('intake.select')}</option>
                {GLP1_OPTIONS.map((key) => (
                  <option key={key} value={key}>
                    {t(`intake.glp1Options.${key}`)}
                  </option>
                ))}
              </select>
              <span className="muted small">{t('intake.glp1Help')}</span>
            </label>
          )}

          {MEET_GOALS.has(form.goal) && (
            <label>
              {t('intake.competitionDate')}
              <input
                type="date"
                value={form.competition_date || ''}
                onChange={(e) => update('competition_date', e.target.value)}
              />
            </label>
          )}

          <label>
            {t('intake.daysPerWeek')}
            <input
              type="number"
              min="1"
              max="7"
              value={form.days_per_week}
              onChange={(e) => update('days_per_week', e.target.value)}
              {...required('days_per_week')}
            />
          </label>

          {/* ── WHERE DO YOU TRAIN ────────────────────────────────────────
              Ticking a gym pre-fills the equipment box below. That is all it
              does. These are NOT equipment lists we hold as fact: no chain
              publishes what any individual club has, they vary by franchise
              and by year, and a confidently wrong list sends somebody looking
              for a platform that is not there. What gets stored and what the
              coach reads is whatever is left in the box afterwards. */}
          <fieldset className="subfield">
            <legend className="muted small">{t('intake.gyms')}</legend>
            <p className="muted small">{t('intake.gymsHint')}</p>
            <div className="gym-options">
              {GYM_OPTIONS.map((slug) => (
                <label className="checkbox" key={slug}>
                  <input
                    type="checkbox"
                    checked={form.gym_chains.includes(slug)}
                    onChange={(e) => toggleGym(slug, e.target.checked)}
                    disabled={!form.gym_chains.includes(slug) && form.gym_chains.length >= 4}
                  />
                  <span>{t(`intake.gymOptions.${slug}`)}</span>
                </label>
              ))}
            </div>

            <label>
              {t('intake.gymLabel')}
              <input
                type="text"
                maxLength={120}
                value={form.gym_label}
                onChange={(e) => update('gym_label', e.target.value)}
                placeholder={t('intake.gymLabelPlaceholder')}
              />
              {/* Said plainly, because somebody typing a gym name into a
                  health app deserves to know what happens to it. */}
              <span className="muted small">{t('intake.gymLabelHint')}</span>
            </label>
          </fieldset>

          <label>
            {t('intake.equipment')}
            <textarea
              rows={5}
              value={form.equipment_available}
              onChange={(e) => update('equipment_available', e.target.value)}
              placeholder={t('intake.equipmentPlaceholder')}
              {...required('equipment_available')}
            />
            <span className="muted small">{t('intake.equipmentHint')}</span>
          </label>

          <label>
            {t('intake.smallestPlate')}
            <input
              type="number"
              min="0.25"
              max="25"
              step="0.25"
              value={form.smallest_plate_pair}
              onChange={(e) => update('smallest_plate_pair', e.target.value)}
              placeholder={t('intake.smallestPlatePlaceholder')}
            />
            <span className="muted small">{t('intake.smallestPlateHelp')}</span>
          </label>
        </fieldset>

        <fieldset className="sensitive">
          <legend>{t('intake.healthLegend')}</legend>
          <p className="muted small">{t('intake.healthNote')}</p>
          <textarea
            rows={3}
            value={form.health_restrictions}
            onChange={(e) => update('health_restrictions', e.target.value)}
            placeholder={t('intake.healthPlaceholder')}
          />

          {reportedRestriction && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.cleared_to_train}
                onChange={(e) => update('cleared_to_train', e.target.checked)}
              />
              <span>{t('intake.clearedLabel')}</span>
            </label>
          )}

          {reportedRestriction && !form.cleared_to_train && (
            <p className="warning">{t('intake.clearanceWarning')}</p>
          )}
        </fieldset>

        <fieldset className="sensitive">
          <legend>{t('intake.recoveryLegend')}</legend>
          <p className="muted small">{t('intake.recoveryNote')}</p>

          <label>
            {t('intake.sleepHours')}
            <input
              type="number"
              min="0"
              max="24"
              step="0.5"
              value={form.sleep_hours_typical}
              onChange={(e) => update('sleep_hours_typical', e.target.value)}
            />
          </label>

          <label>
            {t('intake.alcohol')}
            <input
              type="number"
              min="0"
              max="200"
              value={form.alcohol_units_per_week}
              onChange={(e) => update('alcohol_units_per_week', e.target.value)}
            />
            <span className="muted small">{t('intake.alcoholHint')}</span>
          </label>

          <label>
            {t('intake.nicotine')}
            <select value={form.nicotine_use} onChange={(e) => update('nicotine_use', e.target.value)}>
              <option value="">{t('intake.preferNotToSay')}</option>
              <option value="none">{t('intake.nicotineNone')}</option>
              <option value="occasional">{t('intake.nicotineOccasional')}</option>
              <option value="daily">{t('intake.nicotineDaily')}</option>
            </select>
          </label>

          <label>
            {t('intake.nutrition')}
            <textarea
              rows={2}
              value={form.nutrition_notes}
              onChange={(e) => update('nutrition_notes', e.target.value)}
              placeholder={t('intake.nutritionPlaceholder')}
            />
          </label>
        </fieldset>

        {error && <p className="error">{error}</p>}

        {/* Above the button, not at the top of the form. The person is here. */}
        <ErrorSummary
          title={t('intake.missingTitle')}
          hint={t('intake.missingHint')}
          items={missing}
        />

        <button type="submit" className="primary" disabled={busy}>
          {busy ? t('common.saving') : t('intake.submit')}
        </button>
      </form>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';

const EMPTY = {
  experience_level: '',
  units: 'lb',
  bodyweight: '',
  current_squat: '',
  current_bench: '',
  current_deadlift: '',
  goal: '',
  competition_date: '',
  equipment_available: '',
  days_per_week: '',
  smallest_plate_pair: '',
  date_of_birth: '',
  health_restrictions: '',
  sleep_hours_typical: '',
  alcohol_units_per_week: '',
  nicotine_use: '',
  nutrition_notes: '',
  cleared_to_train: false,
};

/** Empty strings mean "not answered"; the API and the database both want null. */
function toPayload(form) {
  const num = (v) => (v === '' || v === null ? null : Number(v));
  return {
    experience_level: form.experience_level || null,
    units: form.units,
    bodyweight: num(form.bodyweight),
    current_squat: num(form.current_squat),
    current_bench: num(form.current_bench),
    current_deadlift: num(form.current_deadlift),
    goal: form.goal || null,
    competition_date:
      form.goal === 'meet_prep' && form.competition_date ? form.competition_date : null,
    equipment_available: form.equipment_available || null,
    days_per_week: form.days_per_week === '' ? null : Number(form.days_per_week),
    // Blank means "I don't know what my gym has", which the engine handles by
    // assuming the standard 2.5 lb / 1.25 kg plate. Coercing it to a number
    // here would invent equipment the athlete never claimed to own.
    smallest_plate_pair: num(form.smallest_plate_pair),
    health_restrictions: form.health_restrictions ?? '',
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

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
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

      <form onSubmit={handleSubmit} className="card stack">
        <label>
          {t('intake.experience')}
          <select
            value={form.experience_level}
            onChange={(e) => update('experience_level', e.target.value)}
            required
          >
            <option value="">{t('intake.select')}</option>
            {['never_trained', 'some_experience', 'currently_training'].map((key) => (
              <option key={key} value={key}>
                {t(`intake.experienceOptions.${key}`)}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t('intake.dateOfBirth')}
          <input
            type="date"
            value={form.date_of_birth}
            onChange={(e) => update('date_of_birth', e.target.value)}
            required
          />
          <span className="muted small">{t('intake.dateOfBirthHint')}</span>
        </label>

        <label>
          {t('intake.units')}
          <select value={form.units} onChange={(e) => update('units', e.target.value)}>
            <option value="lb">{t('intake.unitOptions.lb')}</option>
            <option value="kg">{t('intake.unitOptions.kg')}</option>
          </select>
        </label>

        <p className="muted small">{t('intake.liftsNote')}</p>

        <div className="grid-4">
          {[
            ['bodyweight', 'intake.bodyweight'],
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
            </label>
          ))}
        </div>

        <label>
          {t('intake.goal')}
          <select value={form.goal} onChange={(e) => update('goal', e.target.value)} required>
            <option value="">{t('intake.select')}</option>
            {['general_strength', 'meet_prep'].map((key) => (
              <option key={key} value={key}>
                {t(`intake.goalOptions.${key}`)}
              </option>
            ))}
          </select>
        </label>

        {form.goal === 'meet_prep' && (
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
            required
          />
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

        <label>
          {t('intake.equipment')}
          <textarea
            rows={2}
            value={form.equipment_available}
            onChange={(e) => update('equipment_available', e.target.value)}
            placeholder={t('intake.equipmentPlaceholder')}
            required
          />
        </label>

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

        <button type="submit" className="primary" disabled={busy}>
          {busy ? t('common.saving') : t('intake.submit')}
        </button>
      </form>
    </div>
  );
}

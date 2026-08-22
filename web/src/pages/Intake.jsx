import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

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
  health_restrictions: '',
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
    competition_date: form.goal === 'meet_prep' && form.competition_date ? form.competition_date : null,
    equipment_available: form.equipment_available || null,
    days_per_week: form.days_per_week === '' ? null : Number(form.days_per_week),
    health_restrictions: form.health_restrictions ?? '',
    cleared_to_train: Boolean(form.cleared_to_train),
  };
}

export function Intake() {
  const navigate = useNavigate();
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
      .catch(() => setError('Could not load your profile.'))
      .finally(() => setLoading(false));
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

  if (loading) return <div className="centered muted">Loading…</div>;

  const reportedRestriction = form.health_restrictions.trim().length > 0;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Your training profile</h1>
        <p className="muted">
          Coach uses this to write your program. Approximations are fine — it adjusts based on what
          you actually log.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="card stack">
        <label>
          Training experience
          <select
            value={form.experience_level}
            onChange={(e) => update('experience_level', e.target.value)}
            required
          >
            <option value="">Select…</option>
            <option value="never_trained">Never trained with a barbell</option>
            <option value="some_experience">Some experience, not currently consistent</option>
            <option value="currently_training">Currently training consistently</option>
          </select>
        </label>

        <label>
          Units
          <select value={form.units} onChange={(e) => update('units', e.target.value)}>
            <option value="lb">Pounds (lb)</option>
            <option value="kg">Kilograms (kg)</option>
          </select>
        </label>

        <div className="grid-4">
          {[
            ['bodyweight', 'Bodyweight'],
            ['current_squat', 'Squat'],
            ['current_bench', 'Bench'],
            ['current_deadlift', 'Deadlift'],
          ].map(([field, label]) => (
            <label key={field}>
              {label} ({form.units})
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
          Goal
          <select value={form.goal} onChange={(e) => update('goal', e.target.value)} required>
            <option value="">Select…</option>
            <option value="general_strength">Get generally stronger</option>
            <option value="meet_prep">Compete in a powerlifting meet</option>
          </select>
        </label>

        {form.goal === 'meet_prep' && (
          <label>
            Competition date
            <input
              type="date"
              value={form.competition_date || ''}
              onChange={(e) => update('competition_date', e.target.value)}
            />
          </label>
        )}

        <label>
          Days per week you can train
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
          Equipment you have access to
          <textarea
            rows={2}
            value={form.equipment_available}
            onChange={(e) => update('equipment_available', e.target.value)}
            placeholder="Full commercial gym; barbell, rack, bench, plates to 405…"
            required
          />
        </label>

        <fieldset className="sensitive">
          <legend>Injuries, pain, or medical conditions</legend>
          <p className="muted small">
            Coach needs this to train you safely. It is stored encrypted, visible only to your
            account, and never written to application logs or error reports. Leave blank if none.
          </p>
          <textarea
            rows={3}
            value={form.health_restrictions}
            onChange={(e) => update('health_restrictions', e.target.value)}
            placeholder="e.g. left shoulder pain when benching; disc issue diagnosed 2023"
          />

          {reportedRestriction && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.cleared_to_train}
                onChange={(e) => update('cleared_to_train', e.target.checked)}
              />
              <span>
                A doctor or physical therapist has cleared me to train with this condition.
              </span>
            </label>
          )}

          {reportedRestriction && !form.cleared_to_train && (
            <p className="warning">
              Coach will not write you a program until you have been cleared by a professional. It
              will still answer questions in the meantime.
            </p>
          )}
        </fieldset>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save and talk to Coach'}
        </button>
      </form>
    </div>
  );
}

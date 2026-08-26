import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';
import { emptyExercise, prefillFrom, toSessionPayload, today } from '../lib/sessionDraft.js';

/**
 * Logging what was actually lifted.
 *
 * This screen is used standing up, between sets, one-handed, by someone whose
 * rest timer is running. Every decision here follows from that: the form opens
 * already filled with the shape of the last session, the number inputs are
 * numeric so phones show the number pad, and nothing is required except naming
 * a movement.
 *
 * It is also the feature the rest of Phase 2 stands on. Progression, charts and
 * the coach's ability to adjust a block all read from what gets logged here, so
 * a form people quietly stop using does not degrade those features - it empties
 * them.
 */
export function LogSession() {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [draft, setDraft] = useState({ date: today(), notes: '', exercises: [emptyExercise()] });
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getSessions()
      .then(({ sessions }) => {
        setRecent(sessions ?? []);
        if (sessions?.length) setDraft(prefillFrom(sessions[0]));
      })
      .catch(() => {
        // A failed history load is not a reason to block logging. The whole
        // point of this screen is capturing the set that just happened, and an
        // empty form still does that.
        setRecent([]);
      })
      .finally(() => setLoading(false));
  }, []);

  function updateRow(index, field, value) {
    setDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }));
  }

  function addRow() {
    setDraft((prev) => ({ ...prev, exercises: [...prev.exercises, emptyExercise()] }));
  }

  function removeRow(index) {
    setDraft((prev) => {
      const exercises = prev.exercises.filter((_, i) => i !== index);
      // Never leave the form with nothing to type into.
      return { ...prev, exercises: exercises.length ? exercises : [emptyExercise()] };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    const result = toSessionPayload(draft);
    if (!result.ok) {
      setError(t('log.needExercise'));
      return;
    }

    setBusy(true);
    try {
      await api.logSession(result.payload);
      navigate('/coach');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="centered muted">{t('common.loading')}</div>;

  return (
    <div className="page">
      {/* The same pinned header every other signed-in page has. Before this,
          this page had a lone "back to coach" link and no navigation, so
          reaching the library or progress from here meant going through the
          conversation first - which is what "it takes the end user to another
          page instead of keeping them on the same window" describes. The
          routing was always client-side; what changed was that the chrome
          left with it. */}
      <StickyHeader>
        <header className="page-header">
          <SiteNav />
          <h1 className="page-title">{t('log.title')}</h1>
          <p className="muted header-detail">{t('log.subtitle')}</p>
        </header>
      </StickyHeader>

      <form onSubmit={handleSubmit} className="card stack">
        <label>
          {t('log.date')}
          <input
            type="date"
            value={draft.date}
            max={today()}
            onChange={(e) => setDraft((prev) => ({ ...prev, date: e.target.value }))}
            required
          />
        </label>

        <div className="stack">
          {draft.exercises.map((row, index) => (
            <fieldset key={index} className="exercise-row">
              <legend className="visually-hidden">
                {t('log.exerciseNumber')} {index + 1}
              </legend>

              <label className="grow">
                {t('log.exercise')}
                <input
                  value={row.exercise}
                  onChange={(e) => updateRow(index, 'exercise', e.target.value)}
                  placeholder={t('log.exercisePlaceholder')}
                  autoComplete="off"
                />
              </label>

              {/* inputMode numeric so a phone offers the number pad. */}
              {[
                ['sets', 'log.sets', '1'],
                ['reps', 'log.reps', '1'],
                ['weight', 'log.weight', '2.5'],
                ['rpe', 'log.rpe', '0.5'],
              ].map(([field, labelKey, step]) => (
                <label key={field} className="narrow">
                  {t(labelKey)}
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={step}
                    value={row[field]}
                    onChange={(e) => updateRow(index, field, e.target.value)}
                  />
                </label>
              ))}

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={row.completed !== false}
                  onChange={(e) => updateRow(index, 'completed', e.target.checked)}
                />
                <span>{t('log.completed')}</span>
              </label>

              <button type="button" className="link" onClick={() => removeRow(index)}>
                {t('log.remove')}
              </button>
            </fieldset>
          ))}
        </div>

        <button type="button" className="link" onClick={addRow}>
          {t('log.addExercise')}
        </button>

        <label>
          {t('log.notes')}
          <textarea
            rows={2}
            value={draft.notes}
            onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder={t('log.notesPlaceholder')}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? t('common.saving') : t('log.submit')}
        </button>
      </form>

      {recent.length > 0 && (
        <section className="card stack">
          <h2>{t('log.recentTitle')}</h2>
          {recent.slice(0, 5).map((session) => (
            <div key={session.id} className="fineprint">
              <strong>{session.date}</strong>
              <ul className="checklist">
                {(Array.isArray(session.exercises) ? session.exercises : []).map((e, i) => (
                  <li key={i}>
                    {e.exercise}
                    {e.sets != null && e.reps != null ? ` ${e.sets}x${e.reps}` : ''}
                    {e.weight != null ? ` @ ${e.weight}` : ''}
                    {e.rpe != null ? ` RPE ${e.rpe}` : ''}
                    {e.completed === false ? ` — ${t('log.notCompleted')}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';
import { emptyExercise, prefillFrom, toSessionPayload, today } from '../lib/sessionDraft.js';
import { Loading } from '../components/Loading.jsx';

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
  /* The unit beside the weight field. Pounds until the server says otherwise -
     this is an American company and the column's own default agrees. */
  const [units, setUnits] = useState('lb');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getSessions()
      .then(({ sessions, units: theirs }) => {
        setRecent(sessions ?? []);
        if (theirs) setUnits(theirs);
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

  if (loading) return <div className="centered"><Loading /></div>;

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

              {/*
                ── THE KEYPAD IS PER FIELD, NOT PER FORM ───────────────────

                All four were `decimal`, which puts a decimal point on the pad
                for two fields that cannot use one: sets and reps are integers
                and the schema rejects anything else (`z.number().int()`).
                Weight and RPE genuinely are fractional - 2.5lb jumps, RPE 8.5 -
                so they keep it.

                And the weight now says WHICH unit. The field was labeled
                "Weight" and nothing else, in a product that supports pounds and
                kilograms, on the one screen somebody fills in at a rack.
              */}
              {[
                ['sets', t('log.sets'), '1', 'numeric', null],
                ['reps', t('log.reps'), '1', 'numeric', null],
                ['weight', t('log.weight'), '2.5', 'decimal', units],
                ['rpe', t('log.rpe'), '0.5', 'decimal', null],
              ].map(([field, labelText, step, keypad, unit]) => (
                <label key={field} className="narrow">
                  {labelText}
                  {/*
                    The unit rides INSIDE the field, not in the label. Put in
                    the label, "Weight (lb)" wrapped to two lines in a 65px
                    column and left three labels on one baseline and the fourth
                    on two - which is the raggedness this whole row was
                    rearranged to remove.

                    The accessible name still carries it. WCAG 2.5.3 asks that
                    the name CONTAIN the visible label, and "Weight (lb)"
                    contains "Weight", so a screen reader hears the unit and
                    voice control can still say "weight".
                  */}
                  <span className="with-unit" data-unit={unit ?? undefined}>
                    <input
                      type="number"
                      inputMode={keypad}
                      min="0"
                      step={step}
                      value={row[field]}
                      onChange={(e) => updateRow(index, field, e.target.value)}
                      aria-label={unit ? t('log.weightWithUnits', { units: unit }) : undefined}
                    />
                  </span>
                </label>
              ))}

              {/*
                ── ONE ROW, TWO OPPOSITE THINGS ────────────────────────────

                These were stacked, which put a destructive control directly
                under the RPE field on a phone and gave it the same weight as
                the checkbox beside it. They belong on one line at opposite
                ends: the thing you do every time on the left, the thing you
                rarely do on the right.

                And the accessible name says WHICH movement. Five rows used to
                offer five buttons all called "Remove", which is a list a
                screen-reader user cannot navigate - the visible word stays
                short because the column it sits in is narrow.
              */}
              <div className="exercise-foot">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={row.completed !== false}
                    onChange={(e) => updateRow(index, 'completed', e.target.checked)}
                  />
                  <span>{t('log.completed')}</span>
                </label>

                <button
                  type="button"
                  className="row-remove"
                  onClick={() => removeRow(index)}
                  aria-label={t('log.removeNumbered', { number: index + 1 })}
                >
                  {t('log.remove')}
                </button>
              </div>
            </fieldset>
          ))}
        </div>

        {/*
          ── THE SECOND MOVEMENT IS THE COMMON CASE ────────────────────────

          This was a centered underlined text link 23 pixels tall, which is
          under the 24x24 WCAG 2.5.8 asks for at AA and reads as a footnote.
          Almost nobody logs a session with one movement in it, so the control
          that adds the second one is not a footnote - it is the second most
          pressed thing on the screen.
        */}
        <button type="button" className="secondary add-row" onClick={addRow}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path
              d="M8 3v10M3 8h10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          {t('log.addExercise')}
        </button>

        {/* Said once, under the fields rather than inside them. RPE is the one
            piece of jargon on this screen, and a product whose job is taking
            beginners to competent lifters cannot print it unexplained on the
            form they fill in after every session. */}
        <p className="muted small rpe-hint">{t('log.rpeHint')}</p>

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

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';

/**
 * The current training block, as a thing rather than as a message.
 *
 * ── WHY THIS PAGE EXISTS ──────────────────────────────────────────────────
 *
 * Until now a program was prose in a conversation. That is fine to read once
 * and useless everywhere else: you cannot take it to the gym without
 * scrolling back through a chat, you cannot print it, and nothing can compare
 * what you logged against what you were asked to do.
 *
 * The coach now emits a machine-readable copy alongside the prose and the chat
 * route stores it. This renders that record. The prose is still the coaching -
 * the explanation, the reasoning, the encouragement - and it stays in the
 * conversation where it belongs. This is the reference card.
 *
 * ── IT IS BUILT TO BE PRINTED ─────────────────────────────────────────────
 *
 * Which is the whole point of the request. The print rules in styles.css strip
 * the navigation and the background; what remains is a plain sheet of days,
 * movements, sets, reps and weights, with a line saying which week it is and
 * when it was written. A phone in a chalky gym is a worse reference than
 * paper, and plenty of people know it.
 */
export function Program() {
  const { t, formatDate } = useI18n();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    api
      .getProgram()
      .then(({ active, history, adherence }) =>
        setState({ status: 'ready', active, history, adherence })
      )
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, []);

  const active = state.active;
  const data = active?.program_data;

  /**
   * Status per prescribed exercise, keyed the way the server returned it.
   *
   * There is deliberately no percentage anywhere on this page. A compliance
   * score is a grade, a bad grade for a bad week is how somebody stops
   * logging, and the log is the only real input the coach has. See
   * server/src/lib/adherence.js.
   */
  const statusFor = (dayIndex, exerciseIndex) =>
    state.adherence?.days?.[dayIndex]?.exercises?.[exerciseIndex]?.status ?? null;

  return (
    <div className="page">
      <StickyHeader>
        <header className="page-header">
          <SiteNav />
          <h1 className="page-title">{t('program.title')}</h1>
        </header>
      </StickyHeader>

      {state.status === 'loading' && <p className="muted">{t('common.loading')}</p>}
      {state.status === 'error' && <p className="error">{state.message}</p>}

      {state.status === 'ready' && !active && (
        <div className="card stack">
          <p className="muted">{t('program.none')}</p>
          <p>
            <Link to="/coach">{t('program.askCoach')}</Link>
          </p>
        </div>
      )}

      {data && (
        <>
          {/* Printed first and deliberately plain: on paper this is the line
              that says which sheet you are holding. */}
          <div className="card stack">
            <p className="muted small">
              {t('program.weekPhase', { week: data.week, phase: t(`program.phases.${data.phase}`) })}
              {' · '}
              {t('program.writtenOn', { date: formatDate(active.created_at) })}
            </p>
            {data.summary && <p>{data.summary}</p>}
          </div>

          {data.days.map((day, index) => (
            <section className="card" key={`${day.name}-${index}`}>
              <h2 className="h3">{day.name}</h2>
              <table className="program-table">
                <thead>
                  <tr>
                    <th scope="col">{t('program.movement')}</th>
                    <th scope="col">{t('program.sets')}</th>
                    <th scope="col">{t('program.reps')}</th>
                    <th scope="col">{t('program.weight')}</th>
                    <th scope="col">{t('program.logged')}</th>
                  </tr>
                </thead>
                <tbody>
                  {day.exercises.map((exercise, i) => (
                    <tr key={`${exercise.lift}-${i}`}>
                      <th scope="row">
                        {exercise.lift}
                        {exercise.notes && (
                          <span className="muted small block">{exercise.notes}</span>
                        )}
                      </th>
                      <td>{exercise.sets}</td>
                      <td>{exercise.reps}</td>
                      {/* A null weight is not a zero. Bodyweight movements and
                          "work up to a heavy single" both arrive as null, and
                          printing 0lb would be a different instruction. */}
                      <td>{exercise.weight === null ? t('program.noWeight') : exercise.weight}</td>
                      {/* Words, not a colour. A red cell says "you failed";
                          "changed" says what happened and leaves the reason to
                          the athlete, who knows it and we do not. */}
                      <td className="muted small">
                        {statusFor(index, i) ? t(`program.status.${statusFor(index, i)}`) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}

          {state.adherence && state.adherence.sessionsInWindow > 0 && (
            <div className="card stack">
              <p className="muted small">
                {t('program.loggedSince', { count: state.adherence.sessionsInWindow })}
              </p>
              {state.adherence.unprescribed.length > 0 && (
                <p className="muted small">
                  {t('program.alsoLogged', {
                    lifts: state.adherence.unprescribed.join(', '),
                  })}
                </p>
              )}
            </div>
          )}

          <div className="card stack">
            <p className="fineprint">{t('program.supersededNote')}</p>
            <p className="fineprint">{t('medical.disclaimer')}</p>
          </div>

          {state.history?.length > 0 && (
            <details className="card">
              <summary>{t('program.previous', { count: state.history.length })}</summary>
              <ul className="stack">
                {state.history.map((p) => (
                  <li key={p.id} className="muted small">
                    {t('program.weekPhase', {
                      week: p.week_number,
                      phase: t(`program.phases.${p.phase}`),
                    })}
                    {' · '}
                    {formatDate(p.created_at)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

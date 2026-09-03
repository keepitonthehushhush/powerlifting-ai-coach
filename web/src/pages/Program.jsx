import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';
import { Loading } from '../components/Loading.jsx';
import { PlateBar, plateWords } from '../components/PlateBar.jsx';
import { loadBarbell, platesAvailable, LOADOUT_STATUS } from '../lib/plates.js';

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
      .then(({ active, history, adherence, equipment, warmup }) =>
        setState({ status: 'ready', active, history, adherence, equipment, warmup })
      )
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, []);

  const active = state.active;
  const data = active?.program_data;

  /*
   * The ramp for one day, BY INDEX rather than by name.
   *
   * warmupForProgram() maps over the same `days` array this renders, so index
   * n is index n. Matching on `day.name` would look safer and be worse: two
   * days called "Day A" are a thing a model writes, and a name match would put
   * the first day's loads under both of them.
   */
  const rampFor = (dayIndex) => state.warmup?.days?.[dayIndex]?.specific ?? [];

  /* The empty bar, in the athlete's own units, sent by the route that computed
     the ramp. Declaring 45 here would be wrong for anybody training in kilos. */
  const barWeight = state.warmup?.bar ?? null;

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

  /*
   * "Squat 160" is a number. "Two 25s, a 15 and a 2.5 per side" is an
   * instruction, and it is the one a beginner in front of a rack actually
   * needs. The arithmetic was always being done - by the athlete, in the gym,
   * badly, under a bar.
   *
   * Null whenever we cannot be sure: no equipment on the profile, no weight
   * prescribed, or a bodyweight movement. A confident plate list for a weight
   * we guessed the units of would be worse than no list at all.
   */
  const units = state.equipment?.units ?? null;
  const available = units
    ? platesAvailable(state.equipment.smallestPlatePair, units)
    : null;

  const loadoutFor = (weight) => {
    if (!units || weight === null || weight === undefined) return null;
    return loadBarbell(weight, { units, available });
  };

  /* One drawing per day rather than per row. The heaviest bar is the one worth
   * picturing - it is the set somebody is nervous about - and twelve barbells
   * in a table is a page nobody reads. */
  const heaviestLoadout = (day) => {
    const weights = day.exercises
      .map((e) => e.weight)
      .filter((w) => typeof w === 'number' && Number.isFinite(w));
    if (!weights.length) return null;
    const top = Math.max(...weights);
    const loadout = loadoutFor(top);
    return loadout && loadout.plates.length ? { loadout, weight: top } : null;
  };

  return (
    <div className="page">
      <StickyHeader>
        <header className="page-header">
          <SiteNav />
          <h1 className="page-title">{t('program.title')}</h1>
        </header>
      </StickyHeader>

      {state.status === 'loading' && <Loading size={72} />}
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

          {/*
            ── THE WARM-UP, AND WHY IT IS ONE CARD PLUS A BLOCK PER DAY ────

            "The program is not showing the stretch or warm up exercises." It
            was not: the coach writes one into the chat reply and the stored
            program has no field for it, so the sheet an athlete reads at the
            rack began at their working weight.

            The general and mobility halves are identical before every session,
            so they are said once. The RAMP is not - it is computed from the
            loads in each day's own table - so it sits inside the day it
            belongs to, next to the numbers it works up to. Repeating the
            cardio line under every day would be padding on a page whose whole
            purpose is to be printed and followed.
          */}
          {state.warmup && (
            <section className="card stack">
              <h2 className="h3">{t('program.warmupHeading')}</h2>
              <p>{t('program.warmupGeneral')}</p>
              <p>{t('program.warmupMobility')}</p>
              <p className="muted small">{t('program.warmupWhy')}</p>
              <h3 className="h4">{t('program.warmupStretchHeading')}</h3>
              <p>{t('program.warmupStretchBody')}</p>
            </section>
          )}

          {data.days.map((day, index) => (
            <section className="card" key={`${day.name}-${index}`}>
              <h2 className="h3">{day.name}</h2>
              {rampFor(index).length > 0 && (
                <div className="stack warmup-ramp">
                  <h3 className="h4">{t('program.warmupRampHeading')}</h3>
                  {rampFor(index).map((entry) => (
                    <p key={entry.lift}>
                      <strong>{t(`progress.lift.${entry.lift}`)}</strong>
                      {': '}
                      {/*
                        A deadlift whose working weight is under the lightest
                        load that puts the bar at plate height has no ramp to
                        give - every load it could name would be pulled from a
                        deficit. The answer is to raise the bar, and it is a
                        sentence rather than a list of numbers.
                      */}
                      {entry.reason === 'elevate'
                        ? t('program.warmupElevate')
                        : entry.sets
                            .map((set) =>
                              set.weight === barWeight
                                ? t('program.warmupBarSet', { reps: set.reps })
                                : t('program.warmupSet', {
                                    weight: set.weight,
                                    units: state.warmup.units,
                                    reps: set.reps,
                                  })
                            )
                            .join(' · ')}
                    </p>
                  ))}
                </div>
              )}
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
                      <td>
                        {exercise.weight === null ? (
                          t('program.noWeight')
                        ) : (
                          <>
                            {exercise.weight}
                            {units ? ` ${units}` : null}
                            {(() => {
                              const loadout = loadoutFor(exercise.weight);
                              if (!loadout) return null;
                              if (loadout.status === LOADOUT_STATUS.remainder) {
                                /* Said plainly rather than hidden. A weight the
                                   athlete cannot build is a thing to know
                                   before the gym, not at the rack. */
                                return (
                                  <span className="muted small block plate-words">
                                    {t('program.platesNotLoadable', {
                                      nearest: loadout.nearestLoadable,
                                      units,
                                    })}
                                  </span>
                                );
                              }
                              if (!loadout.plates.length) {
                                return (
                                  <span className="muted small block plate-words">
                                    {t('program.platesBarOnly', {
                                      weight: loadout.barTotal,
                                      units,
                                    })}
                                  </span>
                                );
                              }
                              return (
                                <span className="muted small block plate-words">
                                  {t('program.platesPerSide', { plates: plateWords(loadout) })}
                                </span>
                              );
                            })()}
                          </>
                        )}
                      </td>
                      {/* Words, not a color. A red cell says "you failed";
                          "changed" says what happened and leaves the reason to
                          the athlete, who knows it and we do not. */}
                      <td className="muted small">
                        {statusFor(index, i) ? t(`program.status.${statusFor(index, i)}`) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(() => {
                const heaviest = heaviestLoadout(day);
                if (!heaviest) return null;
                return (
                  <figure className="plate-figure">
                    <PlateBar
                      loadout={heaviest.loadout}
                      label={t('program.platesBarLabel', {
                        weight: heaviest.weight,
                        units,
                        plates: plateWords(heaviest.loadout),
                      })}
                    />
                    <figcaption className="muted small">
                      {t('program.platesHeaviest', { weight: heaviest.weight, units })}
                    </figcaption>
                  </figure>
                );
              })()}
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

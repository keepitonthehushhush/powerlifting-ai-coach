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
 * What changed since the last block, and whether the log asked for it.
 *
 * ── WHY THIS IS ON THE PAGE AND NOT ONLY IN THE CONVERSATION ──────────────
 *
 * The coach explains a new program once, in a message, and the message scrolls
 * away. Six weeks later this page said "Week 3 · Novice — Sep 4" and nothing
 * else, so nobody - not the athlete, not the coach, not anybody reading the
 * database - could say why the squat came down ten pounds in week two.
 *
 * That is the difference between a coach and a program generator. A generator
 * hands you a new plan. A coach tells you what changed and why.
 *
 * ── THE REASON IS LOCALIZED FROM THE ACTION, NOT COPIED FROM THE ENGINE ────
 *
 * lib/progression.js returns a `reason` sentence per lift, written to be read
 * aloud, and it is English. It reaches the COACH, which speaks the athlete's
 * language and can render it in Spanish. Printing it here would put an English
 * paragraph on a Spanish page.
 *
 * So the page keys a short translated line off the engine's `action`, which is
 * a five-value enum rather than prose. A test asserts every action the engine
 * can return has a string here, because the failure mode of a missing one is a
 * blank line where an explanation should be.
 */
function WhatChanged({ changes, previous, units, t, formatDate }) {
  if (!changes) return null;

  const why = (c) => {
    if (c.basis === 'progression') {
      // `why.<action>` or nothing. An unknown action renders no line rather
      // than the key name, which is the one thing worse than silence.
      const line = t(`program.changes.why.${c.expected?.action}`);
      return line.startsWith('program.changes.why.') ? null : line;
    }
    if (c.basis === 'coach') {
      if (c.expected?.weight == null) return t('program.changes.coachNoNumber');
      // `units` is null whenever the profile could not be read - see the plate
      // readout below, which degrades the same way. "pointed at 225 null" is
      // the kind of string that only ever ships because nobody tried it with a
      // missing profile.
      return units
        ? t('program.changes.coach', { expected: c.expected.weight, units })
        : t('program.changes.coachNoUnits', { expected: c.expected.weight });
    }
    return t('program.changes.unknown');
  };

  return (
    <section className="card stack">
      <h2 className="h3">{t('program.changes.heading')}</h2>
      {previous && (
        <p className="muted small">
          {t('program.changes.since', {
            week: previous.week_number,
            date: formatDate(previous.created_at),
          })}
        </p>
      )}

      {changes.identical ? (
        <p>{t('program.changes.identical')}</p>
      ) : (
        <ul className="stack">
          {changes.phase && (
            <li>
              {t('program.changes.phase', {
                from: t(`program.phases.${changes.phase.from}`),
                to: t(`program.phases.${changes.phase.to}`),
              })}
            </li>
          )}
          {changes.days && (
            <li>{t('program.changes.days', { from: changes.days.from, to: changes.days.to })}</li>
          )}
          {changes.changed.map((c) => (
            <li key={c.key}>
              <strong>{c.label}</strong>
              {c.delta != null && c.load !== 'same' && (
                <>
                  {' — '}
                  {t(units ? 'program.changes.load' : 'program.changes.loadNoUnits', {
                    from: c.from.weight,
                    to: c.to.weight,
                    units,
                    // Signed, and the minus is a real minus sign rather than a
                    // hyphen, because this is prose and not code.
                    delta: c.delta > 0 ? `+${c.delta}` : `\u2212${Math.abs(c.delta)}`,
                  })}
                </>
              )}
              {c.setsRepsChanged && (
                <>
                  {' — '}
                  {t('program.changes.setsReps', {
                    from: `${c.from?.sets}×${c.from?.reps}`,
                    to: `${c.to?.sets}×${c.to?.reps}`,
                  })}
                </>
              )}
              {c.timesPerWeek && (
                <>
                  {' — '}
                  {t('program.changes.timesPerWeek', {
                    from: c.timesPerWeek.from,
                    to: c.timesPerWeek.to,
                  })}
                </>
              )}
              <p className="muted small">{why(c)}</p>
              {c.comparedOnHeaviest && (
                <p className="fineprint">{t('program.changes.heaviestNote')}</p>
              )}
            </li>
          ))}
          {changes.added.map((a) => (
            <li key={`+${a.key}`}>
              <strong>{a.label}</strong> — {t('program.changes.added')}
            </li>
          ))}
          {changes.removed.map((r) => (
            <li key={`-${r.key}`}>
              <strong>{r.label}</strong> — {t('program.changes.removed')}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

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
      .then(({ active, history, adherence, equipment, warmup, changes, previousProgram }) =>
        setState({ status: 'ready', active, history, adherence, equipment, warmup, changes, previousProgram })
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
              {/*
                * ── FIVE COLUMNS DO NOT FIT A PHONE ──────────────────────────
                *
                * Without this the table squeezed instead of scrolling, and the
                * weight column - which carries a load AND its plate
                * breakdown - wrapped to four lines per row: "225 lb / 2 x 45 /
                * per / side". A prescription is a thing somebody reads at arm's
                * length between sets, and that is the one place it must not
                * turn into a column of fragments.
                *
                * The same treatment the coach's own tables already get, and
                * the same argument: the table scrolls inside its own box and
                * the page never scrolls sideways.
                */}
              <div className="program-table-scroll">
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
              </div>
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

          <WhatChanged
            changes={state.changes}
            previous={state.previousProgram}
            units={units}
            t={t}
            formatDate={formatDate}
          />

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

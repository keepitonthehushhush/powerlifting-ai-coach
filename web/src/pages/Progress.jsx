import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { BackToTop, StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';
import { LiftChart } from '../components/LiftChart.jsx';
import { OneRepMaxChart } from '../components/OneRepMaxChart.jsx';
import { oneRepMaxSeries } from '../lib/oneRepMax.js';
import { MilestoneStack } from '../components/MilestoneStack.jsx';
import { milestoneProgress, bestCompleted, MILESTONE_LIFTS } from '../lib/milestones.js';
import { topSetPerDay, trend } from '../lib/chartData.js';
import { Loading } from '../components/Loading.jsx';

/** The four lifts get charts. Accessory work is logged but not charted here. */
const CHARTED = [
  { key: 'squat', matches: ['squat', 'squats', 'back squat', 'low bar squat', 'high bar squat'] },
  { key: 'bench', matches: ['bench', 'bench press', 'benchpress', 'flat bench'] },
  { key: 'deadlift', matches: ['deadlift', 'deadlifts', 'dead lift', 'conventional deadlift', 'sumo deadlift'] },
  { key: 'press', matches: ['press', 'overhead press', 'strict press', 'ohp', 'standing press', 'military press'] },
];

/**
 * Progress, as small multiples.
 *
 * Four separate charts rather than four lines on one axis. A deadlift at 405
 * and a press at 95 do not share a scale usefully - together, the press is a
 * flat line along the bottom - and the alternative, two y-axes, makes the
 * crossing point of the lines an artifact of where the axes were placed rather
 * than a fact about the training.
 *
 * The table underneath is not a fallback for when the charts fail. It is the
 * accessible view of the same numbers, and it is also the one a lifter actually
 * reads when they want to know what they did on the 14th.
 */
export function Progress() {
  const { t } = useI18n();
  const [logs, setLogs] = useState(null);
  const [units, setUnits] = useState('lb');
  const [error, setError] = useState(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    Promise.all([api.getProgress(), api.getProfile()])
      .then(([progressData, profileData]) => {
        setLogs(progressData.logs ?? []);
        setUnits(profileData?.profile?.units ?? 'lb');
      })
      .catch((err) => setError(err.message));
  }, []);

  const series = useMemo(() => {
    if (!logs) return [];
    return CHARTED.map(({ key, matches }) => {
      // Normalize on the way in so 'Bench Press' and 'bench' land in one series.
      const normalised = logs.map((row) => ({
        ...row,
        lift: matches.includes(String(row.lift ?? '').trim().toLowerCase().replace(/\s+/g, ' ')) ? key : row.lift,
      }));
      const points = topSetPerDay(normalised, key);
      /*
       * Computed from the SAME rows the weight chart reads, so the two charts
       * for a lift can never disagree about which sessions they describe. A
       * second pass over the raw logs would be one spelling variant away from a
       * page showing four weight charts and three estimate charts.
       */
      const estimates = oneRepMaxSeries(normalised, key);
      return { key, points, estimates, trend: trend(points) };
    }).filter((s) => s.points.length > 0);
  }, [logs]);

  /*
   * The estimate charts are their own section rather than a second card beside
   * each weight chart. They answer a different question - what a session
   * PREDICTS rather than what was lifted - and interleaving them would read as
   * eight charts of the same thing rather than two views of four lifts.
   */
  const estimated = series.filter((s) => s.estimates.length > 0);

  /*
   * Measured against what was actually LIFTED, not against the estimate. A
   * milestone is a thing you stood up with, and a stack filling on the
   * strength of a projection would be awarding somebody a plate they have not
   * pulled - which is the one thing this feature must never do, because its
   * whole value is that it is true.
   *
   * Only the three lifts with milestone tables. The overhead press is charted
   * and has no milestones, and inventing some to fill the row would be making
   * up targets nobody set.
   */
  const milestones = useMemo(() => {
    if (!logs) return [];
    return MILESTONE_LIFTS.map((key) => {
      const matched = CHARTED.find((c) => c.key === key);
      if (!matched) return null;
      const rows = logs.map((row) => ({
        ...row,
        lift: matched.matches.includes(
          String(row.lift ?? '').trim().toLowerCase().replace(/\s+/g, ' '),
        )
          ? key
          : row.lift,
      }));
      const best = bestCompleted(rows, key);
      if (best === null) return null;
      return { key, progress: milestoneProgress(best, key, units) };
    }).filter((m) => m && m.progress);
  }, [logs, units]);

  return (
    <div className="page">
      <StickyHeader>
      <header className="page-header">
        <SiteNav />
        <h1 className="page-title">{t('progress.title')}</h1>
        <p className="muted header-detail">{t('progress.subtitle')}</p>
      </header>
      </StickyHeader>

      {error && <p className="error">{error}</p>}
      {!logs && !error && <Loading size={72} />}

      {logs && series.length === 0 && (
        <div className="card">
          <p>{t('progress.empty')}</p>
          <Link className="link strong" to="/log">
            {t('progress.logFirst')}
          </Link>
        </div>
      )}

      {series.length > 0 && (
        <>
          <div className="chart-grid-layout">
            {series.map(({ key, points, trend: t2 }) => (
              <div className="card" key={key}>
                <LiftChart title={t(`progress.lift.${key}`)} points={points} units={units} />
                <p className="muted small">
                  {t2.direction === 'up' && t('progress.trendUp', { change: t2.change, units })}
                  {t2.direction === 'down' && t('progress.trendDown', { change: t2.change, units })}
                  {t2.direction === 'flat' && t('progress.trendFlat')}
                  {t2.direction === 'none' && t('progress.trendSingle')}
                </p>
              </div>
            ))}
          </div>

          <section className="stack" aria-labelledby="milestone-heading">
            <h2 className="h3" id="milestone-heading">{t('progress.milestoneHeading')}</h2>
            <p className="muted small measure">{t('progress.milestoneIntro')}</p>
            {milestones.length === 0 ? (
              <p className="muted small">{t('progress.milestoneNone')}</p>
            ) : (
              <div className="card">
                <div className="milestone-grid">
                  {milestones.map(({ key, progress }) => (
                    <MilestoneStack
                      key={`milestone-${key}`}
                      lift={t(`progress.lift.${key}`)}
                      progress={progress}
                      units={units}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="stack" aria-labelledby="e1rm-heading">
            <h2 className="h3" id="e1rm-heading">{t('progress.e1rmHeading')}</h2>
            <p className="muted small measure">{t('progress.e1rmIntro')}</p>
            {estimated.length === 0 ? (
              <p className="muted small">{t('progress.e1rmNone')}</p>
            ) : (
              <div className="chart-grid-layout">
                {estimated.map(({ key, estimates }) => (
                  <div className="card" key={`e1rm-${key}`}>
                    <OneRepMaxChart
                      title={t('progress.e1rmTitle', { lift: t(`progress.lift.${key}`) })}
                      points={estimates}
                      units={units}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <button type="button" className="link" onClick={() => setShowTable((v) => !v)}>
            {showTable ? t('progress.hideTable') : t('progress.showTable')}
          </button>

          {showTable && (
            <div className="card table-scroll">
              <table className="data-table">
                <caption className="muted small">{t('progress.tableCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('progress.colDate')}</th>
                    <th scope="col">{t('progress.colLift')}</th>
                    <th scope="col">{t('progress.colWeight')}</th>
                    <th scope="col">{t('progress.colReps')}</th>
                    <th scope="col">RPE</th>
                    <th scope="col">{t('progress.colResult')}</th>
                  </tr>
                </thead>
                <tbody>
                  {series.flatMap(({ key, points }) =>
                    points.map((p) => (
                      <tr key={`${key}-${p.date}`}>
                        <td>{p.date}</td>
                        <td>{t(`progress.lift.${key}`)}</td>
                        <td>
                          {p.weight}
                          {units}
                        </td>
                        <td>{p.reps ?? '—'}</td>
                        <td>{p.rpe ?? '—'}</td>
                        <td>{p.completed ? t('progress.keyCompleted') : t('progress.keyMissed')}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <BackToTop label={t('common.backToTop')} />
    </div>
  );
}

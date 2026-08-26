import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { BackToTop, StickyHeader } from '../components/StickyHeader.jsx';
import { LiftChart } from '../components/LiftChart.jsx';
import { topSetPerDay, trend } from '../lib/chartData.js';

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
 * crossing point of the lines an artefact of where the axes were placed rather
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
      // Normalise on the way in so 'Bench Press' and 'bench' land in one series.
      const normalised = logs.map((row) => ({
        ...row,
        lift: matches.includes(String(row.lift ?? '').trim().toLowerCase().replace(/\s+/g, ' ')) ? key : row.lift,
      }));
      const points = topSetPerDay(normalised, key);
      return { key, points, trend: trend(points) };
    }).filter((s) => s.points.length > 0);
  }, [logs]);

  return (
    <div className="page">
      <StickyHeader>
      <header className="page-header">
        <div className="row">
          <h1>{t('progress.title')}</h1>
          <Link className="link" to="/coach">
            {t('progress.backToCoach')}
          </Link>
        </div>
        <p className="muted header-detail">{t('progress.subtitle')}</p>
      </header>
      </StickyHeader>

      {error && <p className="error">{error}</p>}
      {!logs && !error && <p className="muted">{t('common.loading')}</p>}

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

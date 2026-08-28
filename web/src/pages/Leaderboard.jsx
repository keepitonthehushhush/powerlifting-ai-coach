import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';
import { AchievementShelf } from '../components/AchievementShelf.jsx';

const BOARDS = ['squat', 'bench', 'deadlift'];

/**
 * The board, and the badges, on one page.
 *
 * They sit together because they answer the same question from opposite ends:
 * the board is where you are against other people, the shelf is where you are
 * against yourself. The shelf is PRIVATE - it is computed from the reader's own
 * logs and is not part of the published projection. Somebody who opted into
 * having their squat ranked did not opt into strangers knowing they missed a
 * rep in March.
 */
export function Leaderboard() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState('squat');
  const [handle, setHandle] = useState('');
  const [profile, setProfile] = useState(null);

  async function load() {
    try {
      const [board_, profile_] = await Promise.all([api.getLeaderboard(), api.getProfile()]);
      setData(board_);
      setProfile(profile_);
      if (profile_?.display_name) setHandle(profile_.display_name);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(optIn) {
    setBusy(true);
    setError(null);
    try {
      /**
       * Save the handle first if it changed, then join. Asking for a name on a
       * separate screen before a button that needs one is how somebody ends up
       * clicking Join and being told to go elsewhere - the name is a
       * prerequisite, so it belongs in the same action.
       */
      if (optIn && handle && handle !== profile?.display_name) {
        /**
         * ONE FIELD, not the whole profile.
         *
         * This used to be `{ ...profile, display_name: handle }`, which is the
         * obvious thing to write and was wrong: GET /profile returns
         * `select('*')` - user_id, created_at, updated_at and the rest - while
         * PUT validates with a `.strict()` schema that rejects any key it does
         * not know. So every attempt to join failed with "Invalid profile
         * data." and the response carried no detail saying which keys.
         *
         * PUT upserts the columns it is given, so sending one field changes
         * one field and leaves everything else alone. Round-tripping a read
         * into a write is the habit that caused this; do not reintroduce it.
         */
        await api.saveProfile({ display_name: handle });
      }
      await api.setLeaderboardOptIn(optIn);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.boards?.[board] ?? [];

  return (
    <div className="page">
      <StickyHeader>
        <header className="page-header">
          <SiteNav />
          <h1 className="page-title">{t('leaderboard.title')}</h1>
        </header>
      </StickyHeader>

      <section className="card stack">
        <p className="muted small">{t('leaderboard.intro')}</p>

        {/* Said before anybody opts in, not buried in a policy page. */}
        <p className="muted small">{t('leaderboard.whatIsShown')}</p>

        {data && !data.onLeaderboard && (
          <label className="stack">
            {t('leaderboard.handleLabel')}
            <input
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              maxLength={24}
              autoComplete="off"
              spellCheck="false"
              placeholder={t('leaderboard.handlePlaceholder')}
              aria-describedby="handle-help"
            />
            <span id="handle-help" className="muted small">{t('leaderboard.handleHelp')}</span>
          </label>
        )}

        {data && (
          <div className="row-actions">
            {data.onLeaderboard ? (
              <button type="button" onClick={() => toggle(false)} disabled={busy}>
                {busy ? t('common.working') : t('leaderboard.leave')}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => toggle(true)}
                disabled={busy || !/^[A-Za-z0-9_-]{3,24}$/.test(handle)}
              >
                {busy ? t('common.working') : t('leaderboard.join')}
              </button>
            )}
          </div>
        )}

        {data?.onLeaderboard && <p className="muted small">{t('leaderboard.leaveIsDelete')}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card stack">
        {/* Tabs rather than three tables: one lift at a time is how anybody
            actually reads a leaderboard, and three stacked tables on a phone
            is a scroll nobody finishes. */}
        <div className="row-actions" role="tablist" aria-label={t('leaderboard.title')}>
          {BOARDS.map((lift) => (
            <button
              key={lift}
              type="button"
              role="tab"
              aria-selected={board === lift}
              className={board === lift ? 'primary' : ''}
              onClick={() => setBoard(lift)}
            >
              {t(`leaderboard.lift.${lift}`)}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="muted small">{t('leaderboard.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="board">
              <thead>
                <tr>
                  <th scope="col">{t('leaderboard.rank')}</th>
                  <th scope="col">{t('leaderboard.lifter')}</th>
                  <th scope="col">{t('leaderboard.best')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.displayName} className={row.displayName === data.you ? 'you' : undefined}>
                    <td>{row.rank}</td>
                    <td>
                      {row.displayName}
                      {row.displayName === data.you && <span className="muted small"> {t('leaderboard.thatsYou')}</span>}
                    </td>
                    <td>
                      {row.weight} {data.units}
                      {/* A converted figure is marked, so nobody reads a
                          rounded 440.9 as the number somebody actually put on
                          a bar. */}
                      {row.converted && (
                        <span className="muted small">
                          {' '}
                          {t('leaderboard.converted', { weight: row.loggedWeight, units: row.loggedUnits })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">{t('leaderboard.loggedOnly')}</p>
      </section>

      <AchievementShelf />
    </div>
  );
}

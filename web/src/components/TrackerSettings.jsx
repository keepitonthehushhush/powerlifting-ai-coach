import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * Connecting the app they already log in.
 *
 * ── WHY THIS SCREEN EXISTS AT ALL ──────────────────────────────────────────
 *
 * Everything this product decides - the next weight, the deload, the phase
 * change, what changed between blocks and why - reads a training log. Asking
 * somebody to keep a second log so the coach has something to read is asking
 * them to do the boring half twice, and the honest answer to "will they" is
 * no. So the coach reads the log they already keep.
 *
 * ── THE FIELD IS WRITE-ONLY, AND THAT IS THE WHOLE DESIGN ──────────────────
 *
 * There is no request that returns the key, so there is nothing to render it
 * into. Once connected, this shows a state and a disconnect button. The input
 * is `type="password"` and `autoComplete="off"` because it is a bearer
 * credential for somebody's paid account on another service, and it will
 * frequently be pasted on a phone in a gym with other people around.
 */
/**
 * The stored failures this screen has a sentence for.
 *
 * A closed set, because `last_error` is written by our own code and the
 * translate function returns the KEY when it does not recognize one - so an
 * unmapped code would render `tracker.failure.something` at somebody in a gym.
 * Anything unrecognized gets the honest generic sentence instead.
 */
const NAMED_FAILURES = new Set(['tracker_key_rejected', 'tracker_rate_limited', 'tracker_unavailable']);

export function TrackerSettings() {
  const { t } = useI18n();
  const [connection, setConnection] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [run, setRun] = useState(null);

  useEffect(() => {
    let live = true;
    api
      .getHevyConnection()
      .then((result) => {
        if (!live) return;
        setConnection(result?.connection ?? null);
        setLoaded(true);
      })
      // Unreachable is not "not connected". Rendering the connect form would
      // invite somebody to paste a key they have already pasted, and the
      // second paste would reset a backfill that was halfway through.
      .catch(() => { if (live) setLoaded(false); });
    return () => { live = false; };
  }, []);

  async function connect(event) {
    event.preventDefault();
    setBusy('connect');
    setError(null);
    setRun(null);
    try {
      const result = await api.connectHevy(key);
      setConnection(result?.connection ?? null);
      // Cleared the moment it is accepted. It is in the database now, and the
      // longer it sits in a form field the more chances it has to be
      // autofilled, screenshotted, or left on a shared screen.
      setKey('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setError(null);
    setRun(null);
    try {
      const result = await api.disconnectHevy();
      setConnection(result?.connection ?? null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy('sync');
    setError(null);
    setRun(null);
    try {
      const result = await api.syncHevy();
      setConnection(result?.connection ?? null);
      setRun(result?.run ?? null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return null;

  const connected = Boolean(connection?.connected);

  return (
    <section className="card stack">
      <h2 className="h3">{t('tracker.heading')}</h2>
      <p className="small muted">{t('tracker.intro')}</p>

      {!connected && (
        <form className="stack" onSubmit={connect}>
          <label>
            {t('tracker.keyLabel')}
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
              spellCheck="false"
              disabled={busy === 'connect'}
            />
          </label>
          {/* Their settings page, not a copy of their instructions. Where the
              key lives is theirs to change and ours to point at. */}
          <p className="small muted">{t('tracker.whereToFind')}</p>
          <p className="small muted">{t('tracker.proRequired')}</p>
          <button type="submit" className="primary" disabled={!key.trim() || busy === 'connect'}>
            {busy === 'connect' ? t('common.working') : t('tracker.connectButton')}
          </button>
        </form>
      )}

      {connected && (
        <div className="stack">
          <p className="small">
            {connection.backfill_done
              ? t('tracker.stateReady')
              : t('tracker.stateImporting')}
          </p>
          {connection.synced_through && (
            <p className="small muted">
              {t('tracker.lastSynced', {
                when: new Date(connection.synced_through).toLocaleString(),
              })}
            </p>
          )}
          {/* The stored failure, said plainly. A settings page that shows
              "connected" above a sync that has failed every time for a week is
              the version of this screen that wastes somebody's afternoon. */}
          {connection.last_error && (
            <p className="small error" role="alert">
              {t(`tracker.failure.${NAMED_FAILURES.has(connection.last_error) ? connection.last_error : 'unknown'}`)}
            </p>
          )}
          {run && (
            <p className="small muted" role="status">
              {t('tracker.runSummary', {
                imported: run.imported,
                duplicates: run.duplicates,
                deleted: run.deleted,
              })}
              {!run.finished && ` ${t('tracker.runMore')}`}
            </p>
          )}
          {/* row-actions, not row: two buttons that wrap to a column on a
              phone rather than sitting at opposite ends of the card. */}
          <div className="row-actions">
            <button type="button" className="primary" onClick={sync} disabled={busy === 'sync'}>
              {busy === 'sync' ? t('tracker.syncing') : t('tracker.syncButton')}
            </button>
            <button type="button" onClick={disconnect} disabled={busy === 'disconnect'}>
              {busy === 'disconnect' ? t('common.working') : t('tracker.disconnectButton')}
            </button>
          </div>
          <p className="small muted">{t('tracker.disconnectNote')}</p>
        </div>
      )}

      {/* Said on the screen where the decision is made, not only in the privacy
          policy. Reading is the whole of it: nothing is ever written back to
          their account. */}
      <p className="small muted">{t('tracker.readOnly')}</p>

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

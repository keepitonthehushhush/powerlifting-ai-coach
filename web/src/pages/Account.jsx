import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';

/**
 * Data subject rights, exposed as an actual screen rather than a policy page.
 *
 * The export downloads client-side from an in-memory blob: the file is
 * assembled from an authenticated API response and never touches a share link
 * or a third-party host, so health data does not acquire a URL on its way to
 * the person it belongs to.
 */
export function Account() {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirmText, setConfirmText] = useState('');

  async function handleExport() {
    setBusy('export');
    setError(null);
    try {
      const document_ = await api.exportData();
      const blob = new Blob([JSON.stringify(document_, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `coach-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy('delete');
    setError(null);
    try {
      await api.deleteAccount(confirmText);
      await signOut();
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }

  const confirmed = confirmText.trim() === 'DELETE MY ACCOUNT';

  return (
    <div className="page">
      <header className="page-header row">
        <h1>{t('account.title')}</h1>
        <Link className="link" to="/coach">
          {t('common.appName')}
        </Link>
      </header>

      <section className="card stack">
        <h2 className="h3">{t('account.exportHeading')}</h2>
        <p className="muted small">{t('account.exportBody')}</p>
        <button type="button" className="primary" onClick={handleExport} disabled={busy === 'export'}>
          {busy === 'export' ? t('common.working') : t('account.exportButton')}
        </button>
      </section>

      <section className="card stack danger">
        <h2 className="h3">{t('account.deleteHeading')}</h2>
        <p className="muted small">{t('account.deleteBody')}</p>
        <label>
          {t('account.deleteConfirmPrompt')}
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE MY ACCOUNT"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className="destructive"
          onClick={handleDelete}
          disabled={!confirmed || busy === 'delete'}
        >
          {busy === 'delete' ? t('common.working') : t('account.deleteButton')}
        </button>
      </section>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

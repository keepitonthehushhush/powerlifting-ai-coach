import { useEffect, useState } from 'react';
import { isStale, versionCheckable } from '../lib/version.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * Tells somebody their tab is running an older build, and lets them decide.
 *
 * Checked when the tab regains focus rather than on a timer. A background tab
 * cannot be confused by a deploy - nobody is looking at it - and polling one
 * every minute for an event that happens a few times a week is a request
 * nobody needed. The moment that matters is when a person comes back to a page
 * they left open, which is exactly when `visibilitychange` fires.
 *
 * Once dismissed it stays dismissed for that build. Re-offering a reload
 * somebody has already declined is how a helpful banner becomes a nuisance.
 */
export function NewVersionBanner() {
  const { t } = useI18n();
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!versionCheckable()) return undefined;
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const result = await isStale();
      if (!cancelled && result) setStale(true);
    };

    check();
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  if (!stale || dismissed) return null;

  return (
    <div className="version-banner" role="status">
      <span>{t('version.updated')}</span>
      <div className="row-actions">
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          {t('version.reload')}
        </button>
        <button type="button" onClick={() => setDismissed(true)}>
          {t('version.later')}
        </button>
      </div>
    </div>
  );
}

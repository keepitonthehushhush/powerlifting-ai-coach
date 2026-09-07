import { useI18n } from '../i18n/index.jsx';

/**
 * Shown when the consent state could not be READ - not when it was withheld.
 *
 * WHY THIS EXISTS. `evaluateConsentGate` fails closed, correctly: an
 * unreadable consent state is treated as "not granted" rather than letting
 * somebody through unasked. Its comment promised the cost of that wrong "no"
 * was "one extra screen on a page that can retry". The retry was never built.
 * So a 502 on GET /api/consent redirected an athlete who had already agreed to
 * the consent screen, whose own panel then failed to load the same data, whose
 * Continue button is disabled until it does - a dead end reached by somebody
 * who had done nothing wrong, with nothing on screen saying so.
 *
 * That is not hypothetical. On 2026-09-02 a real athlete hit
 * `storage_unavailable` on /api/consent hours after finishing intake, and has
 * not been back since.
 *
 * The safety property is unchanged: this renders INSTEAD of the protected
 * children, so an unknown consent state still admits nobody. It only replaces
 * a silent, actionless redirect with the truth and a button.
 */
export function ConsentUnavailable({ onRetry }) {
  const { t } = useI18n();

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('consent.unavailable.title')}</h1>
      </header>
      <div className="card stack">
        <p>{t('consent.unavailable.body')}</p>
        <p className="muted small">{t('consent.unavailable.reassurance')}</p>
        <button type="button" className="primary" onClick={onRetry}>
          {t('consent.unavailable.retry')}
        </button>
      </div>
    </div>
  );
}

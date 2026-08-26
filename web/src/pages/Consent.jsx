import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsentPanel } from '../components/ConsentPanel.jsx';
import { useI18n } from '../i18n/index.jsx';
import { useConsent } from '../context/ConsentContext.jsx';
import { LanguageSwitcher } from '../components/LanguageSwitcher.jsx';

/**
 * The consent step, shown after signup and before intake.
 *
 * Separated from the intake form on purpose: MHMDA wants consent obtained
 * before collection, and a checkbox sitting beside the field it authorises
 * invites people to fill the field first and read the checkbox never.
 */
export function Consent() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { refresh } = useConsent();
  const [state, setState] = useState(null);

  const canContinue =
    state && state.required.every((type) => state.consents[type]?.granted && !state.consents[type]?.stale);

  return (
    <div className="page">
      <header className="page-header">
        <div className="row">
          <h1>{t('consent.title')}</h1>
          <LanguageSwitcher />
        </div>
        <p className="muted">{t('consent.subtitle')}</p>
      </header>

      <div className="card stack">
        <ConsentPanel onChange={setState} />

        <button
          type="button"
          className="primary"
          disabled={!canContinue}
          onClick={async () => {
            // Refresh the shared state before navigating. The gate on /intake
            // reads the context, not this component, and would bounce the
            // person straight back here if it were still holding the answer
            // from before they consented.
            await refresh();
            navigate('/intake');
          }}
        >
          {t('consent.continue')}
        </button>

        {!canContinue && <p className="muted small">{t('consent.requiredToContinue')}</p>}
      </div>
    </div>
  );
}

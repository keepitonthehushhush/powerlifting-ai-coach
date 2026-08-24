import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * Granular consent, one decision at a time.
 *
 * Washington's My Health My Data Act requires separate opt-in consent before
 * consumer health data is collected — a single bundled "I agree" does not
 * satisfy it — and requires withdrawal to be as easy as granting. Hence one
 * toggle per purpose, each independently reversible, with no "accept all".
 *
 * Health data consent is deliberately NOT required to use the product. The
 * coach works without injury information, just more conservatively. Consent
 * that gates something unrelated to its purpose is not freely given, which
 * would make it both worse practice and legally weaker.
 */
export function ConsentPanel({ onChange, showRequiredOnly = false }) {
  const { t } = useI18n();
  const [consents, setConsents] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      const data = await api.getConsents();
      setConsents(data);
      onChange?.(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggle(consentType, granted) {
    setBusy(consentType);
    setError(null);
    setNotice(null);
    try {
      const result = await api.recordConsent(consentType, granted);
      if (result.health_data_cleared) setNotice(t('consent.healthDataCleared'));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !consents) return <p className="error">{error}</p>;
  if (!consents) return <p className="muted">{t('common.loading')}</p>;

  const types = showRequiredOnly ? consents.required : Object.keys(consents.current_versions);

  return (
    <div className="stack">
      {types.map((type) => {
        const state = consents.consents[type];
        const required = consents.required.includes(type);

        return (
          <div key={type} className="consent-item">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={Boolean(state?.granted)}
                disabled={busy === type}
                onChange={(e) => toggle(type, e.target.checked)}
              />
              <span>
                <strong>{t(`consent.${type}.label`)}</strong>
                {required && <span className="required-tag"> {t('consent.required')}</span>}
                <br />
                <span className="muted small">{t(`consent.${type}.description`)}</span>
              </span>
            </label>

            {state?.stale && (
              <p className="warning small">{t('consent.staleVersion')}</p>
            )}

            {state?.granted && state.recorded_at && (
              <p className="muted small indent">
                {t('consent.recordedOn', {
                  date: new Date(state.recorded_at).toLocaleDateString(),
                  version: state.policy_version,
                })}
              </p>
            )}
          </div>
        );
      })}

      {notice && <p className="warning">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <p className="fineprint">{t('consent.withdrawAnytime')}</p>
    </div>
  );
}

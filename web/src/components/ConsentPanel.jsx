import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { Link } from 'react-router-dom';
import { policyPathFor } from '../lib/policyDocuments.js';
import { Loading } from './Loading.jsx';

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
  if (!consents) return <Loading size={72} />;

  const types = showRequiredOnly ? consents.required : Object.keys(consents.current_versions);

  return (
    <div className="stack">
      {types.map((type) => {
        const state = consents.consents[type];
        const required = consents.required.includes(type);

        const policyPath = policyPathFor(type);

        return (
          <div key={type} className="consent-item">
            {/* The document comes BEFORE the checkbox, not in a row of links
                underneath it. Consent that is agreed to before the thing being
                agreed to has been made available is not informed consent, and
                a link placed after the control people are reaching for is a
                link most of them will never see. */}
            {policyPath && (
              <p className="policy-link">
                <Link className="link strong" to={policyPath}>
                  {t('consent.readBeforeAgreeing', { document: t(`consent.${type}.document`) })}
                </Link>
              </p>
            )}

            {/* ── A STALE CONSENT RENDERS UNCHECKED ────────────────────
                The box answers "do you agree to the CURRENT version", not
                "did you ever agree to anything". When a policy is updated the
                server marks the old record stale while `granted` is still
                true, and reflecting that as a ticked box would put a
                pre-ticked checkbox in front of somebody and call the result
                consent. It is not: consent has to be an affirmative act, and
                the CJEU said so plainly in Planet49 (C-673/17) - a pre-ticked
                box is not valid consent under the GDPR.
                It is also broken as an interaction. A ticked box gives the
                person nothing to click; if they did click it, the only thing
                it could send is a WITHDRAWAL. Re-consent would have been
                unreachable through the control built for it. */}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={Boolean(state?.granted) && !state?.stale}
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

            {/* Why they are seeing this again, in specifics. "Please review
                and confirm again" tells somebody they have been given
                homework; naming what they agreed to, when, and what it is now
                tells them what changed and lets them check. */}
            {state?.stale && (
              <p className="notice small">
                {state.recorded_at
                  ? t('consent.staleExplained', {
                      date: new Date(state.recorded_at).toLocaleDateString(),
                      oldVersion: state.policy_version,
                      newVersion: consents.current_versions?.[type] ?? '',
                    })
                  : t('consent.staleVersion')}
              </p>
            )}

            {/* Deliberately not shown for a stale consent: a box that is empty
                above a line reading "recorded on the 3rd" is the screen
                contradicting itself. The date is in the explanation instead,
                where it is doing work. */}
            {state?.granted && !state.stale && state.recorded_at && (
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

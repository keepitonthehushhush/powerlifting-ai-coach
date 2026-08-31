import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useMfa } from '../context/MfaContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import {
  abandonedTotpFactors,
  cleanTotpCode,
  codeLooksComplete,
  verifiedTotpFactor,
} from '../lib/mfa.js';

/**
 * Turning the second factor on, and off.
 *
 * ── THE ABANDONED-ENROLLMENT PROBLEM, WHICH IS NOT DOCUMENTED ─────────────
 *
 * `enroll()` writes an unverified factor the instant this screen opens. Open
 * it and close it, and one is left behind. Supabase's default ceiling is ten
 * factors per account, so the eleventh time somebody opens this screen and
 * changes their mind, enrollment starts failing - and nothing in their
 * documentation covers it, so nothing would explain it either.
 *
 * So this clears its own litter: every unverified TOTP factor is unenrolled
 * before a new enrollment starts. Safe because an unverified factor protects
 * nothing and can never be the account's real second factor.
 *
 * ── WHY THE SECRET IS SHOWN AS TEXT AS WELL AS A QR CODE ──────────────────
 *
 * Because the person setting this up is frequently holding the only camera
 * they own. Scanning a QR code on a phone WITH that same phone is not
 * possible, and an app installed on that phone needs the secret typed. The
 * QR code is the fast path; the string is the one that always works.
 */
export function MfaSettings() {
  const { t } = useI18n();
  const { state, checked, refresh } = useMfa();

  const [factor, setFactor] = useState(null);
  const [enrolling, setEnrolling] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) return;
    setFactor(verifiedTotpFactor(data));
  }, []);

  useEffect(() => {
    void load();
  }, [load, state]);

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Clear the litter first. See the note above.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const stale of abandonedTotpFactors(existing)) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Coach Diaz ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrollError) throw enrollError;
      setEnrolling(data);
    } catch (err) {
      setError(err?.message ? t('mfa.setupFailed') : t('mfa.setupFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(event) {
    event.preventDefault();
    if (busy || !enrolling || !codeLooksComplete(code)) return;
    setBusy(true);
    setError(null);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enrolling.id,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrolling.id,
        challengeId: challenge.id,
        code: cleanTotpCode(code),
      });
      if (verifyError) throw verifyError;

      setEnrolling(null);
      setCode('');
      // Supabase signs out every OTHER session on success. Saying so is the
      // difference between a security feature and an unexplained logout on
      // somebody's laptop an hour later.
      setNotice(t('mfa.enrolledOtherSessionsEnded'));
      await refresh();
      await load();
    } catch {
      setError(t('mfa.codeRejected'));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!factor || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (removeError) throw removeError;
      setFactor(null);
      setNotice(t('mfa.removed'));
      // The level does not drop until the token refreshes, so ask for one
      // rather than leaving the account page describing a state that ended.
      await supabase.auth.refreshSession();
      await refresh();
    } catch {
      setError(t('mfa.removeFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{t('mfa.heading')}</h2>
      <p className="muted">{t('mfa.intro')}</p>

      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {!checked && <p className="muted">{t('mfa.checking')}</p>}

      {checked && factor && !enrolling && (
        <>
          <p className="mfa-status on">{t('mfa.on')}</p>
          <button type="button" className="secondary" onClick={remove} disabled={busy}>
            {t('mfa.turnOff')}
          </button>
          <p className="fineprint">{t('mfa.turnOffWarning')}</p>
        </>
      )}

      {checked && !factor && !enrolling && (
        <>
          <p className="mfa-status off">{t('mfa.off')}</p>
          <button type="button" className="primary" onClick={startEnrollment} disabled={busy}>
            {t('mfa.turnOn')}
          </button>
        </>
      )}

      {enrolling && (
        <div className="mfa-enroll">
          <ol className="mfa-steps">
            <li>{t('mfa.step1')}</li>
            <li>{t('mfa.step2')}</li>
            <li>{t('mfa.step3')}</li>
          </ol>

          {/* Supabase returns the QR as an SVG data URL. alt is empty on
              purpose: the secret below carries the same information as text,
              so describing the image would be describing a picture of a
              string that is already on the page. */}
          <img className="mfa-qr" src={enrolling.totp?.qr_code} alt="" />

          <p className="fineprint">{t('mfa.orTypeIt')}</p>
          <code className="mfa-secret">{enrolling.totp?.secret}</code>

          <form onSubmit={confirmEnrollment} noValidate>
            <label className="field">
              <span>{t('mfa.codeLabel')}</span>
              <input
                value={code}
                onChange={(e) => {
                  setCode(cleanTotpCode(e.target.value));
                  setError(null);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                disabled={busy}
              />
            </label>
            <button type="submit" className="primary" disabled={busy || !codeLooksComplete(code)}>
              {busy ? t('mfa.verifying') : t('mfa.confirm')}
            </button>
          </form>

          <button
            type="button"
            className="link-button"
            onClick={() => {
              setEnrolling(null);
              setCode('');
            }}
            disabled={busy}
          >
            {t('mfa.cancel')}
          </button>
        </div>
      )}
    </section>
  );
}

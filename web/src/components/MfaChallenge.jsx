import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMfa } from '../context/MfaContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { cleanTotpCode, codeLooksComplete, verifiedTotpFactor } from '../lib/mfa.js';

/**
 * The step between a correct password and being signed in.
 *
 * ── WHY THERE IS A WAY OUT ON THIS SCREEN ─────────────────────────────────
 *
 * Sign out is the only control besides the code field, and it is not
 * decoration. Somebody reaching this screen without their authenticator is
 * stuck: they cannot proceed, and without a visible exit the app is a wall
 * with their own training history behind it. Signing out at least returns them
 * to a page that explains what to do, and the way back in from there runs
 * through the operator - see scripts/mfa-recovery.mjs.
 *
 * ── AND WHY THE FAILURE MESSAGE IS VAGUE ──────────────────────────────────
 *
 * A wrong code and an expired code are the same message. Supabase allows one
 * interval of clock skew on a 30-second window, so "expired" and "wrong" are
 * genuinely hard to tell apart, and a message that guesses would send somebody
 * to fix their phone's clock when they had simply mistyped.
 */
export function MfaChallenge() {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const { refresh } = useMfa();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  async function submit(event) {
    event.preventDefault();
    if (busy || !codeLooksComplete(code)) return;

    setBusy(true);
    setError(null);
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;

      const factor = verifiedTotpFactor(factors);
      if (!factor) {
        // Reaching this screen means the account HAS a verified factor, so an
        // empty list is a contradiction rather than a normal state. Say so
        // instead of showing a code field that can never succeed.
        setError(t('mfa.noFactorFound'));
        return;
      }

      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: cleanTotpCode(code),
      });
      if (verifyError) throw verifyError;

      // The library refreshes the session in the background on success; this
      // is what tells the rest of the app to stop asking.
      await refresh();
    } catch {
      setError(t('mfa.codeRejected'));
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <div className="card narrow">
        <h1 className="page-title">{t('mfa.challengeHeading')}</h1>
        <p className="muted">{t('mfa.challengeIntro')}</p>

        <form onSubmit={submit} noValidate>
          <label className="field">
            <span>{t('mfa.codeLabel')}</span>
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => {
                setCode(cleanTotpCode(e.target.value));
                setError(null);
              }}
              // A numeric keypad on a phone, and the OS offering the code it
              // just saw. Both are the difference between six taps and a
              // trip to another app and back.
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              disabled={busy}
              aria-describedby={error ? 'mfa-error' : undefined}
            />
          </label>

          {error && (
            <p className="error" id="mfa-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="primary" disabled={busy || !codeLooksComplete(code)}>
            {busy ? t('mfa.verifying') : t('mfa.verify')}
          </button>
        </form>

        <p className="fineprint">{t('mfa.lostDevice')}</p>
        <button type="button" className="link-button" onClick={signOut}>
          {t('common.signOut')}
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMfa } from '../context/MfaContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { cleanTotpCode, codeLooksComplete, verifiedTotpFactor } from '../lib/mfa.js';
import { CodeInput } from './CodeInput.jsx';

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

  async function submit(event) {
    // Called both from the form's onSubmit and from CodeInput's onComplete,
    // which has no event to prevent.
    event?.preventDefault?.();
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
          <CodeInput
            label={t('mfa.codeLabel')}
            value={code}
            onChange={(next) => {
              setCode(next);
              setError(null);
            }}
            // Six digits is the whole answer. Waiting for a button press asks
            // somebody to confirm something they have already finished saying.
            onComplete={() => submit()}
            disabled={busy}
            invalid={Boolean(error)}
            autoFocus
            describedBy={error ? 'mfa-error' : undefined}
          />

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

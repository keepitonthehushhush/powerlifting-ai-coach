import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { supabase } from '../lib/supabase.js';
import { checkPassword, MIN_LENGTH } from '../lib/passwordPolicy.js';
import { checkPwned } from '../lib/pwnedPassword.js';
import { Loading } from '../components/Loading.jsx';

/**
 * Where the link in the recovery email lands.
 *
 * ── HOW SOMEBODY GETS HERE ────────────────────────────────────────────────
 *
 * The email contains a one-time recovery token. Opening it puts that token in
 * the URL, the Supabase client exchanges it for a session, and fires a
 * PASSWORD_RECOVERY event. So by the time this page renders, the visitor is
 * signed in - on the strength of having received mail at an address the
 * account already had.
 *
 * That has two consequences worth stating, because both look like bugs
 * otherwise.
 *
 * This route is NOT behind ProtectedRoute, for the same reason the policy
 * pages are not: somebody arriving here has no session yet at the moment the
 * router first runs, and a redirect to /login would throw away the token in
 * the URL before it could be exchanged. It would also be circular - they are
 * here because they cannot get through /login.
 *
 * And there is no old-password field. At this point Supabase has already
 * verified a token it sent to the address on the account. Asking for the old
 * password would be asking for the thing they came here because they lost.
 *
 * ── THE RULES APPLY HERE TOO ──────────────────────────────────────────────
 *
 * Same strength checklist and same breach check as sign-up, deliberately. A
 * reset path that accepts a weak or breached password is a way around the
 * sign-up policy, and it is the more attractive way around because it is the
 * one an attacker reaches through a mailbox they have already compromised.
 */
export function ResetPassword() {
  const { updatePassword, session } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [breach, setBreach] = useState({ status: 'idle', count: 0 });

  // Three states, not two. "Still exchanging the token" has to be
  // distinguishable from "there was no valid token", or somebody who arrived
  // legitimately sees the expired-link message for the split second before
  // the exchange finishes - which is exactly the moment they would give up.
  const [recovery, setRecovery] = useState('checking');

  useEffect(() => {
    let cancelled = false;

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (!cancelled && event === 'PASSWORD_RECOVERY') setRecovery('ready');
    });

    // The event may already have fired before this component mounted, in which
    // case the listener never sees it and only the session survives. Checking
    // both is what makes this work on a cold load from the email link.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setRecovery((prev) => (prev === 'ready' ? prev : data.session ? 'ready' : 'invalid'));
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const policy = checkPassword(password);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!policy.ok) {
      setStatus({ kind: 'error', text: t('auth.passwordRules.weak') });
      return;
    }

    setBusy(true);
    setStatus(null);

    const result =
      breach.status === 'safe' || breach.status === 'breached' ? breach : await checkPwned(password);
    setBreach(result);
    if (result.status === 'breached') {
      setBusy(false);
      setStatus({ kind: 'error', text: t('auth.passwordRules.breachedBlocked') });
      return;
    }

    const { error } = await updatePassword(password);
    setBusy(false);

    if (error) {
      setStatus({ kind: 'error', text: error.message });
      return;
    }
    navigate('/coach', { replace: true });
  }

  // Somebody already signed in who wanders here has no business on this page.
  // A recovery session counts as signed in, so this must not fire while the
  // token is being exchanged - hence the check on `recovery` too.
  if (session && recovery === 'invalid') return <Navigate to="/coach" replace />;

  return (
    <div className="centered">
      <div className="card auth-card">
        <h1 className="brand">{t('common.appName')}</h1>
        <h2 className="page-title">{t('auth.reset.setTitle')}</h2>

        {recovery === 'checking' && <Loading size={72} />}

        {recovery === 'invalid' && (
          <>
            <p className="error">{t('auth.reset.linkExpired')}</p>
            <p className="muted small">{t('auth.reset.linkExpiredHelp')}</p>
            <button type="button" className="primary" onClick={() => navigate('/login')}>
              {t('auth.reset.backToSignIn')}
            </button>
          </>
        )}

        {recovery === 'ready' && (
          <form onSubmit={handleSubmit} className="stack">
            <label>
              {t('auth.reset.newPassword')}
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (breach.status !== 'idle') setBreach({ status: 'idle', count: 0 });
                }}
                onBlur={async () => {
                  if (password.length === 0) return;
                  setBreach({ status: 'checking', count: 0 });
                  setBreach(await checkPwned(password));
                }}
                required
                minLength={MIN_LENGTH}
                autoComplete="new-password"
                aria-describedby="reset-requirements"
              />
            </label>

            <div id="reset-requirements" className="fineprint">
              <p>{t('auth.passwordRules.requirements')}</p>
              <ul className="checklist">
                {policy.results.map(({ id, satisfied }) => (
                  <li key={id} className={satisfied ? 'met' : 'unmet'}>
                    <span aria-hidden="true">{satisfied ? '✓' : '•'}</span>{' '}
                    <span className="visually-hidden">
                      {t(satisfied ? 'auth.passwordRules.met' : 'auth.passwordRules.notMet')}:{' '}
                    </span>
                    {t(`auth.passwordRules.${id}`)}
                  </li>
                ))}
              </ul>
              <p className={breach.status === 'breached' ? 'error' : 'muted'} aria-live="polite">
                {breach.status === 'checking' && t('auth.passwordRules.breachChecking')}
                {breach.status === 'safe' && t('auth.passwordRules.breachSafe')}
                {breach.status === 'breached' &&
                  t('auth.passwordRules.breached', { count: breach.count.toLocaleString() })}
                {breach.status === 'unknown' && t('auth.passwordRules.breachUnknown')}
              </p>
            </div>

            {status && <p className={status.kind === 'error' ? 'error' : 'muted'}>{status.text}</p>}

            <button
              type="submit"
              className="primary"
              disabled={busy || !policy.ok || breach.status === 'breached'}
            >
              {busy ? t('common.working') : t('auth.reset.setPassword')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

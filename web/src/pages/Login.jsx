import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { LanguageSwitcher } from '../components/LanguageSwitcher.jsx';
import { checkPassword, MIN_LENGTH } from '../lib/passwordPolicy.js';
import { checkPwned } from '../lib/pwnedPassword.js';

export function Login() {
  const { session, signIn, signUp, lastSignOut } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  // 'idle' | 'checking' | 'safe' | 'breached' | 'unknown'
  const [breach, setBreach] = useState({ status: 'idle', count: 0 });

  const isSignUp = mode === 'signup';
  const policy = useMemo(() => checkPassword(password), [password]);

  // Read once, on mount. Reading it on every render would make the notice
  // vanish the moment anything else on this page changed.
  const [endedSession] = useState(() => lastSignOut?.() ?? null);

  if (session) return <Navigate to="/coach" replace />;

  /**
   * Checked when the field is left, not on every keystroke.
   *
   * Per-keystroke would send a request for every prefix of a password as it is
   * typed, which is both rude to a free service and a genuinely worse privacy
   * story than one request for the finished value - a sequence of prefixes
   * leaks more than any single one of them does.
   */
  async function checkBreached() {
    if (!isSignUp || password.length === 0) return;
    setBreach({ status: 'checking', count: 0 });
    setBreach(await checkPwned(password));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    // Checked here as well as by disabling the button: a submit can still
    // arrive by keyboard, and this branch is the one that decides.
    //
    // Only on sign-up. Applying the current rules at sign-in would lock out
    // every account created before they existed - the password is already set,
    // and refusing to send it does not make it stronger. Supabase reports a
    // weak existing password on sign-in as its own error, which is where a
    // prompt to change it belongs.
    if (isSignUp && !policy.ok) {
      setStatus({ kind: 'error', text: t('auth.password.weak') });
      return;
    }

    // The rules above defend against guessing. This defends against the attack
    // that actually works - an attacker replaying a password from somebody
    // else's breach - and it is checked here as well as on blur because a
    // keyboard submit can arrive before the field is ever blurred.
    if (isSignUp) {
      const result = breach.status === 'safe' || breach.status === 'breached'
        ? breach
        : await checkPwned(password);
      setBreach(result);
      if (result.status === 'breached') {
        setStatus({ kind: 'error', text: t('auth.password.breachedBlocked') });
        return;
      }
      // 'unknown' deliberately falls through. A third party being unreachable
      // is not a reason somebody cannot make an account.
    }

    setBusy(true);
    setStatus(null);

    const { error, data } =
      mode === 'signup' ? await signUp(email, password) : await signIn(email, password);

    setBusy(false);

    if (error) {
      setStatus({ kind: 'error', text: error.message });
      return;
    }
    if (mode === 'signup' && !data.session) {
      setStatus({ kind: 'info', text: t('auth.confirmEmail') });
    }
  }

  return (
    <div className="centered">
      <div className="card auth-card">
        <div className="row">
          <h1 className="brand">{t('common.appName')}</h1>
          <LanguageSwitcher />
        </div>
        <p className="muted">{t('auth.tagline')}</p>

        {/* Being returned to this page without asking to be is confusing, and
            until now it was also silent - the app simply rendered the sign-in
            form and nobody, including us, could say why.

            This is a diagnostic first and a courtesy second. It tells the
            person that something ended rather than that they imagined it, and
            it tells us WHICH of three indistinguishable faults happened: a
            sign-out, a token refresh that failed, or something else. No fix is
            being guessed at on the strength of a hypothesis; this is the
            instrument that decides which fix is the right one. */}
        {endedSession && (
          <p className="warning">
            {t('auth.sessionEnded')}{' '}
            <span className="muted small">({endedSession.reason})</span>
          </p>
        )}

        <form onSubmit={handleSubmit} className="stack">
          <label>
            {t('auth.email')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            {t('auth.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                // Any edit invalidates the previous verdict.
                if (breach.status !== 'idle') setBreach({ status: 'idle', count: 0 });
              }}
              onBlur={checkBreached}
              required
              minLength={isSignUp ? MIN_LENGTH : undefined}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              aria-describedby={isSignUp ? 'password-requirements' : undefined}
            />
          </label>

          {isSignUp && (
            <div id="password-requirements" className="fineprint">
              <p>{t('auth.password.requirements')}</p>
              <ul className="checklist">
                {policy.results.map(({ id, satisfied }) => (
                  <li key={id} className={satisfied ? 'met' : 'unmet'}>
                    {/* The tick is decorative - colour and shape alone do not
                        reach a screen reader, so the state is repeated as text
                        that is hidden visually but present in the accessibility
                        tree. */}
                    <span aria-hidden="true">{satisfied ? '\u2713' : '\u2022'}</span>{' '}
                    <span className="visually-hidden">
                      {t(satisfied ? 'auth.password.met' : 'auth.password.notMet')}:{' '}
                    </span>
                    {t(`auth.password.${id}`)}
                  </li>
                ))}
              </ul>
              <p>{t('auth.password.managerHint')}</p>

              {/* aria-live, because this arrives asynchronously after focus has
                  already moved on. Without it a screen reader user is told
                  nothing at all. */}
              <p className={breach.status === 'breached' ? 'error' : 'muted'} aria-live="polite">
                {breach.status === 'checking' && t('auth.password.breachChecking')}
                {breach.status === 'safe' && t('auth.password.breachSafe')}
                {breach.status === 'breached' &&
                  t('auth.password.breached', { count: breach.count.toLocaleString() })}
                {/* Said out loud rather than passed over in silence: "we could
                    not check" is not the same claim as "this is fine". */}
                {breach.status === 'unknown' && t('auth.password.breachUnknown')}
              </p>
            </div>
          )}

          <button
            type="submit"
            className="primary"
            disabled={busy || (isSignUp && (!policy.ok || breach.status === 'breached'))}
          >
            {busy ? t('common.working') : isSignUp ? t('auth.createAccount') : t('auth.signIn')}
          </button>
        </form>

        {status && <p className={status.kind === 'error' ? 'error' : 'muted'}>{status.text}</p>}

        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(isSignUp ? 'signin' : 'signup');
            setStatus(null);
          }}
        >
          {isSignUp ? t('auth.toSignIn') : t('auth.toSignUp')}
        </button>

        <p className="fineprint">{t('medical.disclaimer')}</p>
      </div>
    </div>
  );
}

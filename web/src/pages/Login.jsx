import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { LanguageSwitcher } from '../components/LanguageSwitcher.jsx';
import { checkPassword, MIN_LENGTH } from '../lib/passwordPolicy.js';
import { checkPwned } from '../lib/pwnedPassword.js';
import { Turnstile, resetTurnstile } from '../components/Turnstile.jsx';
import { enabled as captchaEnabled } from '../lib/turnstile.js';

export function Login() {
  const { session, signIn, signUp, resetPassword, lastSignOut } = useAuth();
  const { t } = useI18n();
  /**
   * Read once, from the URL, against a closed list.
   *
   * The landing page's primary button says "create your account", and until
   * this existed it produced the SIGN-IN form - the same class of untruth as a
   * field labelled "Username or Email" on a form that only accepts email.
   *
   * Validated against the three modes this component knows rather than trusted
   * as a string, so `?mode=` cannot put the form into a state that does not
   * exist. Reset stays out of it: that flow has its own route, because it
   * arrives from an email carrying a token.
   */
  const [mode, setMode] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('mode');
    return requested === 'signup' ? 'signup' : 'signin';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaBlocked, setCaptchaBlocked] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  // 'idle' | 'checking' | 'safe' | 'breached' | 'unknown'
  const [breach, setBreach] = useState({ status: 'idle', count: 0 });

  const isSignUp = mode === 'signup';
  const isReset = mode === 'reset';
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

  /**
   * Requests the recovery email.
   *
   * ── THE MESSAGE IS THE SAME EITHER WAY, ON PURPOSE ─────────────────────
   *
   * "If an account exists for that address" rather than "sent" or "no such
   * account". A reset form that distinguishes the two is an account
   * enumeration oracle: type addresses in, read which ones come back
   * differently, and you have a list of who uses this product. On a product
   * whose users have recorded injuries and drinking habits, membership of the
   * list is itself the sensitive fact.
   *
   * The same reasoning applies to the ERROR path, which is the part that is
   * easy to get right in the happy case and leak in the unhappy one. Supabase
   * rate-limits this endpoint, and surfacing its error verbatim would say
   * different things for a real address than for one that was never
   * registered. So nothing from the call reaches the screen: the same sentence
   * is shown whatever happened.
   */
  async function handleReset(event) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    await resetPassword(email, captchaToken ?? undefined);
    setBusy(false);

    /**
     * The reset request is the endpoint most worth protecting and the one
     * people forget: it is unauthenticated, it sends mail, and it costs an
     * attacker nothing. Leaving it uncovered while guarding sign-in would
     * protect the expensive door and leave the cheap one open.
     *
     * Reset the widget here too - same single-use token, same trap.
     */
    if (captchaEnabled()) {
      setCaptchaToken(null);
      resetTurnstile();
    }

    // Deliberately not branching on the result. See above.
    setStatus({ kind: 'info', text: t('auth.reset.sent') });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isReset) return handleReset(event);

    // Checked here as well as by disabling the button: a submit can still
    // arrive by keyboard, and this branch is the one that decides.
    //
    // Only on sign-up. Applying the current rules at sign-in would lock out
    // every account created before they existed - the password is already set,
    // and refusing to send it does not make it stronger. Supabase reports a
    // weak existing password on sign-in as its own error, which is where a
    // prompt to change it belongs.
    if (isSignUp && !policy.ok) {
      setStatus({ kind: 'error', text: t('auth.passwordRules.weak') });
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
        setStatus({ kind: 'error', text: t('auth.passwordRules.breachedBlocked') });
        return;
      }
      // 'unknown' deliberately falls through. A third party being unreachable
      // is not a reason somebody cannot make an account.
    }

    setBusy(true);
    setStatus(null);

    const { error, data } =
      mode === 'signup'
        ? await signUp(email, password, captchaToken ?? undefined)
        : await signIn(email, password, captchaToken ?? undefined);

    setBusy(false);

    /**
     * Reset AFTER EVERY ATTEMPT, including the failed ones.
     *
     * A Turnstile token is single-use. Without this, somebody who mistypes
     * their password, is told so, corrects it and presses sign in again gets
     * a CAPTCHA failure on a spent token - which reads as the app rejecting a
     * password they know is right, fixable only by a page reload they have no
     * reason to try.
     */
    if (captchaEnabled()) {
      setCaptchaToken(null);
      resetTurnstile();
    }

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
        <p className="muted">{isReset ? t('auth.reset.requestIntro') : t('auth.tagline')}</p>

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
          {!isReset && (
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
          )}

          {isSignUp && (
            <div id="password-requirements" className="fineprint">
              <p>{t('auth.passwordRules.requirements')}</p>
              <ul className="checklist">
                {policy.results.map(({ id, satisfied }) => (
                  <li key={id} className={satisfied ? 'met' : 'unmet'}>
                    {/* The tick is decorative - colour and shape alone do not
                        reach a screen reader, so the state is repeated as text
                        that is hidden visually but present in the accessibility
                        tree. */}
                    <span aria-hidden="true">{satisfied ? '\u2713' : '\u2022'}</span>{' '}
                    <span className="visually-hidden">
                      {t(satisfied ? 'auth.passwordRules.met' : 'auth.passwordRules.notMet')}:{' '}
                    </span>
                    {t(`auth.passwordRules.${id}`)}
                  </li>
                ))}
              </ul>
              <p>{t('auth.passwordRules.managerHint')}</p>

              {/* aria-live, because this arrives asynchronously after focus has
                  already moved on. Without it a screen reader user is told
                  nothing at all. */}
              <p className={breach.status === 'breached' ? 'error' : 'muted'} aria-live="polite">
                {breach.status === 'checking' && t('auth.passwordRules.breachChecking')}
                {breach.status === 'safe' && t('auth.passwordRules.breachSafe')}
                {breach.status === 'breached' &&
                  t('auth.passwordRules.breached', { count: breach.count.toLocaleString() })}
                {/* Said out loud rather than passed over in silence: "we could
                    not check" is not the same claim as "this is fine". */}
                {breach.status === 'unknown' && t('auth.passwordRules.breachUnknown')}
              </p>
            </div>
          )}

          {/* The widget sits directly above the button it gates, which is the
              only place it reads as part of the action rather than an advert.
              Renders nothing when no site key is configured. */}
          <Turnstile onToken={setCaptchaToken} onUnavailable={() => setCaptchaBlocked(true)} />

          {captchaBlocked && (
            <p className="error">{t('auth.captcha.blocked')}</p>
          )}

          <button
            type="submit"
            className="primary"
            disabled={
              busy ||
              (isSignUp && (!policy.ok || breach.status === 'breached')) ||
              // Disabled rather than allowed-and-rejected. Pressing a button
              // that is certain to fail teaches people the app is unreliable.
              (captchaEnabled() && !captchaBlocked && !captchaToken)
            }
          >
            {busy
              ? t('common.working')
              : isReset
                ? t('auth.reset.send')
                : isSignUp
                  ? t('auth.createAccount')
                  : t('auth.signIn')}
          </button>
        </form>

        {status && <p className={status.kind === 'error' ? 'error' : 'muted'}>{status.text}</p>}

        {/* ── THE OTHER TWO THINGS YOU MIGHT BE HERE TO DO ──────────────────
            These were two bare <button className="link"> siblings in a card
            that is a plain block, so - buttons being inline-block - they
            rendered on ONE LINE, running together into something that read as
            a single sentence: "Forgot your password? New here? Create an
            account". Three separate choices presented as one run of text.

            Each is now its own row, under a rule that separates them from the
            form, and each is a question followed by the answer rather than a
            fragment. The prompt says what situation you are in; the link says
            what pressing it does. */}
        <div className="auth-alternatives">
          {/* Offered on the sign-in form rather than only after a failed
              attempt. Somebody who knows they have forgotten should not have
              to get it wrong first to be told there is a way out - and making
              them guess is how people end up reusing a password they can
              remember. */}
          {!isReset && (
            <div className="auth-alternative">
              <span className="muted small">{t('auth.forgotPrompt')}</span>
              <button
                type="button"
                className="link strong"
                onClick={() => {
                  setMode('reset');
                  setStatus(null);
                }}
              >
                {t('auth.reset.forgotAction')}
              </button>
            </div>
          )}

          <div className="auth-alternative">
            {!isReset && (
              <span className="muted small">
                {isSignUp ? t('auth.haveAccountPrompt') : t('auth.newHerePrompt')}
              </span>
            )}
            <button
              type="button"
              className="link strong"
              onClick={() => {
                setMode(isReset ? 'signin' : isSignUp ? 'signin' : 'signup');
                setStatus(null);
              }}
            >
              {isReset ? t('auth.reset.backToSignIn') : isSignUp ? t('auth.signIn') : t('auth.createAccount')}
            </button>
          </div>
        </div>

        <p className="fineprint">
          {t('medical.disclaimer')}{' '}
          {/* Next to the medical disclaimer rather than in the navigation:
              the moment somebody wonders whether this is safe is the moment
              the page answering that question should be one click away. The
              FAQ sits with it for the same reason: the person deciding whether
              to type their injuries into a stranger's website is standing on
              this screen, not inside the app. */}
          <Link to="/about">{t('common.forYourClinician')}</Link>
          {' · '}
          <Link to="/faq">{t('common.faq')}</Link>
        </p>
      </div>
    </div>
  );
}

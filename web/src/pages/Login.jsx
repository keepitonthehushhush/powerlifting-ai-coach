import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { LanguageSwitcher } from '../components/LanguageSwitcher.jsx';

export function Login() {
  const { session, signIn, signUp } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/coach" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
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
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </label>

          <button type="submit" className="primary" disabled={busy}>
            {busy ? t('common.working') : mode === 'signup' ? t('auth.createAccount') : t('auth.signIn')}
          </button>
        </form>

        {status && <p className={status.kind === 'error' ? 'error' : 'muted'}>{status.text}</p>}

        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === 'signup' ? 'signin' : 'signup');
            setStatus(null);
          }}
        >
          {mode === 'signup' ? t('auth.toSignIn') : t('auth.toSignUp')}
        </button>

        <p className="fineprint">{t('medical.disclaimer')}</p>
      </div>
    </div>
  );
}

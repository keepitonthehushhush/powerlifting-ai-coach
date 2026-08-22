import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function Login() {
  const { session, signIn, signUp } = useAuth();
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
      setStatus({ kind: 'info', text: 'Check your email to confirm your account, then sign in.' });
    }
  }

  return (
    <div className="centered">
      <div className="card auth-card">
        <h1 className="brand">Coach</h1>
        <p className="muted">
          Structured powerlifting programming that adapts to what you actually lift.
        </p>

        <form onSubmit={handleSubmit} className="stack">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            Password
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
            {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
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
          {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>

        <p className="fineprint">
          Coach is an AI tool, not a medical professional. If you have current pain, an injury, or
          a health condition, get clearance from a doctor or physical therapist before training.
        </p>
      </div>
    </div>
  );
}

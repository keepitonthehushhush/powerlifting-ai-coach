import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import { useMfa } from './MfaContext.jsx';
import { evaluateConsentGate } from '../lib/consentGate.js';

/**
 * Current consent state for the signed-in user.
 *
 * Loaded once per session rather than per route: it changes only when the
 * person changes it, and refetching on every navigation would put a network
 * round trip in front of every screen. `refresh()` is called explicitly after
 * a decision is recorded.
 *
 * The state is not trusted for anything that matters. The server re-reads the
 * ledger on every request, and the database refuses health-data writes without
 * an active consent regardless of what this context happens to hold. What it
 * is for is asking the person at the right moment.
 */
const ConsentContext = createContext(null);

export function ConsentProvider({ children }) {
  const { user } = useAuth();
  /*
   * A half-finished sign-in is not a signed-in person. See the effect below;
   * this is why MfaProvider sits above this one in App.jsx.
   */
  const { checked: mfaChecked, satisfied: mfaSatisfied } = useMfa();
  const userId = user?.id ?? null;
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('idle');

  const load = useCallback(async () => {
    // 'refreshing' rather than 'loading' once something is already known. The
    // distinction is what lets ProtectedRoute keep the current page mounted
    // while this is in flight, instead of replacing it with a spinner and
    // destroying whatever the person was typing.
    setStatus((prev) => (prev === 'ready' ? 'refreshing' : 'loading'));
    try {
      setState(await api.getConsents());
      setStatus('ready');
    } catch (err) {
      setState(null);
      /*
       * ── "FINISH SIGNING IN" IS NOT "SOMETHING BROKE" ──────────────────
       *
       * A 401 carrying mfa_required means the token is aal1: the password
       * went through and the second factor has not. Treating that as an error
       * is what put "We could not load your privacy choices - that is a
       * problem on our end" in front of somebody whose only mistake was
       * having MFA turned on, on an ordinary sign-in, with nothing wrong.
       *
       * The effect below now waits for the challenge, so this should not be
       * reachable on the sign-in path any more. It stays because the token can
       * drop back to aal1 mid-session on a refresh, and because a state this
       * alarming should need more than one thing to go right to appear.
       *
       * 'idle' rather than 'error': the answer is not known yet, which is
       * exactly what idle means here, and ProtectedRoute renders the challenge
       * above the consent gate anyway.
       */
      setStatus(err?.code === 'mfa_required' ? 'idle' : 'error');
    }
  }, []);

  /*
   * Keyed on the user's id, not the session object: a refreshed token is the
   * same person and must not trigger a refetch.
   *
   * AND ON WHETHER THE SIGN-IN IS FINISHED. /api/consent requires a second
   * factor from an account that has one, so asking before the challenge is
   * answered spends a request to be told "not yet" - and the answer is
   * indistinguishable, from here, from the server being down. When the factor
   * lands, `mfaSatisfied` flips and this effect runs the load it was always
   * going to run, once, at the moment it can succeed.
   */
  useEffect(() => {
    if (!userId || !mfaChecked || !mfaSatisfied) {
      setState(null);
      setStatus('idle');
      return;
    }
    load();
  }, [userId, mfaChecked, mfaSatisfied, load]);

  const value = useMemo(
    () => ({ state, status, refresh: load, gate: evaluateConsentGate(state) }),
    [state, status, load]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent() {
  const value = useContext(ConsentContext);
  if (!value) throw new Error('useConsent must be used inside a ConsentProvider');
  return value;
}

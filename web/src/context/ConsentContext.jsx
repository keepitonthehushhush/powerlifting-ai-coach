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
/**
 * How long to wait before trying a failed consent read again.
 *
 * ── WHY ONE DROPPED REQUEST MUST NOT BE A WALL ────────────────────────────
 *
 * An athlete signed up on 2026-09-02, completed the whole intake, and the only
 * thing in their error log is `storage_unavailable` on /api/consent. They
 * never sent a message and never came back. ProtectedRoute already carries
 * that date in a comment, because a previous fix stopped this dead end being
 * REACHED by a redirect - but it did not stop it being reached by one bad
 * request, which is what actually happened to them.
 *
 * The screen they got says "That is a problem on our end" over a Try again
 * button, which is honest and is also the last screen in the product for
 * somebody with no reason to persist yet. A single transient failure should
 * not be able to produce it.
 *
 * ── AND WHY THIS DOES NOT WEAKEN THE GATE ─────────────────────────────────
 *
 * Nothing here changes what happens on a definite answer. The gate still fails
 * closed, an unreadable state is still "not granted", and a 4xx still stops
 * immediately - retrying a refusal would be a loop, not a recovery. Only
 * failures that look transient are tried again: no status at all, which is a
 * dropped connection, or a 5xx, which is us.
 *
 * Two retries and roughly 1.6 seconds. Long enough to ride out a cold
 * serverless start or a blip; short enough that somebody staring at a spinner
 * is not being lied to about progress.
 */
const RETRY_DELAYS_MS = [400, 1200];

/** A failure worth trying again, as opposed to an answer. */
export function isTransient(err) {
  const status = err?.status;
  // No status is a network failure - the request never got an answer at all.
  if (status == null) return true;
  // A refusal is a decision. Asking again cannot change it, and 401 in
  // particular is handled on its own path below.
  if (status >= 400 && status < 500) return false;
  return true;
}

async function withRetries(attempt) {
  for (let i = 0; ; i += 1) {
    try {
      return await attempt();
    } catch (err) {
      if (i >= RETRY_DELAYS_MS.length || !isTransient(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
    }
  }
}

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
      setState(await withRetries(() => api.getConsents()));
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

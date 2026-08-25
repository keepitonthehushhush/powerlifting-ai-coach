import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
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
    } catch {
      // The error itself is deliberately not surfaced. A failure to READ
      // consent tells the person nothing they can act on, and the gate treats
      // an unreadable state as "not granted" anyway.
      setState(null);
      setStatus('error');
    }
  }, []);

  // Keyed on the user's id, not the session object. A refreshed token is the
  // same person and must not trigger a refetch.
  useEffect(() => {
    if (!userId) {
      setState(null);
      setStatus('idle');
      return;
    }
    load();
  }, [userId, load]);

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

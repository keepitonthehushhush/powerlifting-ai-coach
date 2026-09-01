import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthContext.jsx';
import { describeMfaState } from '../lib/mfa.js';

/**
 * Whether this session has finished proving who it belongs to.
 *
 * ── WHY IT IS A PROVIDER AND NOT A HOOK IN ProtectedRoute ─────────────────
 *
 * ProtectedRoute renders on every route change. A hook there would re-ask on
 * every navigation, and - more importantly - each route would hold its own
 * copy of the answer, so verifying a code on one screen would leave the next
 * one still believing the session was weak. One provider, one answer, one
 * place to refresh it from.
 *
 * ── WHY `unknown` BLOCKS ──────────────────────────────────────────────────
 *
 * `satisfied` is false while the answer is loading and false for any level
 * pair Supabase might add later. That is the opposite of the usual instinct -
 * default to letting people through - and it is deliberate: the failure mode
 * of blocking is a spinner somebody complains about, and the failure mode of
 * passing is the control silently not existing. This project has had the
 * second kind of bug repeatedly and never the first.
 *
 * The one thing that must NOT block is somebody with no factor at all, and
 * that is `notEnrolled`, which is a definite answer rather than an unknown.
 */
const MfaContext = createContext(null);

export function MfaProvider({ children }) {
  const { session } = useAuth();
  const [levels, setLevels] = useState(null);
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) {
      setLevels(null);
      setChecked(true);
      return;
    }
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      // An error is not "no MFA". It is not knowing, and describeMfaState
      // reads a null pair as `unknown`, which does not satisfy the gate.
      setLevels(error ? null : data);
    } catch {
      setLevels(null);
    } finally {
      setChecked(true);
    }
  }, [session]);

  useEffect(() => {
    setChecked(false);
    void refresh();
  }, [refresh]);

  const value = useMemo(() => {
    const verdict = describeMfaState(levels);
    return {
      ...verdict,
      // Loading is its own state. A component that shows a code field while
      // the answer is still in flight asks people who never enrolled for a
      // code they do not have.
      checked,
      refresh,
    };
  }, [levels, checked, refresh]);

  return <MfaContext.Provider value={value}>{children}</MfaContext.Provider>;
}

export function useMfa() {
  const value = useContext(MfaContext);
  if (!value) throw new Error('useMfa must be used inside an MfaProvider');
  return value;
}

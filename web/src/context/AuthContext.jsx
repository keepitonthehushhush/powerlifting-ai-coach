import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

/**
 * Session state, sourced from Supabase and kept current by its auth listener.
 *
 * `loading` matters more than it looks: on a hard refresh the SDK restores the
 * session from storage asynchronously. Without an explicit loading state the
 * app renders one frame with no session and bounces an authenticated user to
 * the login screen before correcting itself.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Supabase fires this on tab focus as well as on sign-in and sign-out,
    // because it refreshes the access token when the tab becomes visible
    // again. The refreshed session is a NEW object with a NEW token, so
    // setting it unconditionally changes this context's identity several times
    // an hour for a user who is doing nothing but switching windows.
    //
    // Downstream that was not harmless: ConsentProvider re-fetched, and
    // ProtectedRoute showed its loading state while the fetch was in flight,
    // which UNMOUNTED the page underneath. Anyone part-way through the intake
    // form lost every field they had typed by switching to another app and
    // back. That is the kind of bug that makes people abandon a signup.
    //
    // Nothing here needs the refreshed token: api.js reads the current one
    // from the Supabase client on every request, so it is always fresh
    // regardless of what this context holds. What consumers actually care
    // about is WHO is signed in, so that is what this compares on.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession((prev) => {
        if (prev?.user?.id === next?.user?.id) return prev;
        return next;
      });
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signUp: (email, password) => supabase.auth.signUp({ email, password }),
      signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
      signOut: () => supabase.auth.signOut(),
    }),
    [session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

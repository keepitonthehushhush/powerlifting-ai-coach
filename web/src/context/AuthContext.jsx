import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { clearSignOutReason, recordSignOut, readSignOutReason } from '../lib/signOutReason.js';

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
  /** Whether a session has ever been in hand. See the listener below. */
  const hadSession = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      hadSession.current = Boolean(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      // ── WHY THE EVENT NAME IS RECORDED ────────────────────────────────
      //
      // Reported: coming back to the app after following a link out of it
      // sometimes lands on the sign-in screen. It is not a deliberate
      // timeout - checked against the live auth tables, where not one session
      // carries a `not_after`, so nothing server-side is expiring anybody, and
      // sessions over a day old were still being refreshed normally.
      //
      // Which leaves the client, where a silent sign-out is indistinguishable
      // from a bug: the app simply renders the login page and nobody can say
      // whether Supabase signed the user out, a token refresh failed, or the
      // stored session was never read back at all. Three different faults,
      // one identical symptom, and no way to tell them apart after the fact.
      //
      // So before theorising, make it legible. The event name that preceded
      // the sign-out is kept, and the login page says which one it was. The
      // leading suspect is refresh-token rotation racing itself when a page is
      // restored from the back-forward cache - two restores presenting the
      // same rotated token, the second rejected - but that is a hypothesis,
      // and this is the instrument that will confirm or kill it. Deliberately
      // no fix is being shipped on a guess.
      //
      // What is stored is one event name and a timestamp. No token, no email,
      // no user id: this is a diagnostic, not a session record, and it is
      // cleared the moment somebody signs in again.
      // Only a real transition counts. Supabase fires INITIAL_SESSION with a
      // null session on every cold load for anybody not signed in, and
      // recording that would greet every first-time visitor with a notice that
      // their session had ended.
      if (hadSession.current && !next) recordSignOut(event);
      if (next) clearSignOutReason();
      hadSession.current = Boolean(next);

      // Supabase fires this on tab focus as well as on sign-in and sign-out,
      // because it refreshes the access token when the tab becomes visible
      // again. The refreshed session is a NEW object with a NEW token, so
      // setting it unconditionally changes this context's identity several
      // times an hour for a user who is doing nothing but switching windows.
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
      /**
       * Sends the recovery email.
       *
       * The redirect target must be on Supabase's allow-list or the link in
       * the email refuses to complete, which is the failure people hit and
       * cannot debug: the mail arrives, the link opens, and nothing happens.
       * It is built from the live origin rather than hardcoded so that
       * localhost, a preview deployment and production each ask for
       * themselves - a hardcoded production URL would send a developer
       * testing locally to the live site.
       */
      resetPassword: (email) =>
        supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        }),

      /**
       * Sets the new password, using the recovery session the link created.
       *
       * There is no old-password argument and that is not an oversight: at
       * this point the caller holds a recovery token that Supabase has already
       * verified against the address that received the mail. Asking for the
       * old password would be asking for the thing they came here because
       * they do not have.
       */
      updatePassword: (password) => supabase.auth.updateUser({ password }),

      signOut: () => {
        // A sign-out the person asked for is not a fault, and must not show up
        // on the login screen as though something went wrong.
        clearSignOutReason();
        return supabase.auth.signOut();
      },
      /** Why the last session ended, when it did not end on purpose. */
      lastSignOut: readSignOutReason,
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

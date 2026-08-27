/**
 * Why the last session ended, kept just long enough to show on the login page.
 *
 * ── THE BUG THIS IS AN INSTRUMENT FOR, NOT A FIX FOR ──────────────────────
 *
 * Reported: following a link out of the app and coming back sometimes lands on
 * the sign-in screen. It is not a deliberate timeout. Checked against the live
 * auth tables rather than assumed: not one session row carries a `not_after`,
 * so nothing server-side is expiring anybody, and sessions more than a day old
 * were still refreshing normally.
 *
 * That leaves the client, where three different faults produce one identical
 * symptom - the login page:
 *
 *   1. Supabase signed the user out (SIGNED_OUT)
 *   2. a token refresh failed, so the SDK gave up the session
 *   3. the stored session was never read back at all, and the app has simply
 *      never known about it
 *
 * Nothing currently distinguishes them, which is why this has been guessed
 * about rather than diagnosed. An opaque symptom is not a clue, it is the
 * absence of one, and the first useful move is to widen the instrument rather
 * than start proposing fixes.
 *
 * ── WHAT IS STORED, AND WHY THAT IS ALL ───────────────────────────────────
 *
 * One event name and one timestamp. No token, no email, no user id, nothing
 * about health. This is a breadcrumb, not a session record: it must be able to
 * sit in browser storage on a possibly shared computer without being worth
 * anything to whoever finds it. It is cleared the moment anyone signs in, and
 * on a deliberate sign-out it is never written at all - being signed out
 * because you asked to be is not a fault and must not be reported as one.
 *
 * `sessionStorage`, not `localStorage`, and that is the same decision. It dies
 * with the tab, which is exactly the lifetime a diagnostic about "what
 * happened just now" should have, and it never outlives the browsing session
 * the way an app-level record would.
 *
 * Every access is wrapped: storage throws outright in a Safari private window
 * and in any browser configured to block site data, and a diagnostic that
 * breaks the sign-in page it is diagnosing would be a poor trade.
 */

const KEY = 'coach.lastSignOut';

/**
 * Records the Supabase event name that arrived with a session going away.
 *
 * The caller must only invoke this on a real TRANSITION - a session that
 * existed and now does not. Supabase fires INITIAL_SESSION with a null session
 * on every cold load for anybody who is simply not signed in, and recording
 * that would put "your session ended" in front of every first-time visitor,
 * which is both wrong and alarming. Whether a session existed is the caller's
 * knowledge, not this module's.
 *
 * The event name is stored as Supabase gives it: it comes from that SDK's own
 * fixed set, and which one it is - SIGNED_OUT against TOKEN_REFRESHED against
 * anything else - is the entire content of the diagnostic.
 */
export function recordSignOut(event) {
  try {
    window.sessionStorage?.setItem(
      KEY,
      JSON.stringify({ reason: String(event ?? 'UNKNOWN'), at: new Date().toISOString() })
    );
  } catch {
    // Storage unavailable. The diagnostic is lost; the app is not.
  }
}

export function clearSignOutReason() {
  try {
    window.sessionStorage?.removeItem(KEY);
  } catch {
    /* as above */
  }
}

/** @returns {{reason: string, at: string} | null} */
export function readSignOutReason() {
  try {
    const raw = window.sessionStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.reason === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

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
 * The reasons this app records for itself.
 *
 * Supabase's own event names arrive here too - SIGNED_OUT and the rest - and
 * are stored as given. This is the short list of things WE know that the SDK
 * does not.
 */
export const SIGN_OUT_REASONS = Object.freeze({
  /** The API rejected the stored session outright. See sessionIsDead. */
  serverRejected: 'SERVER_REJECTED_SESSION',
  /** The person pressed the button. Not a fault, and shows no notice. */
  deliberate: 'DELIBERATE',
});

/**
 * What the NEXT sign-out means, declared by whoever is about to cause it.
 *
 * ── THE ORDERING BUG THIS EXISTS TO FIX ───────────────────────────────────
 *
 * Reported on 2026-08-31: signing out of the iPhone app and back in showed
 * "You were signed out and we are not sure why (SIGNED_OUT)" on the login
 * screen. Every deliberate sign-out did this, and the cause is an inverted
 * order that reads correctly in both places it is written.
 *
 * AuthContext's signOut() cleared the breadcrumb and then called
 * supabase.auth.signOut(). That call fires SIGNED_OUT, the listener sees a
 * session becoming null, and it records the event - writing the breadcrumb
 * straight back, a few milliseconds after it was deliberately erased. The
 * clear was correct, the record was correct, and the sequence was wrong.
 *
 * api.js has the same shape for a different reason: it records
 * SERVER_REJECTED_SESSION and then signs out, and the listener would overwrite
 * that specific diagnosis with the generic event name.
 *
 * So the cause declares itself BEFORE the sign-out rather than writing the
 * breadcrumb around it, and the listener - which is the last thing to run -
 * asks what was declared instead of guessing from the event.
 *
 * Module-level rather than passed through, because the two callers and the
 * listener have no reference to each other: one is a context method, one is
 * the fetch wrapper, and the listener is a subscription created at mount.
 */
let declaredIntent = null;

/** Called immediately before a sign-out this app is causing on purpose. */
export function declareSignOutIntent(reason) {
  declaredIntent = reason ?? null;
}

/**
 * Reads and clears the declaration.
 *
 * Cleared on read so an unrelated later sign-out - a refresh token genuinely
 * expiring an hour afterwards - is not attributed to a reason that has
 * nothing to do with it.
 */
export function takeSignOutIntent() {
  const reason = declaredIntent;
  declaredIntent = null;
  return reason;
}

/**
 * Does this API failure mean the STORED SESSION is dead, rather than the
 * request being bad?
 *
 * ── THE STUCK STATE THIS EXISTS TO END ────────────────────────────────────
 *
 * Reported on 2026-08-31, on the website on an iPhone: "invalid or expired
 * session" and it "does not remove with refreshes". That is the API's 401,
 * and a refresh could not clear it because nothing about a refresh changes
 * the fact: getSession() reads the stored session out of local storage
 * WITHOUT verifying it, so the app believed it was signed in, sent a token the
 * server had already revoked, and got the same 401 forever.
 *
 * What revoked it is the feature we shipped that afternoon. Verifying an MFA
 * factor signs out every other session - Supabase documents it, the enrollment
 * screen says so - and every other session includes the one sitting in Safari.
 * The SDK would have noticed eventually, when the access token expired and the
 * refresh failed, which is up to an hour of an app that cannot work and cannot
 * explain itself.
 *
 * So the app stops waiting to be told. A 401 carrying `auth_required` IS the
 * server saying this token is finished, and the only correct response is to
 * drop the local session and show the sign-in screen.
 *
 * `mfa_required` is deliberately NOT included, and the distinction is the
 * whole reason these are two codes rather than one. That session is valid and
 * merely unfinished; signing it out would throw away a correct login and send
 * somebody back to a password field they had just used.
 */
export function sessionIsDead(failure) {
  // Read rather than destructured with a default: `= {}` covers `undefined`
  // and NOT `null`, and a caller handing this a null body is the ordinary
  // case - api.js parses the response with `.catch(() => null)`. A test found
  // it before production did, which is the entire argument for the test.
  return failure?.status === 401 && failure?.code === 'auth_required';
}

/**
 * Which sentence belongs on the login page - never the raw code.
 *
 * ── WHY THE CODE CAME OFF THE SCREEN ──────────────────────────────────────
 *
 * The message used to read "You were signed out and we are not sure why" with
 * `(SIGNED_OUT)` after it, and that was correct when it was written: this file
 * was built as an INSTRUMENT for a bug with three indistinguishable causes,
 * and the code was the whole content of the diagnostic.
 *
 * It did its job. `SERVER_REJECTED_SESSION` exists because of what it found.
 * But a person reading "we are not sure why (SIGNED_OUT)" is being shown the
 * inside of the machine and told the operator is confused, which is not a
 * thing to put in front of somebody who just wants to log a squat. The code
 * still ships - on a data attribute, where a developer can read it and a
 * person cannot.
 */
export function describeSignOut(reason) {
  if (reason === SIGN_OUT_REASONS.serverRejected) return 'auth.signedOutRevoked';
  if (reason === 'SIGNED_OUT') return 'auth.signedOutPlain';
  return 'auth.signedOutGeneric';
}

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

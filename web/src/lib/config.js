/**
 * Browser configuration, read once and reported honestly when absent.
 *
 * WHY THIS MODULE EXISTS. `supabase.js` used to throw at module load when
 * VITE_SUPABASE_URL was missing. That throw happened before React mounted, so
 * the entire application rendered as an empty <body> - a black page, because
 * that is the CSS background. No error, no message, nothing in the UI to
 * indicate what was wrong.
 *
 * That is exactly what happened on the first production deploy: the VITE_
 * variables were not set when Vercel built, Vite inlined `undefined`, and the
 * site was a blank rectangle. The diagnosis had to come from comparing asset
 * hashes between two builds, which is not a debugging experience anyone should
 * inherit.
 *
 * Failing loudly at the boundary is right - the server does exactly this in
 * server/src/config.js, and should. But a browser has somewhere to PUT the
 * error, and a user staring at a black page has no console open. So: detect
 * the problem, render something that says what is missing and how to fix it,
 * and never let a configuration mistake masquerade as a broken app.
 */

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];

/** Vite replaces import.meta.env.X at build time, so these must be literal. */
const RAW = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
};

/**
 * Which required variables are absent.
 *
 * A variable missing at BUILD time is inlined as undefined, so this reports
 * the same thing whether it was never set or set after the build - both of
 * which need the same fix: set it, then rebuild.
 */
export function missingConfig() {
  return REQUIRED.filter((key) => {
    const value = RAW[key];
    return !value || typeof value !== 'string' || value.trim() === '' || value === 'undefined';
  });
}

/**
 * Configuration that is PRESENT but wrong.
 *
 * missingConfig() catches an empty variable. This catches the other failure,
 * which is quieter and worse: a variable that is set to a plausible-looking
 * value that happens to be the wrong one.
 *
 * The specific case is VITE_API_BASE_URL set to the Supabase project URL. It
 * is an easy mistake - the two sit next to each other in a dashboard, both are
 * https URLs, and one of them genuinely is a Supabase address. But this one
 * prefixes our own API paths, so setting it that way sends every coaching
 * request to `https://<project>.supabase.co/api/chat`, which does not exist.
 * Every feature in the app fails with a 404 while the login screen, which
 * talks to Supabase directly, keeps working perfectly - so the app looks half
 * alive and the cause is nowhere near the symptom.
 *
 * Left alone it is correct: unset means '' means same-origin, which is what a
 * deployment where the API and the client share a host actually wants. So the
 * guard fires only on a value that could not possibly be right.
 */
export function misconfigured() {
  const problems = [];
  const apiBase = RAW.VITE_API_BASE_URL;

  if (typeof apiBase === 'string' && /\.supabase\.(co|in)\b/i.test(apiBase)) {
    problems.push(
      'VITE_API_BASE_URL points at Supabase. It should be empty when the API is ' +
        'served from the same host as this page, which is the normal setup. As set, ' +
        'every request to this app\u2019s own API would 404.'
    );
  }

  return problems;
}

export const config = {
  supabaseUrl: RAW.VITE_SUPABASE_URL,
  supabasePublishableKey: RAW.VITE_SUPABASE_PUBLISHABLE_KEY,
  // Empty means same-origin. See misconfigured() for the one value that is
  // certainly wrong here.
  apiBaseUrl: RAW.VITE_API_BASE_URL ?? '',
};

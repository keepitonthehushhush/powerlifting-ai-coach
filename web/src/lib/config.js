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

export const config = {
  supabaseUrl: RAW.VITE_SUPABASE_URL,
  supabasePublishableKey: RAW.VITE_SUPABASE_PUBLISHABLE_KEY,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
};

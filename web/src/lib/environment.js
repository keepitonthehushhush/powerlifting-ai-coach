/**
 * Which build this is, in the browser.
 *
 * The mirror of server/src/lib/environment.js, and it exists for the half of
 * the problem the server cannot see: `VITE_SUPABASE_URL` is baked into the
 * BUNDLE at build time, so a preview build carrying production's URL talks to
 * production from the browser directly, whatever the API is configured with.
 * The server refusing to serve would not stop it - Supabase Auth and any
 * direct PostgREST call go straight from the page.
 *
 * VERCEL_ENV is replaced at build time by vite.config.js, for the same reason
 * as __BUILD_ID__: it is a fact about the build, and reading it at runtime in
 * a browser is not possible.
 */

/** Public by design: half of VITE_SUPABASE_URL, compiled into every bundle. */
export const PRODUCTION_SUPABASE_REF = 'pwbkdxnvubtflgpqpest';

/** `https://abc.supabase.co` → `abc`. Null for anything not of that shape. */
export function supabaseRef(url) {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)/i.exec(String(url ?? ''));
  return match ? match[1].toLowerCase() : null;
}

/** 'production' | 'preview' | 'development'. Anything unknown is development. */
export function buildEnvironment() {
  return __VERCEL_ENV__ === 'production' || __VERCEL_ENV__ === 'preview'
    ? __VERCEL_ENV__
    : 'development';
}

/** True when this is a preview build, whatever it is pointed at. */
export function isPreviewBuild() {
  return buildEnvironment() === 'preview';
}

/**
 * A preview build compiled against the production database.
 *
 * Rendered as a blocking screen rather than a banner. A warning somebody can
 * scroll past is a warning somebody scrolls past, and the thing on the other
 * side of it is real athletes' rows.
 */
export function previewPointsAtProduction(url) {
  return isPreviewBuild() && supabaseRef(url) === PRODUCTION_SUPABASE_REF;
}

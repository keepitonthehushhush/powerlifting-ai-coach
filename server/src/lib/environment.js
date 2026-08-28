/**
 * Which environment this is, and the one thing that must never be true of it.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Vercel builds a preview deployment for every branch, and until now every one
 * of them talked to the PRODUCTION database. Testing anything that writes
 * meant testing on real athletes' rows, so in practice nobody tested on a
 * preview at all - which is why three separate faults reached coachdiaz.app in
 * one afternoon. There was nothing between a commit and the live site.
 *
 * A second Supabase project fixes that, and immediately introduces a worse
 * failure than the one it solves: a preview that is CONFIGURED as isolated but
 * is quietly still pointed at production. That looks safe, invites destructive
 * testing, and does the damage silently.
 *
 * So the isolation is asserted rather than assumed, and the assertion is not
 * subtle. A preview pointed at production refuses to serve.
 *
 * ── WHY REFUSING IS THE RIGHT FAILURE ─────────────────────────────────────
 *
 * This project's standing rule is that failing to boot turns a configuration
 * mistake into a total outage, which is usually worse than the mistake. The
 * exception is when the thing that would fail to boot is not production - and
 * a preview deployment is exactly that. A dead preview costs one branch and is
 * fixed in a dashboard; a live preview writing to the real database costs
 * somebody's training history.
 *
 * The check is one-directional on purpose: production is never refused, no
 * matter what it is pointed at. Nothing here can take the site down.
 */

/**
 * The production project's reference.
 *
 * Public by design - it is half of VITE_SUPABASE_URL and is compiled into
 * every browser bundle, so this is not a secret being written into a
 * repository. web/src/lib/environment.js holds the same constant for the
 * browser build, and a test asserts the two agree.
 */
export const PRODUCTION_SUPABASE_REF = 'pwbkdxnvubtflgpqpest';

/** `https://abc.supabase.co` → `abc`. Null for anything not of that shape. */
export function supabaseRef(url) {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)/i.exec(String(url ?? ''));
  return match ? match[1].toLowerCase() : null;
}

/**
 * What kind of deployment this is.
 *
 * VERCEL_ENV is 'production', 'preview' or 'development'. Absent everywhere
 * else - a laptop, CI, a test - and absence means development, which is never
 * refused.
 */
export function deploymentEnvironment(env = process.env) {
  const value = env.VERCEL_ENV;
  return value === 'production' || value === 'preview' ? value : 'development';
}

/**
 * @returns {{isolated: boolean, environment: string, ref: string|null, reason: string|null}}
 */
export function describeIsolation(env = process.env) {
  const environment = deploymentEnvironment(env);
  const ref = supabaseRef(env.SUPABASE_URL);

  if (environment !== 'preview') {
    return { isolated: true, environment, ref, reason: null };
  }
  if (ref === null) {
    // Not a Supabase URL at all. The existing config validation will have more
    // to say about that; it is not this check's business, and claiming it as
    // an isolation failure would send somebody looking in the wrong place.
    return { isolated: true, environment, ref, reason: null };
  }
  if (ref === PRODUCTION_SUPABASE_REF) {
    return {
      isolated: false,
      environment,
      ref,
      reason:
        'This is a PREVIEW deployment and SUPABASE_URL points at the production project. ' +
        'A preview that writes to production is worse than no preview at all: it looks safe ' +
        'and it is not. Set SUPABASE_URL, SUPABASE_SECRET_KEY, VITE_SUPABASE_URL and ' +
        'VITE_SUPABASE_PUBLISHABLE_KEY for the Preview environment in the Vercel dashboard, ' +
        'then redeploy the branch.',
    };
  }
  return { isolated: true, environment, ref, reason: null };
}

/** Throws on a preview pointed at production. Never throws for production. */
export function assertPreviewIsolation(env = process.env) {
  const result = describeIsolation(env);
  if (!result.isolated) throw new Error(result.reason);
  return result;
}

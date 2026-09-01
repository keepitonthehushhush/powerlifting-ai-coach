/**
 * Where the API calls go, and why that is overridable at all.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 *
 * Six defects in this harness in one day were found by RUNNING it, none by
 * reading it: a summary branch the abort could not reach, a stopper reading a
 * field nothing sets, an unreachable-judge path a fix had missed, a scenario
 * counted as failed when it was never graded. Each was written with a
 * source-level test beside it that passed, because a test that greps the
 * source agrees with code that looks right.
 *
 * The ones caught early were caught by pointing the runner at a local server
 * that returns a canned failure. That worked every time and was done by hand,
 * from /tmp, and therefore not at all on the occasions it was most needed.
 *
 * So the URL is configurable, and server/test/evalRunner.test.js runs the
 * whole eval against a stub. What used to be a ritual is now `npm test`.
 *
 * ── WHY LOCALHOST ONLY ────────────────────────────────────────────────────
 *
 * These requests carry the Anthropic key in a header. An env var that can
 * point them anywhere is an env var that can walk the key out to any host,
 * and this codebase treats that key as the one secret that must never leave
 * the server. Tests only ever need a loopback address, so a loopback address
 * is all this accepts - anything else is refused loudly rather than
 * silently ignored, because silently ignoring it would send real traffic
 * somewhere the caller did not expect.
 */

const DEFAULT_BASE = 'https://api.anthropic.com';

/** Loopback only. Anything else is a mistake or an exfiltration attempt. */
function isLoopback(value) {
  try {
    const { hostname, protocol } = new URL(value);
    return (
      (protocol === 'http:' || protocol === 'https:') &&
      (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1')
    );
  } catch {
    return false;
  }
}

export function resolveApiBase(env = process.env) {
  const override = (env.ANTHROPIC_API_BASE ?? '').trim();
  if (!override) return DEFAULT_BASE;
  if (!isLoopback(override)) {
    throw new Error(
      `ANTHROPIC_API_BASE must be a loopback address (got ${override}). ` +
        'These requests carry the API key in a header, so this override exists for ' +
        'tests against a local stub and for nothing else.'
    );
  }
  return override.replace(/\/+$/, '');
}

export const API_BASE = resolveApiBase();
export const MESSAGES_URL = `${API_BASE}/v1/messages`;

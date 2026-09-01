/**
 * Is this tab running an older build than the one now serving?
 *
 * ── THE PROBLEM, STATED PRECISELY ─────────────────────────────────────────
 *
 * Somebody opens the app, leaves the tab, and a deploy lands. Their tab is now
 * running JavaScript from the previous commit against an API from the current
 * one. Nothing crashes. What happens instead is worse: a field the old client
 * does not send, an error code it does not recognize, a response shape it
 * mis-reads - and a person reporting that "it did something weird" with no way
 * for either of us to reproduce it, because a refresh silently fixes it.
 *
 * This app has NO code splitting, so the usual chunk-404 symptom cannot happen
 * here - checked before building a guard for it. The real exposure is contract
 * skew between an old client and a new server, and the only cheap fix for it
 * is to notice and say so.
 *
 * ── WHY IT DOES NOT RELOAD BY ITSELF ──────────────────────────────────────
 *
 * Because somebody may be halfway through logging a session. An automatic
 * reload during a deploy would take a training log off the screen to fix a
 * problem that person did not have yet - trading a possible confusion for a
 * certain loss. It offers; the person decides.
 *
 * Vercel's own Skew Protection solves this at the platform layer by pinning
 * old clients to the deployment they came from. It is Pro-and-above and does
 * not support a plain Vite SPA without doing the header work by hand, so this
 * is the version that works on the plan we are on. The header is sent anyway
 * (see api.js) so the platform feature activates by itself if the plan ever
 * changes.
 */

/** Injected by Vite at build time from VERCEL_DEPLOYMENT_ID. See vite.config.js. */
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/** Local builds have nothing meaningful to compare against. */
export function versionCheckable() {
  return BUILD_ID !== 'dev' && BUILD_ID !== '';
}

/**
 * @returns {Promise<boolean>} true when the server is serving a different build
 */
export async function isStale({ fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!versionCheckable()) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`/api/health?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.json();
    // An absent or 'dev' id means the server cannot tell us, which is not the
    // same as a mismatch. Never prompt on missing information.
    if (!body?.deploymentId || body.deploymentId === 'dev') return false;
    return body.deploymentId !== BUILD_ID;
  } catch {
    // Offline, blocked, or slow. A version prompt is the last thing somebody
    // with a bad connection needs.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

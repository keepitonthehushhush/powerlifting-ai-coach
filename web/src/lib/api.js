import { supabase } from './supabase.js';
import { config } from './config.js';
import { BUILD_ID } from './version.js';

/**
 * Thin fetch wrapper that attaches the current Supabase access token to every
 * API call.
 *
 * getSession() is read from the client's local store rather than the network,
 * and the SDK refreshes the token in the background, so this is cheap. The
 * server re-verifies the token on every request regardless - the client is
 * never the authority on whether a session is valid.
 */
const BASE = config.apiBaseUrl;

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.details = body?.details;
    /** The stable key, for code that branches. See server/src/lib/errorCodes.js. */
    this.code = body?.details?.code ?? null;
    /** The quotable form, CD-00N, for a person. */
    this.errorCode = body?.details?.errorCode ?? null;
  }
}

/**
 * What to put on the screen.
 *
 * ── WHY THE CODE IS NOT ALWAYS SHOWN ──────────────────────────────────────
 *
 * A code beside "that message is too long" is clutter: the sentence is
 * actionable on its own and the athlete has nothing to report. A code beside
 * "the coach is unreachable" is the whole point - it is the difference between
 * a support message that says "it broke" and one that says "CD-004", which can
 * be counted, grouped and looked up.
 *
 * So: 5xx only. Something on our side went wrong and somebody may need to tell
 * us about it. Under 500 the athlete can fix it themselves and the code would
 * only make them feel they had hit a bug.
 */
export function errorText(error) {
  const message = error?.message ?? 'Something went wrong.';
  const code = error?.errorCode;
  if (!code || !(error?.status >= 500)) return message;
  return `${message} (${code})`;
}

/**
 * Nothing in this client may hang forever.
 *
 * ── WHY THIS IS HERE ──────────────────────────────────────────────────────
 *
 * Reported as: the coach page is frozen in a loading state. Every screen in
 * this app follows the same shape - set loading, await a request, clear
 * loading in a `finally`. That is correct right up until the promise never
 * settles, at which point `finally` never runs and the spinner is permanent.
 * There is no error, nothing in a log, and no way out but a reload the person
 * has no reason to believe will help.
 *
 * Two things in the path could hang. `fetch` has no default timeout at all,
 * and `supabase.auth.getSession()` can block behind a token refresh that is
 * itself stuck. Both are now bounded, and both fail into an ERROR - which
 * every caller already knows how to display - rather than into silence.
 *
 * The chat timeout is deliberately long. A coaching reply legitimately takes
 * over a minute: production logs show 77 seconds for a full program. A
 * timeout tuned to a normal API would cut off the product's main feature and
 * be a far worse bug than the one being fixed.
 */
const TIMEOUTS = { default: 20_000, chat: 150_000, session: 8_000 };

/** Reads the token, but never waits forever for one. */
async function accessToken() {
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise((resolve) => setTimeout(() => resolve({ data: { session: null } }), TIMEOUTS.session)),
    ]);
    return result?.data?.session?.access_token ?? null;
  } catch {
    // A token we could not read is the same as no token: the request goes out
    // without one and comes back 401, which is a state the app can show.
    return null;
  }
}

async function request(path, options = {}) {
  const { timeout, ...init } = options;
  const token = await accessToken();

  const controller = new AbortController();
  const limit = timeout ?? (path.startsWith('/chat') ? TIMEOUTS.chat : TIMEOUTS.default);
  const timer = setTimeout(() => controller.abort(), limit);

  let response;
  try {
    response = await fetch(`${BASE}/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        /**
         * Vercel's Skew Protection pins a request to the deployment that
         * served the page, so an old client keeps talking to the server that
         * understands it. It is Pro-and-above and does not support a plain
         * Vite SPA automatically, so this header is the manual half.
         *
         * Sent unconditionally and harmless when the feature is off - Vercel
         * ignores it. The point is that the day the plan changes, this already
         * works rather than being a thing somebody has to remember.
         */
        ...(BUILD_ID && BUILD_ID !== 'dev' ? { 'x-deployment-id': BUILD_ID } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    // AbortError is the timeout; anything else is the network being down or
    // the request being blocked. Both are things a person can act on - wait,
    // check the connection, try again - and neither should be a spinner.
    throw new ApiError(err?.name === 'AbortError' ? 408 : 0, {
      message:
        err?.name === 'AbortError'
          ? 'That took too long and was stopped. Your connection may be slow — try again.'
          : 'Could not reach the server. Check your connection and try again.',
    });
  } finally {
    clearTimeout(timer);
  }

  // 304 is not an error. `response.ok` is false for it, so without this a
  // Not Modified on a conditional request - which is exactly what the consent
  // endpoint was returning - became "Request failed with status 304" and put
  // the consent gate into a state it could not leave. There is no body to
  // parse on a 304, so the caller gets null and refetches rather than being
  // handed a failure.
  if (response.status === 304) return null;

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

export const api = {
  getProfile: () => request('/profile'),
  saveProfile: (profile) => request('/profile', { method: 'PUT', body: JSON.stringify(profile) }),
  getConversation: () => request('/chat/conversation'),
  sendMessage: (message, conversationId) =>
    request('/chat', { method: 'POST', body: JSON.stringify({ message, conversationId }) }),
  /*
   * Interface preferences, deliberately separate from the profile. The theme
   * is wanted on every page; the profile carries health data. See migration
   * 0045 for why those are two tables and two endpoints.
   */
  getPreferences: () => request('/preferences'),
  savePreferences: (preferences) =>
    request('/preferences', { method: 'PUT', body: JSON.stringify(preferences) }),

  getSessions: () => request('/sessions'),
  getProgress: () => request('/sessions/progress'),
  logSession: (session) => request('/sessions', { method: 'POST', body: JSON.stringify(session) }),
  getProgram: () => request('/program'),
  getLibrary: () => request('/library'),

  // Consent (MHMDA). Granting and withdrawing use the same call, because
  // withdrawal must be no harder than granting.
  getConsents: () => request('/consent'),
  recordConsent: (consentType, granted) =>
    request('/consent', { method: 'POST', body: JSON.stringify({ consent_type: consentType, granted }) }),
  getConsentHistory: () => request('/consent/history'),

  /**
   * Billing. Three calls, and the two that matter return a URL rather than
   * doing anything themselves: checkout and the portal are Stripe-hosted, so
   * no card detail ever touches this origin.
   */
  getBillingStatus: () => request('/billing/status'),
  startCheckout: () => request('/billing/checkout', { method: 'POST' }),
  openBillingPortal: () => request('/billing/portal', { method: 'POST' }),

  // The leaderboard and the badge shelf.
  getLeaderboard: () => request('/leaderboard'),
  setLeaderboardOptIn: (optIn) =>
    request('/leaderboard/opt-in', { method: 'PUT', body: JSON.stringify({ optIn }) }),
  getAchievements: () => request('/achievements'),

  // Data subject rights.
  exportData: () => request('/account/export'),
  getActivity: () => request('/account/activity'),
  deleteAccount: (confirm) =>
    request('/account', { method: 'DELETE', body: JSON.stringify({ confirm }) }),
};

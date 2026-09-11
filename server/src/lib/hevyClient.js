import { codedError } from './errorCodes.js';

/**
 * The only place this server talks to an outside tracker.
 *
 * ── WHAT THIS FILE IS ACTUALLY FOR ─────────────────────────────────────────
 *
 * Two things, and the second is the reason it exists at all.
 *
 * 1. Turning their failures into this product's error codes, so that "your key
 *    stopped working" and "their service is down" reach the athlete as
 *    different sentences with different buttons. They arrive as a 401 and a
 *    503 and are equally easy to collapse into "sync failed", which is the
 *    version that sends somebody to generate a new key during an outage.
 *
 * 2. Making sure the credential leaves through exactly one door. The key is a
 *    parameter of one function here and is attached to one header. It is never
 *    put in a URL - query strings reach access logs, proxies, and the
 *    `Referer` on any redirect - never included in a thrown error, and never
 *    returned to the caller. A test asserts the absences, because absences are
 *    what stop being true when somebody adds a debug line.
 */

/** Their documented base. Version in the path, as they publish it. */
export const HEVY_BASE_URL = 'https://api.hevyapp.com/v1';

/**
 * Per-request ceiling.
 *
 * Twelve pages at ten seconds each is two minutes, comfortably inside the
 * function's five-minute limit with room for the writes. A request with no
 * timeout is the one that gets the whole invocation killed, and a killed
 * invocation records nothing - not even how far it got.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Their key is a UUID. Checked here and again in Postgres (migration 0070). */
export const API_KEY_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeApiKey(value) {
  return typeof value === 'string' && API_KEY_SHAPE.test(value.trim());
}

/**
 * Their status, as one of ours.
 *
 * 403 sits with 401 deliberately. Their documentation does not distinguish
 * them and both mean the same thing to the athlete: this key does not open
 * this door any more.
 */
function codeForStatus(status) {
  if (status === 401 || status === 403) return 'tracker_key_rejected';
  if (status === 429) return 'tracker_rate_limited';
  return 'tracker_unavailable';
}

/**
 * One GET against their API.
 *
 * @param {string} path e.g. '/workouts/events'
 * @param {object} options
 * @param {string} options.apiKey the athlete's key - header only, never logged
 * @param {Record<string, string|number>} [options.query]
 * @param {typeof fetch} [options.fetchImpl] injected by the tests
 * @returns {Promise<object>} the parsed body
 */
export async function hevyGet(path, { apiKey, query = {}, fetchImpl = fetch } = {}) {
  if (!looksLikeApiKey(apiKey)) {
    // Before the request, not after a 401: an unusable key should never be put
    // on the wire at all, and "we sent your malformed key to a third party and
    // they said no" is a worse answer than "that is not a key".
    throw codedError('tracker_key_rejected', 'That connection is missing its key.');
  }

  const url = new URL(`${HEVY_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        // Their scheme: a bare header, no Bearer prefix, no OAuth.
        'api-key': apiKey.trim(),
        accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    /*
     * A timeout and a DNS failure arrive here as the same kind of thing and
     * are the same thing to the athlete: their tracker did not answer. The
     * cause is deliberately NOT attached - `err` from fetch can carry the
     * request it failed on, and that request has the key on it.
     */
    throw codedError('tracker_unavailable', 'Your tracker did not answer.', {
      reason: err?.name === 'AbortError' ? 'timeout' : 'unreachable',
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw codedError(codeForStatus(response.status), 'Your tracker refused that request.', {
      // The status, and nothing from the body. Their error bodies are not
      // documented, and echoing an undocumented third-party string into our
      // own error envelope is how somebody else's content ends up on our page.
      upstreamStatus: response.status,
    });
  }

  try {
    return await response.json();
  } catch {
    throw codedError('tracker_unavailable', 'Your tracker sent something unreadable.', {
      reason: 'unparseable',
    });
  }
}

/**
 * Does this key work?
 *
 * `/workouts/count` because it is the cheapest authenticated call they have -
 * one integer, no pagination, no history. Connecting proves the key before
 * storing it, so a paste error is caught while the athlete is still looking at
 * the field rather than an hour later in a sync nobody watched.
 */
export async function verifyKey(apiKey, { fetchImpl = fetch } = {}) {
  const body = await hevyGet('/workouts/count', { apiKey, fetchImpl });
  const count = Number(body?.workout_count);
  return { workoutCount: Number.isFinite(count) ? count : null };
}

/**
 * One page of the event stream.
 *
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.since ISO 8601
 * @param {number} options.page 1-based
 * @param {number} options.pageSize their maximum is 10
 */
export async function fetchEventPage({ apiKey, since, page, pageSize, fetchImpl = fetch }) {
  const body = await hevyGet('/workouts/events', {
    apiKey,
    query: { since, page, pageSize },
    fetchImpl,
  });
  return {
    events: Array.isArray(body?.events) ? body.events : [],
    // Their envelope names it page_count. Read defensively rather than
    // trusted: pageProgress() treats a non-integer as "they did not say".
    pageCount: Number.isInteger(body?.page_count) ? body.page_count : null,
  };
}

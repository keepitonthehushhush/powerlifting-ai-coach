import { logger } from './logger.js';

/**
 * Write one row into public.error_events.
 *
 * ── WHY A TABLE AND NOT THE LOG STREAM ────────────────────────────────────
 *
 * The empty-response bug was investigable only because somebody happened to
 * open Vercel's runtime logs within a few hours of it happening. Those logs
 * expire in days, cannot be grouped by anything meaningful, and answer "what
 * happened just now" rather than "what keeps happening" - and the failure
 * everybody hits and nobody bothers to report is exactly the one a log stream
 * loses.
 *
 * ── WHAT IS DELIBERATELY NOT WRITTEN ──────────────────────────────────────
 *
 * The message. The reply. Any field VALUE. `detail` is filtered to a fixed
 * list of keys HERE and constrained again by a CHECK in the database, because
 * one of the two will eventually be edited by somebody in a hurry.
 *
 * The path is normalised before it is stored: `/api/conversations/<uuid>`
 * becomes `/api/conversations/_id`. An error table is not a place to
 * accumulate identifiers, and a route pattern is what a pattern needs anyway.
 */

/**
 * Keys allowed through, mirroring the CHECK constraint in migration 0034.
 *
 * Two copies of one list is a thing that drifts, so a test parses the
 * migration and asserts they match. The duplication is deliberate: filtering
 * only in the database means a rejected write loses the whole row, and
 * filtering only here means the constraint is decorative.
 */
export const RECORDABLE_DETAIL_KEYS = Object.freeze([
  'stopReason',
  'stopCategory',
  'blockTypes',
  'hadText',
  'upstreamStatus',
  'cause',
  'needs',
  'reason',
  'subject',
  'field',
  'limit',
  'length',
  'attempt',
  'retryable',
]);

/** `/api/conversations/8f3c.../messages` → `/api/conversations/_id/messages`. */
export function normaliseRoute(rawPath) {
  const path = String(rawPath ?? '').split('?')[0];
  const normalised = path
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, '/_id')
    .replace(/\/\d+/g, '/_id');
  // The column's CHECK is narrower than a URL. Anything that would fail it is
  // replaced rather than allowed to reject the row: losing the path is a much
  // smaller loss than losing the record.
  return /^\/[A-Za-z0-9/_-]{0,80}$/.test(normalised) ? normalised : '/unknown';
}

/** Only the keys the table accepts, and only when they carry something. */
export function recordableDetail(details) {
  const out = {};
  for (const key of RECORDABLE_DETAIL_KEYS) {
    const value = details?.[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

/**
 * Never throws, and never becomes the reason a request fails.
 *
 * An error recorder that can itself error would turn one bad request into two,
 * and the second would be invisible because the thing that reports errors is
 * the thing that broke.
 *
 * @param {object} req    the Express request, for its user-scoped client
 * @param {{status:number, details?:object}} error
 */
export async function recordErrorEvent(req, { status, details }) {
  const code = details?.code;

  // No code means an unhandled throw, which the log and Sentry already carry.
  // No client means an unauthenticated request: record_error_event refuses a
  // caller with no JWT on purpose, since a function anon can call is an
  // unauthenticated insert endpoint.
  if (!code || !req?.supabase) return false;

  try {
    const { error } = await req.supabase.rpc('record_error_event', {
      p_code: code,
      p_http_status: status,
      p_route: normaliseRoute(req.originalUrl ?? req.path),
      p_method: req.method,
      p_detail: recordableDetail(details),
    });
    if (error) {
      // Logged, not thrown. A failure to record a failure is worth knowing
      // about and is not worth failing the request over.
      logger.warn('error_event.not_recorded', { code, cause: error.code });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('error_event.not_recorded', { code, cause: err?.name });
    return false;
  }
}

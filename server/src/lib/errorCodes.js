import { HttpError } from './httpError.js';

/**
 * Stable, quotable identifiers for the ways this product fails.
 *
 * ── WHY A CODE AND NOT JUST A SENTENCE ────────────────────────────────────
 *
 * "The coach returned an empty response. Please try again." is a sentence that
 * told the athlete nothing, told the person reading the logs nothing, and
 * appeared in one place in the source. When it happened, the only way to find
 * out anything was to grep the codebase for the sentence - and the response
 * carried the actual reason (`stop_reason: "refusal"`) which nothing recorded.
 *
 * A code fixes three separate things at once:
 *   - the athlete can quote it. "CD-002" survives a screenshot, a retelling
 *     and a translation; a paraphrased sentence does not.
 *   - the logs and the error_events table can be GROUPED by it, which is what
 *     turns "it broke" into "this broke eleven times this week".
 *   - the message can be rewritten, softened or translated without breaking
 *     anything that refers to it.
 *
 * ── THE RULES, WHICH ARE THE WHOLE POINT ──────────────────────────────────
 *
 * 1. AN ID IS PERMANENT. Once a number is assigned it is never reused for a
 *    different meaning and never renumbered, because somebody has it written
 *    down. Retiring a code means leaving a gap.
 * 2. The KEY may be renamed and the MESSAGE may be rewritten. Neither is the
 *    identifier.
 * 3. One code per KIND of failure, not per call site. Sixteen "could not load
 *    your X" sites are one code and sixteen sentences: the code says what went
 *    wrong, the sentence says what it was doing.
 *
 * A test asserts the ids are unique, that none has been reused, and that every
 * code named anywhere in the server exists here.
 */

/**
 * @typedef {object} ErrorCode
 * @property {number}      id         permanent, never reused
 * @property {number|null} status     the HTTP status this failure produces,
 *                                    or null when it annotates a SUCCESSFUL
 *                                    reply rather than replacing it
 * @property {boolean}     retryable  is sending the same request again a
 *                                    reasonable thing for the athlete to do
 */

/** @type {Readonly<Record<string, ErrorCode>>} */
export const ERROR_CODES = Object.freeze({
  // ── The coach ───────────────────────────────────────────────────────────
  /** The model produced no text at all, for no reason it declared. */
  coach_empty: { id: 1, status: 502, retryable: true },
  /**
   * `stop_reason: "refusal"`. Anthropic's safety classifiers return this as a
   * normal HTTP 200 with no usable text, so it arrives looking exactly like an
   * empty reply and is not one. Retrying the same words will refuse again.
   */
  coach_refused: { id: 2, status: 502, retryable: false },
  /**
   * `max_tokens` with NOTHING to show for it.
   *
   * The budget was spent and no text block came back, so there is nothing to
   * deliver and nothing to truncate. It is not `coach_empty`: that one's whole
   * advice is "send it again", and sending the same request again hits the
   * same ceiling in the same place. Recorded in production on 2026-08-29,
   * classified as coach_empty, retried once at full cost, and the athlete was
   * told to try again - which could not have worked.
   *
   * The advice that CAN work is to ask for less, so it has its own message.
   */
  coach_cut_short: { id: 21, status: 502, retryable: false },
  /**
   * Not an error. `max_tokens` or `model_context_window_exceeded`: there IS a
   * reply and it stops mid-sentence. Status null because the athlete gets the
   * text - hiding a truncated program behind an error would be worse than
   * showing it and saying it was cut off.
   */
  coach_truncated: { id: 3, status: null, retryable: false },
  /** The Anthropic API itself failed or was unreachable. */
  coach_unavailable: { id: 4, status: 502, retryable: true },
  /** The reply took longer than the request was allowed to wait. */
  coach_timeout: { id: 5, status: 504, retryable: true },

  // ── Storage ─────────────────────────────────────────────────────────────
  /** A database read or write failed. The sentence says which one. */
  storage_unavailable: { id: 6, status: 502, retryable: true },
  /**
   * The coach answered and the answer could not be stored. Distinct from the
   * above because the athlete lost work rather than merely failing to load
   * something, and because it is the one worth chasing hardest.
   */
  reply_not_saved: { id: 7, status: 502, retryable: true },

  // ── The request ─────────────────────────────────────────────────────────
  invalid_profile: { id: 8, status: 400, retryable: false },
  invalid_request: { id: 9, status: 400, retryable: false },
  message_too_long: { id: 10, status: 400, retryable: false },
  not_found: { id: 11, status: 404, retryable: false },

  // ── Gates ───────────────────────────────────────────────────────────────
  rate_limited: { id: 12, status: 429, retryable: true },
  age_restricted: { id: 13, status: 403, retryable: false },
  payment_required: { id: 14, status: 402, retryable: false },
  billing_unavailable: { id: 15, status: 503, retryable: false },
  auth_required: { id: 16, status: 401, retryable: false },
  /** A 409 rather than a 400: the request was fine, the account already had one. */
  already_subscribed: { id: 17, status: 409, retryable: false },
  /**
   * The request is well formed and the account is not in a state that allows
   * it yet - no display name, no leaderboard consent, no typed confirmation.
   * Distinct from invalid_request because the athlete has to go and DO
   * something, not fix what they sent.
   */
  precondition_missing: { id: 18, status: 400, retryable: false },
  /**
   * The database refused a health-data write because no active collection
   * consent exists. Postgres is the enforcement point; this is its refusal
   * turned into something a client can act on.
   */
  consent_required: { id: 19, status: 403, retryable: false },
  /**
   * The worst one in the list, and the reason it has a code of its own: a
   * consent withdrawal was recorded and the health data it governed was NOT
   * removed. Somebody exercised a right and the system half-honoured it. If
   * this ever appears in error_events it is the first thing to look at.
   */
  withdrawal_incomplete: { id: 20, status: 502, retryable: false },
});

/**
 * Ids that once meant something else and must never be handed out again.
 *
 * Empty today. It exists so that retiring a code is a two-line change with an
 * obvious place to write the number down, rather than a decision somebody
 * makes silently by deleting a line.
 */
export const RETIRED_IDS = Object.freeze([]);

/** The form a person quotes: CD-002. */
export function displayCode(key) {
  const entry = ERROR_CODES[key];
  if (!entry) throw new Error(`unknown error code: ${key}`);
  return `CD-${String(entry.id).padStart(3, '0')}`;
}

/** Every key, for tests and for the documentation that lists them. */
export const ERROR_CODE_KEYS = Object.freeze(Object.keys(ERROR_CODES));

/**
 * Build an HttpError carrying a code.
 *
 * The status comes from the registry rather than the call site, so a code
 * cannot mean 502 in one route and 400 in another - which is exactly how a
 * client ends up special-casing a status that means two different things.
 *
 * `details.code` is the key, because that is what the logs and the
 * error_events table group by. `details.errorCode` is CD-00N, because that is
 * what the athlete reads. Both, because they are for different readers.
 *
 * @param {keyof typeof ERROR_CODES} key
 * @param {string} message   what was being attempted, in a sentence
 * @param {object} [details] merged into the envelope; cannot override `code`
 */
export function codedError(key, message, details = {}) {
  const entry = ERROR_CODES[key];
  if (!entry) throw new Error(`unknown error code: ${key}`);
  if (entry.status === null) {
    throw new Error(`${key} annotates a successful reply and is not an error`);
  }
  return new HttpError(entry.status, message, {
    ...details,
    code: key,
    errorCode: displayCode(key),
    retryable: entry.retryable,
  });
}

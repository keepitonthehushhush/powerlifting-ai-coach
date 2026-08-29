import { codedError } from './errorCodes.js';

/**
 * What happened when we asked the coach, and what to do about it.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * "I replied to the AI coach and it... struggled to reply afterwards when I
 * replied an answer to a question it had and error'd: The coach returned an
 * empty response. Please try again."
 *
 * The route did this:
 *
 *     if (!reply.text) throw new HttpError(502, 'The coach returned an empty
 *                                                response. Please try again.');
 *
 * One branch for four different situations, a sentence describing the symptom,
 * and nothing recorded. Anthropic documents FOUR stop reasons where a response
 * may carry no usable text, and they want opposite responses from us:
 *
 *   refusal  A safety classifier declined. This arrives as a normal HTTP 200,
 *            not an error, so it is indistinguishable from a blank unless the
 *            stop reason is read. Retrying the same words refuses again -
 *            "please try again" is advice that cannot work.
 *   max_tokens / model_context_window_exceeded
 *            There IS a reply. It stops mid-sentence. Throwing away a program
 *            because its last line is cut off is worse than showing it and
 *            saying so.
 *   end_turn with nothing in it
 *            A genuine blank, and the only one where trying again is sensible.
 *
 * So this returns a decision rather than a boolean, and the route acts on it.
 * It takes a plain object, so it can be tested without a network.
 */

/** Stop reasons that mean the text is real but unfinished. */
const TRUNCATING = new Set(['max_tokens', 'model_context_window_exceeded']);

/**
 * @param {{text?: string, stopReason?: string, stopDetails?: object|null, blockTypes?: string[]}} reply
 * @returns {{ok: boolean, code: string|null, retry: boolean, truncated: boolean, message?: string, log: object}}
 */
export function describeCoachReply(reply) {
  const text = reply?.text ?? '';
  const stopReason = reply?.stopReason ?? null;

  /**
   * Everything worth having in a log line or an error_events row, and nothing
   * that is the athlete's. Not the text, not a length that hints at it, not
   * the stop_details reason string if it were ever to quote content - only its
   * category, which is a fixed vocabulary.
   */
  const log = {
    stopReason,
    blockTypes: reply?.blockTypes ?? [],
    hadText: text.length > 0,
    stopCategory: reply?.stopDetails?.type ?? reply?.stopDetails?.reason ?? null,
  };

  if (stopReason === 'refusal') {
    return {
      ok: false,
      code: 'coach_refused',
      retry: false,
      truncated: false,
      message:
        'The coach declined to answer that one. It is usually a wording thing rather than the subject - try asking it a different way.',
      log,
    };
  }

  /*
   * ORDER MATTERS HERE, AND IT WAS WRONG.
   *
   * The empty check used to come first, so `max_tokens` with no text fell into
   * `coach_empty` - whose entire advice is "sending it again usually works".
   * It cannot work. The request that exhausted the budget will exhaust it
   * again, in the same place, and `coach_empty` is marked retryable so the
   * route spent a second call discovering that.
   *
   * That happened in production on 2026-08-29: one event, stop_reason
   * max_tokens, no text. The same mistake this file was written to stop
   * happening to `refusal` - advice that cannot work, given confidently.
   */
  if (TRUNCATING.has(stopReason)) {
    if (!text) {
      return {
        ok: false,
        code: 'coach_cut_short',
        retry: false,
        truncated: false,
        message:
          'That reply ran out of room before the coach had written anything. Ask for a smaller piece of it - one training day rather than a whole block - and it will fit.',
        log,
      };
    }
    // Deliverable. The athlete gets the words and is told they stop early,
    // which is the honest version of a reply that ends mid-set.
    return { ok: true, code: 'coach_truncated', retry: false, truncated: true, log };
  }

  if (!text) {
    // end_turn, or anything unrecognised, with nothing in it. The one case
    // where sending the same request again is reasonable advice.
    return {
      ok: false,
      code: 'coach_empty',
      retry: true,
      truncated: false,
      message: 'The coach did not finish that reply. Sending it again usually works.',
      log,
    };
  }

  return { ok: true, code: null, retry: false, truncated: false, log };
}

/**
 * The error to throw for an outcome that is not ok. Never called when it is.
 *
 * ── WHY THE WHOLE LOG, AND NOT ONE FIELD OF IT ────────────────────────────
 *
 * This used to pass `{ stopReason }` alone. describeCoachReply had already
 * assembled four facts - stop reason, stop category, the block types that came
 * back, and whether there was any text - and three of them were dropped one
 * line before the only place they were going to be read.
 *
 * The cost was exact and immediate. The first failure this system ever
 * recorded, on 2026-08-29, stored `{"stopReason":"max_tokens"}` and nothing
 * else. `blockTypes` is precisely what separates "the model said nothing" from
 * "the model produced only blocks we do not read", and it was the missing
 * field. RECORDABLE_DETAIL_KEYS had allowed all four the whole time.
 *
 * A record that exists but does not carry the diagnosis is this project's
 * recurring defect in a new place: the check ran, and it asked for the wrong
 * thing. The whitelist in errorRecord.js is what decides what is safe to
 * store; this passes everything and lets that decide.
 */
export function coachError(outcome) {
  return codedError(outcome.code, outcome.message, outcome.log);
}

/**
 * The line appended to a reply that stopped early.
 *
 * Deliberately in the athlete's reply rather than in a banner: they are about
 * to go and lift what it says, and a program that ends mid-week needs the
 * warning attached to the program, not to the page.
 */
export const TRUNCATION_NOTICE =
  '\n\n---\n\nThis reply hit its length limit and stops early — ask me to carry on from where it cut off, and I will finish it.';

/**
 * The Anthropic call failing, as opposed to succeeding unusably.
 *
 * There was no handling for this at all: an SDK throw went to the generic
 * handler and became a 500 with a stack in the log, so "Anthropic is having an
 * afternoon" and "we have a bug" produced the same thing on the athlete's
 * screen and in the logs. They are different problems with different answers -
 * one is worth waiting out, the other is worth a commit.
 *
 * Timeouts get their own code because they are the one an athlete can act on:
 * a full programme legitimately takes over a minute, and being told it timed
 * out is more useful than being told something went wrong.
 */
export function coachApiError(err) {
  const status = err?.status ?? err?.response?.status ?? null;
  const name = err?.name ?? '';
  const timedOut =
    /timeout/i.test(name) || /timeout/i.test(err?.message ?? '') || err?.code === 'ETIMEDOUT';

  if (timedOut) {
    return codedError(
      'coach_timeout',
      'The coach took too long to answer. A full program can take a minute or two - try again, or ask for a smaller piece of it.',
      { upstreamStatus: status }
    );
  }

  return codedError(
    'coach_unavailable',
    'The coach is unreachable at the moment. This is usually brief - try again shortly.',
    { upstreamStatus: status }
  );
}

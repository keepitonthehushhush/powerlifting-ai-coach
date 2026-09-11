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
   * `coach_empty` is marked retryable, so the route spent a second call
   * discovering that an identical request exhausts an identical budget.
   *
   * That happened in production on 2026-08-29, and again on 2026-09-11.
   *
   * ── AND THE SECOND TIME, THE REASONING HAD GONE STALE ──────────────────
   *
   * This comment used to end "the request that exhausted the budget will
   * exhaust it again, in the same place", and that was true when the only
   * variable was the request. It stopped being true when the model changed
   * underneath it. The 2026-09-11 event came back with blockTypes
   * ["thinking"] and no text: the budget had not gone into a long answer, it
   * had gone into ADAPTIVE THINKING, which Sonnet 5 runs by default and which
   * draws on the same max_tokens the reply needs.
   *
   * A retry with thinking DISABLED is therefore not the same request. It is
   * the one request that can succeed where this one failed, because every
   * token goes to text. So this is retryable after all - but only in that
   * specific way, which is why it is a separate flag rather than `retry`.
   * Retrying it unchanged would still be pointless.
   */
  if (TRUNCATING.has(stopReason)) {
    if (!text) {
      return {
        ok: false,
        code: 'coach_cut_short',
        retry: false,
        /**
         * Ask again with `thinking: {type:'disabled'}`, once.
         *
         * Distinct from `retry` because they mean opposite things about the
         * same request: `retry` says "the identical call may work", and this
         * says "the identical call cannot, and here is the one change that
         * makes it a different one".
         */
        retryWithoutThinking: true,
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
    // end_turn, or anything unrecognized, with nothing in it. The one case
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
 * WHY THE UPSTREAM FAILURE IS FILED UNDER A REASON WE OWN.
 *
 * ── THE DAY THIS WAS WRITTEN ───────────────────────────────────────────────
 *
 * A 400 from the model API happened twice, five seconds apart, on 2026-09-10.
 * The instrumentation added a day earlier logs `upstreamType` and a truncated
 * `upstreamMessage` - which would have said exactly why - and it logs them to
 * the platform's runtime log stream, which on this plan refused to return
 * anything from five hours earlier: "ExceedsBillingLimitError".
 *
 * So the second attempt at answering the question failed the same way as the
 * first, for a different reason. errorRecord.js already says why a table beats
 * a log stream, in words written about an earlier version of this exact
 * problem: those logs "expire in days ... and the failure everybody hits and
 * nobody bothers to report is exactly the one a log stream loses."
 *
 * ── AND WHY NOT SIMPLY STORE THE MESSAGE ───────────────────────────────────
 *
 * Because it is vendor prose and this product's messages are health
 * information. A vendor that ever quoted the offending content back would put
 * it in a table the README promises holds none - and error_events is
 * deliberately built so that cannot happen: a key allowlist in code, mirrored
 * by a CHECK in the database, because one of the two will eventually be edited
 * by somebody in a hurry.
 *
 * A CLASSIFICATION is not prose. It is a label chosen from a closed set that
 * we wrote, it cannot carry a sentence somebody typed, and it answers the
 * operational question - was the prompt too long, was a message empty, is the
 * vendor down - without storing a word the vendor said.
 *
 * ── NOR THE VENDOR'S OWN TYPE ──────────────────────────────────────────────
 *
 * `invalid_request_error` is a vendor enum. It is short and safe, and it is
 * still somebody else's vocabulary in our database, changeable without notice
 * and unconstrained by our CHECK. One field, ours, closed.
 */
export const UPSTREAM_REASONS = Object.freeze({
  /** The assembled prompt exceeded the model's context window. */
  prompt_too_long: 'prompt_too_long',
  /** max_tokens asked for more than the model will produce. */
  max_tokens_too_large: 'max_tokens_too_large',
  /** A message reached the API with nothing in it. */
  empty_content: 'empty_content',
  /** 429. Ours to slow down. */
  rate_limited: 'rate_limited',
  /** 529. Theirs to fix, and worth waiting out. */
  overloaded: 'overloaded',
  /** 500 and anything else in that family. */
  server_error: 'server_error',
  /** 504, or the SDK giving up on its own timer. */
  timeout: 'timeout',
  /** 401 or 403. A key problem, and the loudest thing on this list. */
  credentials: 'credentials',
  /** 413. The request itself was too many bytes, prompt length aside. */
  request_too_large: 'request_too_large',
  /** 402. Billing. */
  billing: 'billing',
  /** A 400 we could not place. The interesting bucket, and it is meant to be. */
  invalid_request_other: 'invalid_request_other',
  /** Anything else at all. */
  unclassified: 'unclassified',
});

/**
 * Map an SDK throw onto one of the reasons above.
 *
 * ── STATUS FIRST, MESSAGE ONLY WHERE IT HAS TO BE ──────────────────────────
 *
 * Most of the list falls straight out of the HTTP status, which is documented
 * and stable. Only the three 400 sub-cases need the message, because a 400 is
 * the one status whose reason lives nowhere else.
 *
 * Those three patterns are deliberately LOOSE, for the reason authErrors.js
 * gives about the same trade: the code is stable and the message is not, so a
 * pattern anchored to an exact sentence is a pattern that silently stops
 * matching the first time somebody rewords it. Loose patterns misfile
 * occasionally; exact ones fail completely and quietly.
 */
export function classifyUpstreamFailure(err) {
  const status = err?.status ?? err?.response?.status ?? null;
  const message = String(err?.error?.error?.message ?? err?.error?.message ?? err?.message ?? '');

  if (/timeout/i.test(err?.name ?? '') || err?.code === 'ETIMEDOUT' || status === 504) {
    return UPSTREAM_REASONS.timeout;
  }
  if (status === 429) return UPSTREAM_REASONS.rate_limited;
  if (status === 529) return UPSTREAM_REASONS.overloaded;
  if (status === 401 || status === 403) return UPSTREAM_REASONS.credentials;
  if (status === 402) return UPSTREAM_REASONS.billing;
  if (status === 413) return UPSTREAM_REASONS.request_too_large;
  if (typeof status === 'number' && status >= 500) return UPSTREAM_REASONS.server_error;

  if (status === 400) {
    if (/too long|exceed|context window/i.test(message)) return UPSTREAM_REASONS.prompt_too_long;
    if (/max_tokens/i.test(message)) return UPSTREAM_REASONS.max_tokens_too_large;
    if (/non-?empty|empty content|must not be empty/i.test(message)) return UPSTREAM_REASONS.empty_content;
    return UPSTREAM_REASONS.invalid_request_other;
  }

  return UPSTREAM_REASONS.unclassified;
}

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
 * a full program legitimately takes over a minute, and being told it timed
 * out is more useful than being told something went wrong.
 */
export function coachApiError(err) {
  const status = err?.status ?? err?.response?.status ?? null;
  const name = err?.name ?? '';
  const timedOut =
    /timeout/i.test(name) || /timeout/i.test(err?.message ?? '') || err?.code === 'ETIMEDOUT';

  // A label from the closed set above, never the vendor's sentence. It rides
  // into error_events, where it survives the log stream's retention and this
  // platform's billing limit on reading it.
  const upstreamReason = classifyUpstreamFailure(err);

  if (timedOut) {
    return codedError(
      'coach_timeout',
      'The coach took too long to answer. A full program can take a minute or two - try again, or ask for a smaller piece of it.',
      { upstreamStatus: status, upstreamReason }
    );
  }

  return codedError(
    'coach_unavailable',
    'The coach is unreachable at the moment. This is usually brief - try again shortly.',
    { upstreamStatus: status, upstreamReason }
  );
}

/**
 * A second cache breakpoint, on the conversation itself.
 *
 * ── WHAT THIS IS FOR, IN DOLLARS ──────────────────────────────────────────
 *
 * The system prompt has been cached for a while. The CONVERSATION never was,
 * and it is not small: the longest live conversation replays a 30-message
 * window of about 9,800 tokens on every single turn, at full input price,
 * forever. Measured against claude-sonnet-5 that is roughly $0.020 a reply -
 * about half of what a warm reply costs - spent re-sending words the model
 * was already shown a minute earlier.
 *
 * Anthropic allows more than one breakpoint, and the cache matches on the
 * longest prefix. So the breakpoint goes on the LAST MESSAGE OF THE REPLAYED
 * HISTORY - never on the new one - and the effect is incremental: this turn
 * reads everything up to the previous turn and pays full price only for what
 * is genuinely new.
 *
 * ── WHY NOT ON THE NEWEST MESSAGE ─────────────────────────────────────────
 *
 * Because it changes every turn. A breakpoint there would write a new entry
 * each time and read nothing, which is the expensive half of caching with
 * none of the benefit - the same mistake as putting the system breakpoint on
 * the varying block, which this project has already made once and measured.
 */

/**
 * Roughly the smallest prefix Anthropic will cache.
 *
 * Below the minimum the breakpoint is ignored rather than refused, so this is
 * not a correctness guard - it is there to avoid asking for something we know
 * will not happen, and to keep the first few turns of a conversation from
 * carrying a marker that does nothing. Characters rather than tokens because
 * tokenizing to decide whether to cache would cost more than it saves; the
 * ratio measured on this prompt is about 2.9 characters per token, and this
 * threshold is deliberately well above the 1,024-token floor so an
 * unusually dense conversation cannot slip under it.
 */
const MIN_CACHEABLE_CHARS = 4000;

/** The TTL asked for. Read by the tests and by the cost line, so it is exported. */
export const CONVERSATION_CACHE_TTL = '1h';

/**
 * Mark the history so the model can read it back instead of re-reading it.
 *
 * Pure, and it never mutates the input: the caller's array is the thing that
 * gets logged and stored, and a cache marker is a fact about one request.
 *
 * @param {Array<{role: string, content: string}>} messages - the full list,
 *   history first and the newest message last.
 * @returns {Array} the same messages, with at most one breakpoint added.
 */
export function withHistoryCacheBreakpoint(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return messages ?? [];

  // Everything except the newest message. That is what will still be identical
  // on the next turn, and therefore the only part worth caching.
  const boundary = messages.length - 2;
  const prefixChars = messages
    .slice(0, boundary + 1)
    .reduce((total, message) => total + (typeof message?.content === 'string' ? message.content.length : 0), 0);

  if (prefixChars < MIN_CACHEABLE_CHARS) return messages;

  const target = messages[boundary];
  // Only a plain string is converted. A message that already carries blocks
  // was built by something else, and quietly rewriting its shape here is how
  // a caller's structure gets lost.
  if (typeof target?.content !== 'string') return messages;

  return messages.map((message, index) =>
    index === boundary
      ? {
          ...message,
          content: [
            {
              type: 'text',
              text: message.content,
              cache_control: { type: 'ephemeral', ttl: CONVERSATION_CACHE_TTL },
            },
          ],
        }
      : message
  );
}

/**
 * The slice of history to replay, chosen so that the cache can actually hit.
 *
 * ── THE DEFECT THIS EXISTS TO FIX ─────────────────────────────────────────
 *
 * The breakpoint above is placed correctly and, as originally shipped, could
 * never have been read back even once. The route replayed
 * `history.slice(-30)`, and the stored conversation is not truncated - it
 * grows for as long as the athlete keeps talking. So past thirty messages the
 * window slid forward by two on EVERY turn:
 *
 *   turn N     sends m1 … m30, caches the prefix m1 … m30
 *   turn N+1   sends m3 … m30, u, a
 *
 * Anthropic matches a cache entry against the literal prefix of the request,
 * from the first block. `m1 … m30` is not a prefix of anything that starts at
 * `m3`. The entry written on turn N is unreachable on turn N+1, which writes
 * its own unreachable entry, and so on forever.
 *
 * That is worse than not caching at all. A 20,000-token history costs $0.040
 * to send at full input price and $0.080 to write at the 1-hour rate, so the
 * feature added to halve the cost of a long conversation would have doubled
 * it. It never ran in production - the commit landed a day after the last
 * chat traffic - so this was caught by reading the numbers rather than by
 * paying them, and the check that found it was "does the cached prefix on one
 * turn still start the request on the next", which no unit test was asking.
 *
 * ── WHY A STEPPED WINDOW ──────────────────────────────────────────────────
 *
 * The prefix has to stay byte-identical across consecutive turns, so the
 * START of the window must not move every turn. It moves in steps instead:
 * the window grows from `floor` up to `window` messages, then drops back to
 * `floor` in one move and grows again.
 *
 * With the defaults that is one miss in every five turns and four hits, and
 * the replayed history stays between 22 and 30 messages - never more than the
 * window the route already promised, and never so few that the coach loses
 * the thread. Trading a slightly shorter average history for a cache that
 * works is worth it by a wide margin; trading it for one that cannot work is
 * not a trade at all.
 *
 * Dropping in one move rather than two is also why the drop is cheap: the
 * turn that re-anchors pays full input price once, and the four turns after
 * it read almost everything back at a tenth of it.
 *
 * @param {Array} history every message stored for this conversation, oldest first.
 * @param {{window?: number, step?: number}} [options]
 *        `window` is the most messages that may be replayed. `step` is how far
 *        the anchor jumps when it moves, and therefore how many turns share an
 *        anchor.
 * @returns {Array} the messages to replay, oldest first.
 */
export function replayWindow(history, { window = 30, step = 10 } = {}) {
  if (!Array.isArray(history)) return [];
  if (history.length <= window) return history;

  /*
   * The anchor is a multiple of `step`, so it is unchanged for `step / 2`
   * turns (a turn appends two messages). Ceil, not floor: floor would leave
   * the window one step too wide and send more than `window` messages, which
   * is the promise this function is not allowed to break.
   */
  const anchor = Math.ceil((history.length - window) / step) * step;
  return history.slice(anchor);
}

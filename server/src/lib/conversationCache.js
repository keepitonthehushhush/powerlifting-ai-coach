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

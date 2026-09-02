/**
 * Recover a coaching exchange whose reply the browser never received.
 *
 * ── THE BUG THIS FIXES, AND WHY IT LOOKED LIKE A NETWORK FAULT ────────────
 *
 * Send a message, leave the app while the coach is thinking, come back:
 * "Could not reach the server. Check your connection and try again." The
 * connection was fine. Mobile browsers freeze or discard an in-flight fetch
 * when a page goes to the background, so the request dies on the CLIENT while
 * the server carries on.
 *
 * And the server finishes. routes/chat.js writes the user message and the
 * assistant reply into `conversations` in one update BEFORE it responds, so
 * by the time the browser gives up, the exchange is already saved. The old
 * behavior then rolled back the message on screen and restored the draft -
 * telling the athlete their message never arrived, while the coach's answer
 * sat in the database waiting for a page reload nobody had a reason to do.
 *
 * So this is not a retry. Retrying would send the message a second time and
 * produce two exchanges. This ASKS WHETHER IT ALREADY HAPPENED.
 *
 * ── WHY IT POLLS ──────────────────────────────────────────────────────────
 *
 * Coming back after eight seconds is different from coming back after ninety.
 * If the coach is still generating, the conversation has not been updated yet
 * and a single check would find nothing and declare the message lost - which
 * is the same wrong answer with extra steps. A few spaced checks cover the
 * case where the athlete returns mid-generation.
 *
 * It gives up rather than waiting forever: an athlete staring at a spinner
 * that never resolves is worse off than one told plainly that something went
 * wrong and their text is still in the box.
 */

/** The transport-shaped failures. Anything else is a real answer from the server. */
export function isTransportFailure(error) {
  // 0 is "the fetch threw" - offline, blocked, or the tab was frozen.
  // 408 is this client's own timeout, which a long generation can hit.
  return error?.status === 0 || error?.status === 408;
}

/**
 * Did the exchange land while we were not listening?
 *
 * @param {object}   options
 * @param {Function} options.fetchConversation  () => Promise<{conversation}>
 * @param {number}   options.baselineCount      messages before the send
 * @param {string}   options.sentText           what the athlete typed
 * @param {number}   [options.attempts]
 * @param {Function} [options.wait]             injected for tests
 * @returns {Promise<{recovered: true, conversationId, messages} | {recovered: false}>}
 */
export async function recoverExchange({
  fetchConversation,
  baselineCount,
  sentText,
  attempts = 3,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // Spaced, and not on the first pass: the common case is that the reply is
    // already saved, and making somebody wait two seconds to be told so is a
    // worse experience than the bug in a hurry.
    if (attempt > 0) await wait(2000 * attempt);

    let conversation;
    try {
      ({ conversation } = (await fetchConversation()) ?? {});
    } catch {
      // The recovery fetch failing is evidence the connection really is down.
      // Stop: the original error was right after all.
      return { recovered: false };
    }

    const messages = conversation?.messages ?? [];
    if (!landed(messages, baselineCount, sentText)) continue;

    return { recovered: true, conversationId: conversation.id, messages };
  }

  return { recovered: false };
}

/**
 * The exchange landed if the stored conversation has grown AND ends with a
 * reply to the message we sent.
 *
 * Both halves are load-bearing. Length alone would be satisfied by the user
 * message being saved without a reply, which is not a state this server
 * produces but is exactly the kind of assumption that stops being true. The
 * text match is what makes this specific to OUR send rather than to any
 * activity on the account - the same conversation open in another tab, for
 * instance.
 */
function landed(messages, baselineCount, sentText) {
  if (messages.length <= baselineCount) return false;

  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant') return false;

  return messages.some((m) => m?.role === 'user' && m?.content === sentText);
}

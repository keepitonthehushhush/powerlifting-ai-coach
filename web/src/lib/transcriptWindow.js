/**
 * How much of a conversation is on screen at once.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * On 2026-08-31 the coach page began crashing Safari on an iPhone -
 * "a problem repeatedly occurred", the browser's message for a web content
 * process that has died more than once. Nothing was logged, because a renderer
 * that dies cannot report that it died.
 *
 * What changed that day was not the transcript. It was the renderer. Until
 * then a reply was one `<div>` of preformatted text; the deploy that shipped
 * coachMarkdown.js turned each reply into a parsed block tree - headings,
 * lists, tables, inline spans - and mounted every one of them.
 *
 * The measurement, taken against the real conversation in production
 * (126 messages, 174KB of JSON):
 *
 *     before   ~126 DOM nodes for the whole transcript
 *     after    ~19,000 React elements, ~29,000 DOM nodes
 *
 * A 200-fold increase, all mounted at once, in a container the page then
 * smooth-scrolls to the bottom of. Parsing is not the cost - the whole
 * transcript parses in under four milliseconds. The cost is the tree.
 *
 * ── WHY A WINDOW RATHER THAN A FASTER RENDERER ────────────────────────────
 *
 * Memoising the parse was the first idea and it fixes nothing: the parse was
 * never the expensive part, and the elements still mount. Virtualising the
 * list is the general answer and is a large amount of machinery for a screen
 * where nobody scrolls back through four months of training talk.
 *
 * So: keep the recent messages, and let somebody ask for the rest. The
 * conversation is not truncated, the model still receives the full history,
 * and the athlete can open the whole thing deliberately - on a device where
 * that is their choice rather than a surprise.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * It is not proof of the crash's cause. A renderer death leaves no stack, and
 * the only honest statement is that the page mounts a tree two orders of
 * magnitude larger than the one it replaced, on the smallest device we
 * support. That is worth fixing whether or not it is the whole story.
 */

/**
 * Recent messages kept mounted.
 *
 * Twenty is ten exchanges - comfortably more than anybody scrolls back
 * through in a coaching conversation, and about 3,000 DOM nodes at the
 * measured density rather than 29,000.
 */
export const RECENT_MESSAGE_LIMIT = 20;

/**
 * Split a transcript into what is shown and what is held back.
 *
 * Pure, and separate from the component, so the boundary conditions can be
 * exercised without a DOM - the off-by-one that shows "Show 0 earlier
 * messages" is exactly the kind of bug that reaches production inside JSX.
 *
 * @param {Array} messages - the whole conversation, oldest first.
 * @param {{expanded?: boolean, limit?: number}} [options]
 * @returns {{visible: Array, hidden: number}}
 */
export function windowTranscript(messages, options = {}) {
  const { expanded = false, limit = RECENT_MESSAGE_LIMIT } = options;
  const all = Array.isArray(messages) ? messages : [];

  // A limit that is not a positive number would silently show nothing, which
  // looks exactly like a failed load. Fall back rather than render an empty
  // conversation somebody cannot tell from a broken one.
  const keep = Number.isInteger(limit) && limit > 0 ? limit : RECENT_MESSAGE_LIMIT;

  if (expanded || all.length <= keep) return { visible: all, hidden: 0 };
  return { visible: all.slice(-keep), hidden: all.length - keep };
}

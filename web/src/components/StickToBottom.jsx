import { useEffect, useRef } from 'react';

import { createStickToBottom } from '../lib/stickToBottom.js';

/**
 * Renders nothing; keeps the coach page pinned to its newest message when the
 * phone is rotated. The reasoning, the measurements and the WebKit bug that
 * shapes it are all in lib/stickToBottom.js - this is only the mount point.
 *
 * It is mounted on the coach page and nowhere else. "Put the reader back at the
 * end" is right for a conversation and wrong for a policy document, and a
 * behavior that follows the reader onto every page is how ScrollToTop would
 * have broken the back button.
 *
 * @param {unknown} contentKey - changes when the page's height changes without
 *   any browser event to announce it, which in practice means the transcript
 *   being expanded. See refresh() for why that case needs telling.
 */
export function StickToBottom({ contentKey }) {
  const stick = useRef(null);

  useEffect(() => {
    stick.current = createStickToBottom();
    const stop = stick.current.start();
    return () => {
      stop();
      stick.current = null;
    };
  }, []);

  useEffect(() => {
    // On the next frame, not now: re-measuring before the browser has laid the
    // expansion out would record the height it replaced. Harmless on mount,
    // where it simply repeats the measurement start() already took.
    const id = requestAnimationFrame(() => stick.current?.refresh());
    return () => cancelAnimationFrame(id);
  }, [contentKey]);

  return null;
}

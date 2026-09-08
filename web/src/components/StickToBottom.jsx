import { useEffect } from 'react';

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
 */
export function StickToBottom() {
  useEffect(() => createStickToBottom().start(), []);
  return null;
}

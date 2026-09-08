/**
 * Keep the newest message on screen when the device is rotated.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * "When on mobile phone for the app and looking at the bottom of the page in
 * portrait mode, then going to landscape and then back to portrait, brings you
 * up a couple of messages."
 *
 * The coach page has no scrolling container of its own - `.chat-page` grows and
 * the DOCUMENT scrolls - so the browser's only memory of where the reader was
 * is a pixel offset from the top. Rotating changes how the transcript wraps,
 * and therefore how tall it is, while that offset is left alone:
 *
 *   portrait, at the bottom   scrollY 4200,  document 4900,  viewport 700
 *   -> landscape              the document is now 3100 tall, so the browser
 *                             CLAMPS scrollY to 2750. Still the bottom.
 *   -> portrait again         the document is 4900 again, but scrollY is still
 *                             2750. That is 1450px short of where it was -
 *                             "a couple of messages" up.
 *
 * Nothing is broken in either orientation on its own. The loss happens in the
 * clamp, which is silent, and it is only visible after the second rotation.
 *
 * ── WHY THE POSITION IS NOT SAVED AND RESTORED ────────────────────────────
 *
 * The obvious fix is to remember scrollY before the rotation and put it back
 * after. It cannot work: 4200 does not mean anything in landscape, and the
 * offset that shows the same message is a different number in each
 * orientation. Restoring a pixel offset across a reflow restores a pixel
 * offset, not a reading position.
 *
 * What is actually stable across the reflow is a RELATIONSHIP - "the reader
 * was at the end" - so that is what gets recorded, and the end is where they
 * are put back. This deliberately fixes only the bottom case. Somebody parked
 * halfway up their history would need an anchor element and a measured offset
 * within it, which is real machinery for a case nobody has reported.
 *
 * ── WHY NOTHING IS MEASURED DURING THE ROTATION ───────────────────────────
 *
 * WebKit bug 170595, open since 2017 and confirmed still live in 2025:
 * `window.innerWidth` and `innerHeight` return STALE values inside the resize
 * handler on iOS - a rotated iPhone SE reports 320x320. So the one moment we
 * most want to know whether the reader was at the bottom is the one moment we
 * cannot ask. It is recorded continuously while they scroll instead, when the
 * numbers are trustworthy, and scroll events that arrive DURING a rotation are
 * ignored for the same reason: they are the browser's clamp, not the reader,
 * and they carry the bad measurements.
 *
 * That is also why the scroll back down is repeated for a settling window
 * rather than done once. One call lands on whatever height the browser
 * believed at that instant; repeating it every frame for half a second lets
 * the last one land on the truth. Any real input - a touch, a wheel, a key -
 * ends the window immediately, because a page that keeps pulling itself down
 * while somebody is trying to scroll up is a worse bug than the one being
 * fixed.
 */

/**
 * How close to the end still counts as being at the end.
 *
 * Not zero: a reader at the bottom of a long transcript is frequently a few
 * pixels off it, from momentum scrolling, from the URL bar sliding, or from a
 * rounding difference between scrollHeight and the sum of its parts. Requiring
 * an exact hit would mean the fix simply did not apply most of the time, which
 * is the failure mode that leaves a bug report open after a green test run.
 * 64px is under half a bubble - too small to catch somebody who has genuinely
 * scrolled up to read.
 */
export const BOTTOM_TOLERANCE_PX = 64;

/**
 * How long to keep re-pinning after a rotation.
 *
 * WebKit's own bug thread reports dimensions taking 500-700ms to stabilize in
 * webviews. This is not a delay the reader waits through - the first pin
 * happens on the next frame - it is how long we keep correcting.
 */
export const SETTLE_MS = 500;

/**
 * Was the reader at the end of the page?
 *
 * Returns false for any measurement that is not a finite number. A missing
 * metric must not be read as "at the bottom": that would scroll a reader who
 * was somewhere else, which is the complaint this file exists to remove.
 */
export function isAtBottom(metrics, tolerance = BOTTOM_TOLERANCE_PX) {
  const { scrollY, viewportHeight, documentHeight } = metrics ?? {};
  if (![scrollY, viewportHeight, documentHeight].every((n) => Number.isFinite(n))) return false;
  return documentHeight - (scrollY + viewportHeight) <= tolerance;
}

/**
 * Wire the behavior up to a window. Everything it touches is injected, so the
 * reported sequence - portrait, landscape, portrait - can be played out in a
 * test against a fake window instead of asserted about in prose.
 *
 * @returns {{ start: () => () => void, isPinned: () => boolean }}
 */
export function createStickToBottom(env = {}) {
  const win = env.window ?? globalThis.window;
  const doc = env.document ?? win?.document;
  const now = env.now ?? (() => Date.now());
  const raf = env.requestAnimationFrame ?? ((fn) => win.requestAnimationFrame(fn));
  const caf = env.cancelAnimationFrame ?? ((id) => win.cancelAnimationFrame(id));

  let pinned = true;
  let settlingUntil = 0;
  let frame = 0;

  const settling = () => now() < settlingUntil;

  const measure = () => ({
    scrollY: win.scrollY,
    viewportHeight: win.innerHeight,
    documentHeight: doc.documentElement.scrollHeight,
  });

  const scrollToEnd = () => {
    // Past the end on purpose. The browser clamps, so asking for more than
    // exists is free - and it is the only ask that cannot be defeated by a
    // scrollHeight the browser has not finished recomputing.
    win.scrollTo({ top: doc.documentElement.scrollHeight, left: 0, behavior: 'instant' });
  };

  const stopSettling = () => {
    settlingUntil = 0;
    if (frame) caf(frame);
    frame = 0;
  };

  const pin = () => {
    scrollToEnd();
    frame = settling() ? raf(pin) : 0;
  };

  const onScroll = () => {
    if (settling()) return;
    pinned = isAtBottom(measure());
  };

  const onReflow = () => {
    if (!pinned) return;
    settlingUntil = now() + SETTLE_MS;
    if (!frame) frame = raf(pin);
  };

  function start() {
    const orientation = win.screen?.orientation;

    win.addEventListener('scroll', onScroll, { passive: true });
    win.addEventListener('resize', onReflow);
    // `window.orientationchange` is deprecated in favor of this one. It is an
    // addition, not a replacement for `resize`: resize is what every browser
    // fires on a rotation, and this arrives separately - often later, which on
    // iOS is exactly when the measurements have become true.
    orientation?.addEventListener?.('change', onReflow);
    for (const name of ['touchstart', 'wheel', 'keydown']) {
      win.addEventListener(name, stopSettling, { passive: true });
    }

    onScroll();

    return () => {
      stopSettling();
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onReflow);
      orientation?.removeEventListener?.('change', onReflow);
      for (const name of ['touchstart', 'wheel', 'keydown']) {
        win.removeEventListener(name, stopSettling);
      }
    };
  }

  return { start, isPinned: () => pinned };
}

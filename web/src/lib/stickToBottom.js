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
 *                             CLAMPS scrollY to 2720. Still the bottom.
 *   -> portrait again         the document is 4900 again, but scrollY is still
 *                             2720. That is 1480px short of where it was -
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
 * ends the window immediately AND suppresses the rest of the burst, because a
 * page that keeps pulling itself down while somebody is trying to scroll up is
 * a worse bug than the one being fixed. Ending only the current window is not
 * enough: iOS fires several resizes for one rotation, and the next one would
 * start the whole thing again half a second after the reader took over.
 *
 * ── WHY THERE ARE TWO RECORDS AND NOT ONE ─────────────────────────────────
 *
 * "Ignore scroll events while we are correcting" is not sufficient, because a
 * rotation does not begin with the resize. The order of `scroll` and `resize`
 * during a rotation is not specified anywhere, and on a browser that fires the
 * clamp FIRST there is a scroll event carrying rotation-time measurements
 * before anything has told us a rotation is happening. Believing it sets the
 * record to "not at the end", the resize a millisecond later reads that record
 * and does nothing, and the bug reproduces exactly as reported with the fix
 * installed and no signal anywhere.
 *
 * So the record the reflow consults is the reader's position AS OF BEFORE THE
 * BURST. A measurement is only promoted to that record once it has survived a
 * quiet moment - QUIET_MS with no reflow after it. A reader's genuine scroll
 * and their rotation of the phone are never within a quarter second of each
 * other; a browser's own clamp and its resize always are. That is the whole
 * distinction, and it does not depend on which of the two events a given
 * browser chooses to fire first.
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
 * How long a measurement must stand before it is believed.
 *
 * A scroll this close to a reflow is the browser's, not the reader's. 300ms is
 * far longer than the gap between a clamp and its resize, and far shorter than
 * the gap between a person scrolling and that same person turning their phone
 * over.
 */
export const QUIET_MS = 300;

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

  /** The reader's position as of before any current burst. What reflows read. */
  let stable = true;
  /** The most recent measurement, and when it was taken. Not yet believed. */
  let latest = true;
  let latestAt = -Infinity;

  let settlingUntil = 0;
  /** Set by a real gesture. Suppresses the rest of the reflow burst. */
  let takeoverUntil = 0;
  let frame = 0;

  const settling = () => now() < settlingUntil;

  const measure = () => ({
    scrollY: win.scrollY,
    viewportHeight: win.innerHeight,
    documentHeight: doc.documentElement.scrollHeight,
  });

  /**
   * Believe the pending measurement, if it has stood long enough.
   *
   * Called before ANY new measurement is taken and before any reflow is acted
   * on. Doing it only at reflow time is not enough, and that was a real bug in
   * this file: the browser's clamp fires a scroll of its own a millisecond
   * before the resize, which overwrote the reader's older, trustworthy
   * measurement with a rotation-time one before it had ever been promoted.
   * The reflow then found nothing worth believing and did nothing.
   */
  const promoteIfSettled = (at) => {
    if (at - latestAt > QUIET_MS) stable = latest;
  };

  const record = () => {
    const at = now();
    promoteIfSettled(at);
    latest = isAtBottom(measure());
    latestAt = at;
  };

  const scrollToEnd = () => {
    // Past the end on purpose. The browser clamps, so asking for more than
    // exists is free - and it is the only ask that cannot be defeated by a
    // scrollHeight the browser has not finished recomputing.
    const top = doc.documentElement.scrollHeight;
    try {
      win.scrollTo({ top, left: 0, behavior: 'instant' });
    } catch {
      // `instant` was added to ScrollBehavior late; Safari before 15.4 throws
      // a TypeError on it. Thrown inside the animation frame this runs in, that
      // would kill the loop silently on the platform this whole file is for.
      // The positional form has no enum to reject and no page here sets
      // scroll-behavior, so it is instant anyway.
      win.scrollTo(0, top);
    }
  };

  const stopFrame = () => {
    if (frame) caf(frame);
    frame = 0;
  };

  const takeOver = () => {
    settlingUntil = 0;
    takeoverUntil = now() + SETTLE_MS;
    stopFrame();
  };

  const pin = () => {
    scrollToEnd();
    frame = settling() ? raf(pin) : 0;
  };

  const onScroll = () => {
    // Our own correction, measured with numbers we already know are moving.
    if (settling()) return;
    record();
  };

  const onReflow = () => {
    const at = now();
    // A measurement that has stood through a quiet moment is the reader's.
    // One taken inside the burst is the browser's, and is left where it is.
    promoteIfSettled(at);

    if (at < takeoverUntil) return;
    if (!stable) return;

    settlingUntil = at + SETTLE_MS;
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
      win.addEventListener(name, takeOver, { passive: true });
    }

    record();
    stable = latest;

    return () => {
      stopFrame();
      settlingUntil = 0;
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onReflow);
      orientation?.removeEventListener?.('change', onReflow);
      for (const name of ['touchstart', 'wheel', 'keydown']) {
        win.removeEventListener(name, takeOver);
      }
    };
  }

  /**
   * Re-measure now, on purpose.
   *
   * For the one thing that changes the page's height without any event at all:
   * mounting the rest of the transcript. A reader who expands four months of
   * history is suddenly thousands of pixels from the end, nothing fires, and
   * the next resize - the keyboard opening under the composer - would throw
   * them to the bottom on the strength of a record taken before the expansion.
   */
  function refresh() {
    if (settling()) return;
    record();
    // Deliberate and trusted: this is called because the page's own code knows
    // the height changed, not because something fired an event we must judge.
    stable = latest;
  }

  return { start, refresh, isPinned: () => stable };
}

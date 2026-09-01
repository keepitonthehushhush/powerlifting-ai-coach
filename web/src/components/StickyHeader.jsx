import { useEffect, useRef, useState } from 'react';

/**
 * A header that gets out of the way while you read and comes back when you
 * reach for it.
 *
 * Reported problem: on a long page - a lifter with months of logged sessions,
 * or a long coaching conversation - getting back to the navigation meant
 * scrolling all the way to the top by hand.
 *
 * The behavior is the one people already know from mobile browsers: scrolling
 * DOWN means "I am reading, go away", so the header condenses; scrolling UP
 * means "I am looking for something", so it returns at full size. It never
 * disappears entirely, because a navigation bar you cannot see is one you
 * cannot use, and it never moves at all until you are past its own height so
 * short pages behave like ordinary pages.
 *
 * Two accessibility rules it must not break, both of which a naive version of
 * this does break:
 *
 *   1. It respects prefers-reduced-motion. A bar that animates on every scroll
 *      is exactly the kind of movement that triggers vestibular symptoms.
 *   2. It restores itself whenever anything inside it takes focus, so a
 *      keyboard user tabbing into the navigation never lands on a control that
 *      is scrolled half out of view.
 *
 * ── THE FEEDBACK LOOP, AND WHY THE GUARDS BELOW EXIST ──────────────────────
 *
 * This header sits in normal flow, so condensing it makes the DOCUMENT
 * SHORTER. The browser reacts to that by moving the scroll position - it
 * clamps at the bottom of the page, and it re-anchors elsewhere - and that
 * movement arrives here as an ordinary scroll event, in the opposite
 * direction, that the reader never made. Acting on it expands the header,
 * which makes the document taller again, which moves the scroll position
 * back, which condenses it. Forever.
 *
 * That is not a theory. Driven at 390x760 against this exact source, the
 * bottom of a long conversation produced 96 state flips in a couple of
 * seconds, the document height oscillated between 4853 and 4896 pixels, and
 * the test driver gave up trying to click the message box after thirty
 * seconds because the element "is not stable". That is the reported
 * "jittering movement" at the bottom of the coach page.
 *
 * Two guards, and they fix different halves of it:
 *
 *   A. IGNORE SCROLLS WE CAUSED. A change in document height means the
 *      previous frame's state change moved the page, not the reader. Re-sync
 *      and do nothing. This breaks the loop.
 *   B. HOLD STILL AT EITHER END. Within the header's own height of the top or
 *      the bottom there is no reading room to reclaim, and shrinking the
 *      document at the bottom yanks the view. The header already refused to
 *      move near the top; it now refuses near the bottom for the same reason.
 */
export function StickyHeader({ children }) {
  const [condensed, setCondensed] = useState(false);
  const lastY = useRef(0);
  const ref = useRef(null);

  useEffect(() => {
    // Threshold, not raw delta: without it a one-pixel scroll jitter flips the
    // header back and forth and the page appears to vibrate.
    const THRESHOLD = 8;
    let ticking = false;

    // Where the page actually is when we start. Starting from zero is wrong
    // whenever the browser restores a scroll position on reload: the first
    // event would carry a delta of several thousand pixels.
    lastY.current = window.scrollY;
    let lastDocHeight = document.documentElement.scrollHeight;

    function evaluate() {
      const y = window.scrollY;
      const height = ref.current?.offsetHeight ?? 0;
      const docHeight = document.documentElement.scrollHeight;

      // GUARD A. The document changed height, so this scroll is the browser
      // reacting to our own last state change (or to a new message arriving),
      // not the reader moving. Re-synchronise and take no action; acting here
      // is the loop described above.
      if (docHeight !== lastDocHeight) {
        lastDocHeight = docHeight;
        lastY.current = y;
        ticking = false;
        return;
      }

      const delta = y - lastY.current;
      // GUARD B. Within the header's own height of either end, hold still.
      // At the top there is nothing to get out of the way of; at the bottom
      // there is nothing left to read, and condensing there shortens the
      // document out from under the scroll position.
      const nearTop = y <= height;
      const nearBottom = y + window.innerHeight >= docHeight - height;

      if (nearTop) {
        setCondensed(false);
      } else if (!nearBottom && Math.abs(delta) > THRESHOLD) {
        setCondensed(delta > 0);
      }
      lastY.current = y;
      ticking = false;
    }

    function onScroll() {
      // One evaluation per animation frame. Scroll fires far faster than the
      // screen refreshes, and doing layout work on every event is how a page
      // becomes janky on the phone this app is actually used on.
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(evaluate);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      ref={ref}
      className={condensed ? 'sticky-header condensed' : 'sticky-header'}
      onFocusCapture={() => setCondensed(false)}
    >
      {children}
    </div>
  );
}

/**
 * Appears once the page is long enough to have lost you, and not before.
 *
 * Deliberately a real <button> rather than an anchor to #top: it must be
 * reachable by keyboard, announce itself, and honor reduced motion. An
 * `href="#top"` also writes a history entry, so Back would then mean "scroll
 * down again" rather than "go to the previous page".
 */
export function BackToTop({ label }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let ticking = false;
    function evaluate() {
      setVisible(window.scrollY > window.innerHeight);
      ticking = false;
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(evaluate);
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="back-to-top"
      onClick={() => {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      }}
    >
      ↑ {label}
    </button>
  );
}

/**
 * The same idea as BackToTop, rendered inline wherever it is placed.
 *
 * The coach page gets this one instead of the floating variant, and the reason
 * is where a thumb rests. The conversation has a sticky composer along the
 * bottom edge; a floating button at the bottom right would sit on top of the
 * send button, which is both the most-used control on the page and exactly
 * where someone typing between sets is already touching. Being interrupted by
 * a control you did not mean to press is worse than scrolling.
 *
 * In the pinned header it is always reachable, never under a thumb, and it
 * appears only once there is somewhere to go back to.
 */
export function JumpToTop({ label }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let ticking = false;
    function evaluate() {
      setVisible(window.scrollY > window.innerHeight * 0.75);
      ticking = false;
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(evaluate);
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="nav-jump"
      onClick={() => {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      }}
    >
      ↑ {label}
    </button>
  );
}

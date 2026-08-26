import { useEffect, useRef, useState } from 'react';

/**
 * A header that gets out of the way while you read and comes back when you
 * reach for it.
 *
 * Reported problem: on a long page - a lifter with months of logged sessions,
 * or a long coaching conversation - getting back to the navigation meant
 * scrolling all the way to the top by hand.
 *
 * The behaviour is the one people already know from mobile browsers: scrolling
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

    function evaluate() {
      const y = window.scrollY;
      const height = ref.current?.offsetHeight ?? 0;
      const delta = y - lastY.current;

      if (y <= height) {
        setCondensed(false);
      } else if (Math.abs(delta) > THRESHOLD) {
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
 * reachable by keyboard, announce itself, and honour reduced motion. An
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

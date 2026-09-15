import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Which edge of a horizontally scrolling box actually has more content past it.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * "When looking at the FAQ tab it looks like part of it is hidden - like it is
 * about to hide behind a wall."
 *
 * It was. `.nav-places` faded its last 18px unconditionally, so that when the
 * destinations overflow the final one is softened rather than sliced - which
 * is right, and which was being applied whether or not anything overflowed.
 * Between roughly 820 and 860 pixels of window width the last tab's right edge
 * lands inside that fade while the row is NOT scrollable, so a fully visible
 * tab was dimmed for no reason, with nothing to scroll to. Selecting the text
 * made it obvious, because the selection highlight fades under the mask too.
 *
 * ── WHY MEASURE RATHER THAN GUESS WITH A MEDIA QUERY ──────────────────────
 *
 * The width at which a row overflows is not a property of the screen. It
 * depends on how many things are in it and how long their labels are, and the
 * labels are translated - "Log session" and "Registrar sesión" do not wrap at
 * the same place, and "chest-supported dumbbell row" is not as wide as
 * "squat". A breakpoint would be correct in one language and one program.
 *
 * So it asks the element. `scrollWidth > clientWidth` is the only honest test
 * of "is there more", and the scroll position decides WHICH side to fade: a
 * fade on the left when there is nothing to the left is the same defect
 * pointing the other way.
 *
 * ── WHY IT MOVED OUT OF SiteNav.jsx ───────────────────────────────────────
 *
 * It was written for the navigation and it was the only measured affordance in
 * the application, which is why the program table could hide a column and the
 * week strip could hide four days with nothing on screen saying so. A
 * measurement that only one component can reach is a measurement three other
 * components will do by eye. See components/ScrollRegion.jsx.
 *
 * @returns {{
 *   ref: a React ref to put on the scrolling element,
 *   fade: 'none'|'start'|'end'|'both',
 *   overflowing: boolean,
 *   atEnd: boolean,
 *   nudge: () => void,
 * }}
 */
export function useEdgeFade() {
  const ref = useRef(null);
  const [fade, setFade] = useState('none');

  // Runs after every render as well as on scroll and resize. Labels change
  // length when the language does, and that changes nothing's box size, so a
  // ResizeObserver alone would miss it. setState with an unchanged value is a
  // no-op in React, so re-measuring on every render cannot loop.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const measure = () => {
      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow <= 1) return setFade('none');
      const atStart = el.scrollLeft <= 1;
      const atRightEnd = el.scrollLeft >= overflow - 1;
      return setFade(atStart ? 'end' : atRightEnd ? 'start' : 'both');
    };

    measure();
    el.addEventListener('scroll', measure, { passive: true });

    // Guarded: jsdom has no ResizeObserver, and the tests render this.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);

    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  });

  // `fade` already carries the answer to both of these: it is the name of the
  // edge that has something past it. 'start' means there is more to the LEFT
  // and nothing to the right, which is the definition of being at the end.
  const overflowing = fade !== 'none';
  const atEnd = fade === 'start';

  /**
   * One press of the control. Forward by most of a screenful, or back to the
   * beginning once there is no forward left.
   *
   * 0.8 rather than 1: a full-width jump leaves nothing from the previous view
   * on screen, and the column you were reading disappears with no overlap to
   * tell you where you landed. Carousels have used a partial advance for the
   * same reason for twenty years.
   */
  const nudge = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A person who has asked their system not to animate gets no animation.
    const still =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = still ? 'auto' : 'smooth';
    const overflow = el.scrollWidth - el.clientWidth;
    if (el.scrollLeft >= overflow - 1) el.scrollTo({ left: 0, behavior });
    else el.scrollBy({ left: Math.round(el.clientWidth * 0.8), behavior });
  }, []);

  return { ref, fade, overflowing, atEnd, nudge };
}

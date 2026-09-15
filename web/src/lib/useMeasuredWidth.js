import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The element's own width in CSS pixels, so an SVG can draw at 1:1.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 *
 * `LiftChart` and `OneRepMaxChart` both declared `viewBox="0 0 340 170"` and
 * both rendered inside a grid track that gives them 302px. A viewBox is a
 * scale factor, so everything in the picture was multiplied by 302/340:
 *
 *     declared          rendered
 *     font-size: 10px   8.9px   on every desktop viewport
 *                       9.1px   on a phone
 *     stroke-width: 2   1.78px
 *     dot r=4           3.55px
 *
 * Measured in Chromium at 390, 834, 1024, 1280 and 1680. The number in the
 * stylesheet was not the number on the screen at any of them, and 8.9px is
 * below the smallest rung on the type scale - which is 11px, `--text-caption-2`.
 *
 * `typeScale.test.js` already half-knew. Its allowlist entry for the raw
 * `10px` reads "It is not 10px on screen and it is not on the text ladder",
 * and then never says what it IS. A note that a number is wrong, without the
 * right number, is how a defect survives being noticed.
 *
 * ── WHY MEASURE RATHER THAN PICK A BIGGER NUMBER ──────────────────────────
 *
 * Raising the declared size until it lands on 11px would mean dividing by a
 * scale factor that is itself a layout outcome - it is 0.888 in a two-column
 * grid, 0.908 on a phone, and something else again the day the grid changes.
 * That is the same defect with a different constant in it.
 *
 * Asking the element makes the scale factor 1. Then `font-size: 11px` is 11px,
 * a 2px stroke is 2px, and the stylesheet can be read literally - which is
 * also what lets the chart get WIDER later without getting zoomed: the height
 * stays a real 170px, so extra width buys resolution instead of magnification.
 *
 * ── WHY NOT useEdgeFade's SHAPE EXACTLY ───────────────────────────────────
 *
 * That hook answers a yes/no about overflow and can afford to settle a frame
 * late. This one decides the geometry of what is drawn, so it measures in
 * `useLayoutEffect` - before paint - or the first frame shows the fallback
 * scale and then jumps.
 *
 * @param {number} fallback width to use until the element can be measured, and
 *   in any environment without layout at all (jsdom, and the tests that use it)
 * @returns {[import('react').RefObject<Element>, number]}
 */
export function useMeasuredWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);

  /*
   * Rounded, and only set when it actually changes. A sub-pixel container
   * width - which is what `1fr` produces most of the time - would otherwise
   * re-render this on every resize frame with a number no one can see.
   */
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const next = Math.round(el.getBoundingClientRect().width);
    if (next > 0) setWidth((current) => (current === next ? current : next));
  };

  // Before paint, so the first frame is already at the right scale.
  useLayoutEffect(measure);

  useEffect(() => {
    // Guarded: jsdom has no ResizeObserver, and the tests render this.
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

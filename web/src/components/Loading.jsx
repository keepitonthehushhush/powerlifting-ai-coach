import { Logo } from './Logo.jsx';
import { useI18n } from '../i18n/index.jsx';

/**
 * Something to watch while the app is waiting.
 *
 * ── WHAT IT IS ────────────────────────────────────────────────────────────
 *
 * A stick figure curling the Coach Diaz badge, asked for in those words. The
 * badge is the real `Logo` component rather than a copy of it, so if the mark
 * changes the animation changes with it - a second hand-drawn version would
 * drift from the first within a month.
 *
 * ── WHERE IT IS AND IS NOT USED ───────────────────────────────────────────
 *
 * It replaces the word "Loading…" in the places that were already waiting on
 * something real: the session check, a profile fetch, a program fetch. It is
 * NOT an interstitial between pages.
 *
 * That distinction is the whole design. Every route in this application is in
 * one bundle, so moving between pages involves no network at all - React swaps
 * the tree in a frame. Putting an animation in front of that would not cover a
 * wait, it would MANUFACTURE one, and the product would get slower in exchange
 * for looking busier. A spinner in front of an instant transition is the
 * clearest way to make a fast application feel slow.
 *
 * So it appears exactly where there was already something to wait for.
 *
 * ── AND IT HOLDS STILL FOR ANYBODY WHO ASKED IT TO ────────────────────────
 *
 * Under `prefers-reduced-motion` the arm does not move. Somebody who asked
 * their operating system for less motion did not make an exception for a
 * loading screen, and a repeating animation is among the worst offenders for
 * vestibular disorders. The figure and the word remain, which is all the
 * information the animation was carrying anyway.
 */
/**
 * How wide the badge is inside the figure, as a fraction of the whole figure.
 *
 * The badge is drawn 64 units wide in a 200-unit viewBox, so it always renders
 * at 32% of whatever `size` the caller asks for. That number is written down
 * here because the component has to hand it to `Logo`; see below.
 */
const BADGE_SHARE = 64 / 200;

export function Loading({ size = 120 }) {
  const { t } = useI18n();
  const label = t('common.loading');

  /*
   * ── THE BADGE HAS TO BE TOLD HOW BIG IT REALLY IS ───────────────────────
   *
   * `Logo` switches to a simplified mark below 32px, because the full one
   * carries five barbell elements whose inner sleeves merge into a single
   * smear at small sizes. It decides that from its `size` prop.
   *
   * Inside an SVG, that prop is in USER UNITS, not pixels. Passing a flat 64
   * meant Logo believed it was 64px tall and drew the full mark - while the
   * viewBox scaled it down to 32% of the figure. At the 120px figure that is
   * 38px and fine. At the 72px figure used in the page-level waits it is 23px,
   * and the mark rendered as mud. Nothing errored. The build was green. It was
   * found by rendering the two sizes side by side and looking at them.
   *
   * So Logo is handed the size it will ACTUALLY occupy on screen, and the
   * group scales the result back up to the 64 units the layout is built
   * around. The variant is now chosen on the truth.
   */
  const badgePixels = Math.round(size * BADGE_SHARE);
  const backToUserUnits = 64 / badgePixels;

  return (
    <span className="loading" role="status">
      {/*
        * aria-hidden, and the text below carries the meaning. A screen reader
        * announcing "stick figure curling a badge" would be describing the
        * decoration instead of saying that something is loading.
        */}
      <svg
        className="loading-figure"
        width={size}
        height={size}
        viewBox="0 0 200 200"
        aria-hidden="true"
        focusable="false"
      >
        <g
          stroke="var(--text)"
          strokeWidth="9"
          strokeLinecap="round"
          fill="none"
        >
          {/* Head, torso, legs: the half that stays still. */}
          <circle cx="64" cy="44" r="15" />
          <line x1="64" y1="59" x2="64" y2="118" />
          <line x1="64" y1="118" x2="46" y2="172" />
          <line x1="64" y1="118" x2="82" y2="172" />
          {/* Upper arm. Fixed, because the elbow is what a curl pivots on. */}
          <line x1="64" y1="72" x2="104" y2="112" />
        </g>

        {/*
          * Forearm and badge together, rotating about the elbow at (104, 112).
          * The badge turns with the hand rather than staying level, which is
          * what a weight actually does through a curl.
          */}
        <g className="loading-arm">
          <line
            x1="104"
            y1="112"
            x2="126"
            y2="152"
            stroke="var(--text)"
            strokeWidth="9"
            strokeLinecap="round"
          />
          <g transform={`translate(94, 120) scale(${backToUserUnits})`}>
            <Logo size={badgePixels} title={label} />
          </g>
        </g>
      </svg>
      <span className="loading-word muted">{label}</span>
    </span>
  );
}

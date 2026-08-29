import { useI18n } from '../i18n/index.jsx';

/**
 * Something to watch while the app is waiting: a lifter pulling a heavy
 * deadlift.
 *
 * ── HOW IT IS BUILT, AND WHY THAT MATTERS ─────────────────────────────────
 *
 * The figure is a KINEMATIC CHAIN rooted at the ankle. Each segment is a `<g>`
 * nested inside the one below it, rotating about its own joint:
 *
 *     shin (pivots at the ankle)
 *       └── thigh (pivots at the knee)
 *             └── torso (pivots at the hip)
 *                   └── arms (pivot at the shoulder)
 *                         └── the barbell, held in the hands
 *
 * That nesting is the whole design, and it buys one property that is hard to
 * get any other way: THE FEET STAY ON THE FLOOR. Rotating a joint carries
 * everything above it along, and nothing below it moves. Animate the figure
 * the obvious way instead - one group per limb, all siblings, each with its
 * own keyframes - and the segments come apart at the joints the moment two
 * of them disagree, because nothing structurally connects them.
 *
 * It also means the animation is four numbers. Everything is drawn ONCE, in
 * the lockout pose, standing straight; the bottom position is that same
 * drawing with four rotations applied. There is no second set of coordinates
 * to keep in step with the first.
 *
 * ── WHERE THE POSE CAME FROM ──────────────────────────────────────────────
 *
 * Not from taste. The bottom position is solved: the shin and thigh angles
 * are chosen for the look (shins slightly forward, hips above the knees), and
 * the torso angle is then whatever puts the hands exactly on a bar resting on
 * the floor - which lands at 26 degrees above horizontal, right for a
 * conventional pull. Hand-tuning the third angle instead gives a figure whose
 * arms end somewhere near the bar, and "near" reads as broken.
 *
 * The bar path was checked rather than assumed. CSS interpolates the four
 * rotations linearly, and there is no reason in principle for that to move
 * the hands in a straight line - a bar that swings out and away would look
 * wrong to anybody who lifts. Sampled across the pull it travels upward and
 * slightly BACK toward the body, monotonically, which is what a real bar path
 * does.
 *
 * ── AND WHERE IT IS NOT USED ──────────────────────────────────────────────
 *
 * Not as an interstitial between pages. Every route in this application is in
 * one bundle, so moving between pages involves no network - React swaps the
 * tree in a frame. Putting an animation in front of that would not cover a
 * wait, it would MANUFACTURE one, and the product would get slower in
 * exchange for looking busier. It appears only where something was already
 * being waited for.
 */
export function Loading({ size = 120 }) {
  const { t } = useI18n();
  const label = t('common.loading');

  return (
    <span className="loading" role="status">
      {/*
        * aria-hidden, and the word below carries the meaning. A screen reader
        * describing a stick figure would be reading the decoration out loud
        * instead of saying that something is loading.
        */}
      <svg
        className="lift"
        width={size}
        height={size}
        viewBox="0 0 200 200"
        aria-hidden="true"
        focusable="false"
      >
        {/* The ground. Everything else is measured from it. */}
        <line className="lift-floor" x1="38" y1="176.5" x2="162" y2="176.5" />

        <g className="lift-body">
          {/* The foot is outside the chain on purpose: it is the one part of
              a deadlift that does not move. */}
          <line className="lift-foot" x1="76" y1="173" x2="112" y2="173" />

          <g className="lift-shin">
            <line x1="84" y1="168" x2="84" y2="132" />

            <g className="lift-thigh">
              <line x1="84" y1="132" x2="84" y2="98" />

              <g className="lift-torso">
                <line x1="84" y1="98" x2="84" y2="52" />
                <circle className="lift-head" cx="84" cy="36" r="10" />

                {/* The arm hangs 7 units in front of the body rather than
                    straight down the middle. Without that offset the arm and
                    the torso are the same line at lockout, and the figure
                    loses its arms at exactly the moment the lift finishes. */}
                <g className="lift-arm">
                  <line x1="84" y1="52" x2="91" y2="104" />
                  <g className="lift-bar">
                    <line x1="51" y1="104" x2="131" y2="104" />
                    <circle cx="64" cy="104" r="19" />
                    <circle cx="118" cy="104" r="19" />
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
      <span className="loading-word muted">{label}</span>
    </span>
  );
}

import { useI18n } from '../i18n/index.jsx';

/**
 * Something to watch while the app is waiting: a judged deadlift.
 *
 * ── HOW THE LIFTER IS BUILT, AND WHY THAT IS THE DESIGN ───────────────────
 *
 * A KINEMATIC CHAIN rooted at the ankle. Each segment is a `<g>` nested inside
 * the one below it, rotating about its own joint:
 *
 *     shin (pivots at the ankle)
 *       └── thigh (pivots at the knee)
 *             └── torso (pivots at the hip)
 *                   └── arms (pivot at the shoulder)
 *                         └── the barbell, held in the hands
 *
 * That nesting buys one property that is hard to get any other way: THE FEET
 * STAY ON THE FLOOR. Rotating a joint carries everything above it and moves
 * nothing below it. Animate this the obvious way instead - one group per limb,
 * all siblings, each with its own keyframes - and the segments come apart at
 * the joints the moment two of them disagree, because nothing structurally
 * connects them.
 *
 * Everything is drawn ONCE, in the lockout pose, standing straight. The bottom
 * position is that same drawing with four rotations applied.
 *
 * ── WHY THE BAR IS DRAWN FROM THE FRONT WHEN THE LIFTER IS FROM THE SIDE ──
 *
 * Because a barbell seen truly side-on is one circle, and one circle reads as
 * a wheel - which is exactly what was reported about the first version: "you
 * can't really tell what it's deadlifting."
 *
 * So the bar takes the standard barbell idiom: a horizontal shaft with the
 * plates seen EDGE-ON as vertical bars, tallest inboard, descending outward to
 * the collars. That is the same way the Coach Diaz mark draws its own barbell,
 * so the animation speaks the product's visual language without reusing the
 * logo. Mixing the two viewpoints is a deliberate stylisation, and it is the
 * thing that makes the object legible.
 *
 * The plate sizes are the real ones, scaled. A competition bar sits 225mm off
 * the floor because the largest plate is 450mm across, and everything here is
 * measured from that: the tallest plate's half-height plus half its stroke IS
 * the bar height, which is why the bar lands exactly on the floor line.
 *
 * ── AND THE THREE LIGHTS ──────────────────────────────────────────────────
 *
 * Powerlifting is judged by three referees, white for a good lift and red for
 * a no-lift, and the lift stands on a majority - two white and one red still
 * counts. There is no points score anywhere in the sport, which is why this is
 * three lights and not three scorecards.
 *
 * They come on just after lockout, a fraction apart rather than together,
 * because three people press three buttons. All three are white: a red light
 * on every single page load is a strange thing to tell somebody who is waiting
 * for their coach to answer.
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
        {/* The platform. Everything else is measured from it. */}
        <line className="lift-floor" x1="30" y1="176.5" x2="170" y2="176.5" />

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
                {/* A lifting belt, drawn across the waist. One stroke, and it
                    is the difference between a stick figure and a stick figure
                    that is about to pull something heavy. */}
                <line className="lift-belt" x1="78.5" y1="88" x2="89.5" y2="88" />

                {/* The arm hangs 7 units in front of the body rather than
                    straight down the middle. Without that offset the arm and
                    the torso are the same line at lockout, and the figure
                    loses its arms at exactly the moment the lift finishes. */}
                <g className="lift-arm">
                  <line x1="84" y1="52" x2="91" y2="104" />

                  {/* ── THE BAR ───────────────────────────────────────────
                      Shaft, then per side, inboard to outboard: the 25kg
                      plate (tallest, the one that sets the bar's height off
                      the floor), a 10kg, a 5kg, and the collar. Two grip
                      marks for the hands. */}
                  <g className="lift-bar">
                    <line className="lift-shaft" x1="41" y1="104" x2="141" y2="104" />
                    <line className="lift-grip" x1="80" y1="104" x2="80" y2="104" />
                    <line className="lift-grip" x1="102" y1="104" x2="102" y2="104" />

                    <line className="lift-plate-1" x1="65" y1="85" x2="65" y2="123" />
                    <line className="lift-plate-2" x1="56" y1="91" x2="56" y2="117" />
                    <line className="lift-plate-3" x1="49" y1="95.5" x2="49" y2="112.5" />
                    <line className="lift-collar" x1="43.5" y1="99" x2="43.5" y2="109" />

                    <line className="lift-plate-1" x1="117" y1="85" x2="117" y2="123" />
                    <line className="lift-plate-2" x1="126" y1="91" x2="126" y2="117" />
                    <line className="lift-plate-3" x1="133" y1="95.5" x2="133" y2="112.5" />
                    <line className="lift-collar" x1="138.5" y1="99" x2="138.5" y2="109" />
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>

        {/* Three referees. Written out rather than generated, because a test
            counts them and "there are exactly three" is the rule. */}
        <g className="lift-lights">
          <g className="lift-light">
            <circle className="lift-light-ring" cx="64" cy="190" r="7" />
            <circle className="lift-lamp" cx="64" cy="190" r="7" />
          </g>
          <g className="lift-light">
            <circle className="lift-light-ring" cx="100" cy="190" r="7" />
            <circle className="lift-lamp" cx="100" cy="190" r="7" />
          </g>
          <g className="lift-light">
            <circle className="lift-light-ring" cx="136" cy="190" r="7" />
            <circle className="lift-lamp" cx="136" cy="190" r="7" />
          </g>
        </g>
      </svg>
      <span className="loading-word muted">{label}</span>
    </span>
  );
}

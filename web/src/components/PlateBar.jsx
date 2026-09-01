import { PLATE_COLORS, tallyPlates } from '../lib/plates.js';

/**
 * A barbell, loaded with the plates that make one particular weight.
 *
 * ── WHY THIS IS DRAWN AND NOT A PICTURE ───────────────────────────────────
 *
 * Because it has to be RIGHT. Every image of a loaded barbell is a claim about
 * how much is on it, and an athlete who can count plates will check. A stock
 * photograph shows somebody else's lift; a generated one shows a bar that does
 * not add up, because counting objects is a known failure of image models and
 * loading a barbell is a counting problem. Drawing it from the same function
 * that computes the loadout means the picture cannot disagree with the number.
 *
 * It is also about 1 KB of markup that inherits the current theme, against
 * roughly 135 KB for a median hero image that would need a second copy for
 * dark mode and would still be wrong.
 *
 * ── COLOR IS NOT THE INFORMATION ──────────────────────────────────────────
 *
 * The kilo plates are colored the way the IPF requires, which is a real
 * convention an athlete already reads. But color is never the only channel:
 * the plates are also ordered and sized, and the text underneath names every
 * plate in words. A reader who cannot distinguish the red 25 from the green 10
 * loses nothing, and so does a reader whose screen reader ignores the drawing
 * entirely - which is why it is aria-hidden with the real answer in text.
 */

/** Relative disc diameter. The competition 25/20/15/10 share a size and
 *  everything below steps down, which is true of real plates and is the
 *  detail that makes a drawn bar read as a bar. */
const DIAMETER = {
  kg: { 25: 1, 20: 1, 15: 1, 10: 1, 5: 0.52, 2.5: 0.44, 1.25: 0.37, 0.5: 0.32, 0.25: 0.3 },
  lb: { 45: 1, 35: 0.88, 25: 0.74, 10: 0.56, 5: 0.44, 2.5: 0.36 },
};
const THICKNESS = {
  kg: { 25: 1, 20: 0.84, 15: 0.66, 10: 0.5, 5: 0.42, 2.5: 0.34, 1.25: 0.28, 0.5: 0.24, 0.25: 0.22 },
  lb: { 45: 0.92, 35: 0.76, 25: 0.62, 10: 0.42, 5: 0.34, 2.5: 0.26 },
};

/** IPF colors for the kilo set. Pound plates get the neutral fill, because no
 *  standard exists for them and inventing one would invent a convention. */
const FILL = {
  red: 'var(--plate-red)',
  blue: 'var(--plate-blue)',
  yellow: 'var(--plate-yellow)',
  green: 'var(--plate-green)',
  white: 'var(--plate-white)',
  black: 'var(--plate-black)',
  silver: 'var(--plate-silver)',
};

function fillFor(plate, units) {
  const named = PLATE_COLORS[units]?.[plate]?.name;
  return FILL[named] ?? 'var(--plate-silver)';
}

export function PlateBar({ loadout, label }) {
  const { plates, units } = loadout;
  if (!plates.length) return null;

  const W = 760;
  const H = 200;
  const midY = H / 2;
  const shaftL = 250;
  const shaftR = 510;
  const sleeve = 170;
  const maxHalf = 78;

  const totalThickness = plates.reduce((sum, p) => sum + (THICKNESS[units][p] ?? 0.3), 0);
  // Scale so the stack always fits the sleeve, however many plates there are.
  const unitThickness = Math.min(22, (sleeve - 24) / Math.max(totalThickness, 0.001));

  const discs = [];
  let right = shaftR + 4;
  let left = shaftL - 4;
  plates.forEach((plate, i) => {
    const thickness = Math.max(4, (THICKNESS[units][plate] ?? 0.3) * unitThickness);
    const half = (DIAMETER[units][plate] ?? 0.4) * maxHalf;
    const fill = fillFor(plate, units);
    const radius = Math.min(4, thickness / 2.2);
    const disc = (x, side) => (
      <g key={`${side}-${i}`}>
        <rect x={x} y={midY - half} width={thickness} height={half * 2} rx={radius} fill={fill} />
        <rect
          x={x}
          y={midY - half}
          width={thickness}
          height={half * 2}
          rx={radius}
          fill="url(#plate-face)"
        />
        <rect
          x={x}
          y={midY - half}
          width={thickness}
          height={half * 2}
          rx={radius}
          fill="none"
          stroke="#000"
          strokeOpacity="0.28"
          strokeWidth="0.8"
        />
      </g>
    );
    discs.push(disc(right, 'r'), disc(left - thickness, 'l'));
    right += thickness + 1.4;
    left -= thickness + 1.4;
  });

  return (
    <svg
      className="plate-bar"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      focusable="false"
    >
      <defs>
        <linearGradient id="plate-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--steel-low)" />
          <stop offset="34%" stopColor="var(--steel-high)" />
          <stop offset="62%" stopColor="var(--steel-mid)" />
          <stop offset="100%" stopColor="var(--steel-low)" />
        </linearGradient>
        <linearGradient id="plate-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="46%" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.24" />
        </linearGradient>
      </defs>

      {/* sleeves */}
      <rect x={shaftL - sleeve} y={midY - 12} width={sleeve} height="24" rx="3" fill="url(#plate-steel)" />
      <rect x={shaftR} y={midY - 12} width={sleeve} height="24" rx="3" fill="url(#plate-steel)" />
      {/* shaft */}
      <rect x={shaftL} y={midY - 7} width={shaftR - shaftL} height="14" rx="2.5" fill="url(#plate-steel)" />
      {/* the ring marks a lifter sets their hands against */}
      <rect x={shaftL + 42} y={midY - 7} width="2.5" height="14" fill="var(--steel-low)" />
      <rect x={shaftR - 45} y={midY - 7} width="2.5" height="14" fill="var(--steel-low)" />

      {discs}
    </svg>
  );
}

/** "2 x 25, 1 x 15, 1 x 2.5" - the same answer in words, for the table, the
 *  printed sheet, and anybody the drawing does not reach. */
export function plateWords(loadout) {
  return tallyPlates(loadout.plates)
    .map(({ plate, count }) => `${count} × ${plate}`)
    .join(', ');
}

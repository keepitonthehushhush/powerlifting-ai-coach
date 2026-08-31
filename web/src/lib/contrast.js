/**
 * WCAG relative luminance and contrast, and the solver that uses them.
 *
 * ── WHY THIS IS A MODULE AND NOT A TEST HELPER ────────────────────────────
 *
 * The math already existed, inside server/test/palette.test.js, because a
 * comment in the stylesheet claimed a link color reached 4.98:1 when it
 * actually reached 3.48 - a number written in good faith that was simply
 * wrong. The lesson recorded there is the right one: a number in a comment is
 * a memory, a number from a function is a measurement.
 *
 * Ten themes arrive with this change, in light and dark, which is roughly
 * four hundred color values. Hand-picking those and hoping is how you ship
 * nine unreadable themes and find out from a user. So the same math that
 * CHECKS the palette now also BUILDS it: `solveLightness` searches for the
 * lightness at which a color clears a required ratio, so a palette is
 * compliant by construction rather than by luck.
 *
 * One implementation, used by the generator and by the test that polices it.
 * Two copies of this would be the drift that has already cost this project
 * twice.
 */

/** sRGB channel to linear light. WCAG 2.x definition. */
function channel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** @param {string} hex `#rgb` or `#rrggbb` */
export function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = full.match(/../g).map((x) => parseInt(x, 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two hex colors. Order does not matter. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.2 thresholds, named so a call site says what it is asking for. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;
export const AA_NON_TEXT = 3;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const toHex = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

/**
 * HSL to hex. Saturation and lightness are percentages, hue is degrees.
 *
 * HSL rather than a perceptual space on purpose: the values below are authored
 * by hand as hues, and HSL's lightness is monotonic in luminance for a fixed
 * hue and saturation - which is the only property the solver needs. A
 * perceptually uniform space would give prettier ramps and buy nothing here,
 * because the solver measures the result rather than trusting the space.
 */
export function hsl(h, s, l) {
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ][Math.floor(hp) % 6]
  );
  const m = lig - c / 2;
  return `#${toHex((r + m) * 255)}${toHex((g + m) * 255)}${toHex((b + m) * 255)}`;
}

/**
 * Find the lightness at which `hue`/`sat` clears `target` against `against`.
 *
 * ── WHY A SEARCH AND NOT A TABLE ──────────────────────────────────────────
 *
 * Contrast is not linear in lightness, and it is not even monotonic in the
 * same DIRECTION for every pair - a mid-gray can fail against both a light and
 * a dark ground. Picking lightness values by eye and then asserting the ratio
 * afterwards means every new theme is a coin flip that a test call has to
 * catch. Solving for it means the palette cannot be born failing.
 *
 * Binary search over the half of the lightness range that moves AWAY from the
 * background, so the answer is the closest compliant color rather than the
 * most extreme one - a muted gray that just clears 4.5:1 still looks muted,
 * where clamping to white does not.
 *
 * Returns the extreme of the range when even that cannot reach the target,
 * which happens for a strongly saturated hue against a mid ground. The caller
 * does not get to ignore that: the palette test measures every pair, so an
 * unreachable target fails loudly rather than shipping at 4.1:1.
 */
export function solveLightness(hue, sat, against, target, { lighter } = {}) {
  const goLighter = lighter ?? luminance(against) < 0.18;

  // Walk the range in the chosen direction, keeping the least extreme value
  // that still clears the target.
  let best = goLighter ? 100 : 0;
  let found = false;
  for (let step = 0; step <= 100; step += 1) {
    const l = goLighter ? step : 100 - step;
    if (contrast(hsl(hue, sat, l), against) >= target) {
      best = l;
      found = true;
      break;
    }
  }
  if (!found) return goLighter ? 100 : 0;

  // Refine to a fraction of a percent, so the color is as close to the ground
  // as compliance allows rather than a whole step past it.
  let lo = goLighter ? Math.max(0, best - 1) : best;
  let hi = goLighter ? best : Math.min(100, best + 1);
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    const ok = contrast(hsl(hue, sat, mid), against) >= target;
    if (goLighter) {
      if (ok) hi = mid;
      else lo = mid;
    } else if (ok) lo = mid;
    else hi = mid;
  }
  return goLighter ? hi : lo;
}

/** The compliant color itself, which is what call sites actually want. */
export function solveColor(hue, sat, against, target, options) {
  return hsl(hue, sat, solveLightness(hue, sat, against, target, options));
}

/**
 * The lightest (or darkest) color of this hue that clears `target` against
 * EVERY ground it will sit on.
 *
 * Two grounds, not one, because the app puts the same ink on a page and on a
 * card, and which of those is the harder test flips between modes: in dark
 * mode the card is lighter than the page, in light mode the page is slightly
 * darker than the card. The palette test learned that the expensive way - it
 * checked muted text against the card only, and the loading message, which
 * sits on the page, was the one going unchecked. Solving against both removes
 * the chance to pick the wrong one.
 */
export function solveColorAgainst(hue, sat, grounds, target, options) {
  const candidates = grounds.map((g) => solveLightness(hue, sat, g, target, options));
  const lighter = options?.lighter ?? luminance(grounds[0]) < 0.18;
  // The more extreme requirement wins: it satisfies the other by construction.
  const l = lighter ? Math.max(...candidates) : Math.min(...candidates);
  return hsl(hue, sat, l);
}

/** `#rrggbb` to the `r, g, b` triple an rgba() needs. */
export function rgbOf(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return full.match(/../g).map((x) => parseInt(x, 16)).join(', ');
}

/**
 * The designed lightness if it is compliant, otherwise the nearest one that is.
 *
 * ── WHY `solveColorAgainst` ALONE PRODUCES MUD ────────────────────────────
 *
 * That function returns the LEAST extreme color that clears the requirement,
 * which is right for ink - a muted gray that just reaches 4.5:1 still reads as
 * muted - and wrong for a brand color. Solved that way, a yellow accent comes
 * back as dark olive: yellow clears 4.5:1 against a dark page while it is
 * still nearly brown, so "closest to the ground that passes" stops there. The
 * first render of the Sunrise theme was the proof; its accent was #a8840b.
 *
 * Contrast is a floor, not a design. So the design states the lightness it
 * wants, and this only moves it when the floor is not met - away from the
 * ground, in half-percent steps, stopping at the first compliant value.
 * Intent is preserved where it is legal and overridden where it is not, and
 * the palette test still measures the result either way.
 */
export function solveFromPreferred(hue, sat, preferred, grounds, target, options) {
  const lighter = options?.lighter ?? luminance(grounds[0]) < 0.18;
  const clears = (l) => grounds.every((g) => contrast(hsl(hue, sat, l), g) >= target);

  if (clears(preferred)) return hsl(hue, sat, preferred);

  for (let l = preferred; lighter ? l <= 100 : l >= 0; l += lighter ? 0.5 : -0.5) {
    if (clears(l)) return hsl(hue, sat, l);
  }
  // Unreachable at any lightness for this hue and saturation. Return the
  // extreme rather than a wrong-direction guess; the palette test measures
  // every pair and will name this rather than let it ship at 4.1:1.
  return hsl(hue, sat, lighter ? 100 : 0);
}

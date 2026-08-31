import {
  hsl,
  rgbOf,
  solveFromPreferred,
  contrast,
  AA_TEXT,
  AA_NON_TEXT,
} from './contrast.js';

/**
 * Theme packs: the palette the athlete picks, and the machine that builds it.
 *
 * ── THE PROBLEM WITH TEN THEMES ───────────────────────────────────────────
 *
 * Ten themes in light and dark is twenty palettes of twenty-odd tokens, which
 * is roughly four hundred color values. Every one of them has a readability
 * requirement attached: body text at 4.5:1 against both the page and a card,
 * the same for muted text and links, a form control's boundary at 3:1 against
 * its own fill. Picking four hundred values by eye and asserting afterwards is
 * how nine unreadable themes ship and a user finds out.
 *
 * So they are not picked. Each theme declares a handful of HUES, and the
 * palette is SOLVED from them - `solveColorAgainst` searches for the lightness
 * at which a color clears its requirement against every ground it will sit on.
 * A generated palette cannot be born failing, and adding a holiday theme later
 * is one line of hues rather than forty hand-checked colors.
 *
 * The palette test still measures all twenty. Generating them is not a reason
 * to stop checking them - the generator is code, and code has bugs. It is a
 * reason for the check to pass.
 *
 * ── EXCEPT MIAMI, WHICH IS DECLARED LITERALLY ─────────────────────────────
 *
 * The default theme is the existing brand, and the stylesheet argues for those
 * exact values at length - the trademark reasoning, the Mehta & Zhu finding
 * behind a warm primary action color, the fact that they are our own steps
 * rather than sampled from anything. Regenerating them from a hue would throw
 * that away and quietly change what the product looks like for everyone who
 * never opens the picker. So Miami is copied in verbatim and the other nine
 * are generated, and both shapes go through the identical validation.
 */

/** Every token a theme must define. A missing one is a test failure. */
export const THEME_TOKENS = [
  'bg', 'wash-cool', 'wash-cool-end', 'wash-warm', 'wash-warm-end',
  'surface', 'surface-2', 'border', 'field-border',
  'text', 'muted', 'accent', 'accent-text', 'accent-soft',
  'secondary', 'link', 'warning', 'error', 'chart-grid',
];

export const MODES = ['dark', 'light'];

/*
 * ── WHY CHART LINE AND MISSED-SET COLORS ARE NOT THEMED ───────────────────
 *
 * They are validated for something the brand colors are not: separation under
 * color-vision deficiency, at a measured ΔE, reinforced by differing SHAPE.
 * Re-deriving them per theme would put that work at the mercy of whichever hue
 * somebody picks for a holiday pack, and a chart that two of its readers
 * cannot decode is a worse outcome than a chart that is slightly off-palette.
 *
 * The grid IS themed - it is a neutral rule, and a dark grid on a light theme
 * is simply wrong.
 */
export const FIXED_CHART_COLORS = {
  dark: { 'chart-line': '#1aa5b0', 'chart-missed': '#cf7a18' },
  light: { 'chart-line': '#0093a0', 'chart-missed': '#a35c00' },
};

const MIAMI = {
  dark: {
    bg: '#0f0d1a',
    'wash-cool': 'rgba(34, 211, 211, 0.07)',
    'wash-cool-end': 'rgba(34, 211, 211, 0)',
    'wash-warm': 'rgba(255, 79, 154, 0.06)',
    'wash-warm-end': 'rgba(255, 79, 154, 0)',
    surface: '#1b1830',
    'surface-2': '#241f3d',
    border: '#2c2745',
    'field-border': '#7d78bb',
    text: '#f5f3f7',
    muted: '#a89ec4',
    accent: '#ff4f9a',
    'accent-text': '#12101f',
    'accent-soft': 'rgba(255, 79, 154, 0.14)',
    secondary: '#22d3d3',
    link: '#22d3d3',
    warning: '#ffb833',
    error: '#ff7a7a',
    'chart-grid': '#322c4f',
  },
  light: {
    bg: '#f3f3f8',
    'wash-cool': 'rgba(0, 147, 160, 0.09)',
    'wash-cool-end': 'rgba(0, 147, 160, 0)',
    'wash-warm': 'rgba(196, 24, 107, 0.07)',
    'wash-warm-end': 'rgba(196, 24, 107, 0)',
    surface: '#ffffff',
    'surface-2': '#eeeef4',
    border: '#dfdfe9',
    'field-border': '#84809a',
    text: '#1a1526',
    muted: '#5d5470',
    accent: '#c4186b',
    'accent-text': '#ffffff',
    'accent-soft': 'rgba(196, 24, 107, 0.10)',
    secondary: '#0093a0',
    link: '#00707c',
    warning: '#8a5a00',
    error: '#c62828',
    'chart-grid': '#e7dfe6',
  },
};

/**
 * Build one mode of a generated theme from its hues.
 *
 * The order matters: grounds first, because everything else is solved AGAINST
 * the grounds. Nothing here picks a lightness by hand except the surfaces
 * themselves, which are the one thing with no contrast requirement of their
 * own - they are what the requirements are measured against.
 */
/*
 * ── THE LIGHTNESS A DESIGNER WOULD PICK, PER MODE ─────────────────────────
 *
 * Stated as intent and then enforced as a floor, rather than solved for the
 * minimum. Solving for the minimum is correct for ink and wrong for a brand
 * color - it returns the least extreme value that passes, so a yellow accent
 * comes back as dark olive because yellow clears 4.5:1 while it is still
 * nearly brown. These are the values the palette WANTS; solveFromPreferred
 * moves one only when it does not clear its requirement.
 */
const LADDER = {
  dark: { text: 92, muted: 62, accent: 58, secondary: 56, warning: 60, error: 62, field: 46 },
  light: { text: 18, muted: 38, accent: 42, secondary: 36, warning: 34, error: 44, field: 52 },
};

/**
 * Build one mode of a generated theme from its hues.
 *
 * Grounds first, because everything else is measured against them. The
 * surfaces are the only values chosen outright - they are what the
 * requirements are measured against, so they have none of their own.
 */
function generate(seed, mode) {
  const dark = mode === 'dark';
  const L = LADDER[mode];
  const { hue, secondaryHue, neutralHue: nH, neutralSat: nS } = seed;
  const accentSat = seed.accentSat ?? (dark ? 88 : 78);
  const accentL = seed.accentL?.[mode] ?? L.accent;

  /*
   * Neutral saturation is a CEILING for every neutral, not just the grounds.
   * The first draft fixed the ink saturations at 10/20/28 regardless, so the
   * Mono theme - neutralSat 0, the whole point of it - came out with pink-gray
   * muted text and a red field border. The contrast math had no opinion about
   * that, because a tinted gray is exactly as readable as a neutral one. Only
   * looking at it caught it.
   */
  const bg = dark ? hsl(nH, nS, 7.5) : hsl(nH, Math.min(nS, 22) * 0.45, 96);
  const surface = dark ? hsl(nH, nS * 0.85, 13) : '#ffffff';
  const surface2 = dark ? hsl(nH, nS * 0.8, 18) : hsl(nH, nS * 0.3, 93.5);
  const border = dark ? hsl(nH, nS * 0.75, 22) : hsl(nH, nS * 0.28, 88);
  const grounds = [bg, surface];
  const lighter = dark;

  const from = (h, sat, preferred, target = AA_TEXT) =>
    solveFromPreferred(h, sat, preferred, grounds, target, { lighter });

  const accent = from(hue, accentSat, accentL);
  /*
   * Black or white on the button, whichever the button can actually carry -
   * measured, not assumed. A gold accent needs dark ink and a navy one needs
   * light ink, and guessing wrong fails the one requirement that is about a
   * control somebody has to read before pressing it.
   */
  const accentText = [hsl(nH, seed.accentSat === 0 ? 0 : 25, 8), '#ffffff'].reduce((best, ink) =>
    contrast(ink, accent) > contrast(best, accent) ? ink : best
  );

  const secondary = from(secondaryHue, seed.secondarySat ?? (dark ? 72 : 68), L.secondary);

  return {
    bg,
    /*
     * Alpha at or below 0.1, for the reason the base stylesheet gives: a
     * gradient has no single color, so the only honest guarantee is that the
     * wash is too faint to move a contrast ratio underneath it.
     */
    'wash-cool': `rgba(${rgbOf(secondary)}, ${dark ? 0.07 : 0.09})`,
    'wash-cool-end': `rgba(${rgbOf(secondary)}, 0)`,
    'wash-warm': `rgba(${rgbOf(accent)}, ${dark ? 0.06 : 0.07})`,
    'wash-warm-end': `rgba(${rgbOf(accent)}, 0)`,
    surface,
    'surface-2': surface2,
    border,
    // A control boundary is a meaningful UI boundary, not decoration: 3:1
    // against the fill it encloses, which is surface-2 for a text field.
    'field-border': solveFromPreferred(nH, Math.min(nS, dark ? 28 : 14), L.field, [surface2], AA_NON_TEXT, {
      lighter,
    }),
    text: from(nH, Math.min(nS, dark ? 10 : 20), L.text, 12),
    muted: from(nH, Math.min(nS, dark ? 20 : 22), L.muted),
    accent,
    'accent-text': accentText,
    'accent-soft': `rgba(${rgbOf(accent)}, ${dark ? 0.14 : 0.1})`,
    secondary,
    link: secondary,
    warning: from(42, dark ? 92 : 88, L.warning),
    error: from(2, dark ? 82 : 74, L.error),
    'chart-grid': border,
  };
}

/**
 * The catalog. `id` is what is stored in the database and must never change;
 * the display name is an i18n key, so a theme can be renamed without a
 * migration and translated without a second catalog.
 *
 * Adding a holiday pack is one entry here plus two i18n strings. The palette
 * test picks it up automatically and will refuse it if it is unreadable,
 * which is the point of building them this way.
 */
export const THEMES = [
  { id: 'miami', tokens: MIAMI, isDefault: true },
  { id: 'blush', seed: { hue: 336, secondaryHue: 288, neutralHue: 330, neutralSat: 18 } },
  { id: 'cobalt', seed: { hue: 214, secondaryHue: 190, neutralHue: 220, neutralSat: 24 } },
  { id: 'ember', seed: { hue: 8, secondaryHue: 32, neutralHue: 12, neutralSat: 20 } },
  { id: 'moss', seed: { hue: 142, secondaryHue: 96, neutralHue: 150, neutralSat: 16 } },
  { id: 'amethyst', seed: { hue: 276, secondaryHue: 310, neutralHue: 272, neutralSat: 22 } },
  { id: 'copper', seed: { hue: 24, secondaryHue: 44, neutralHue: 28, neutralSat: 18 } },
  { id: 'slate', seed: { hue: 205, secondaryHue: 178, neutralHue: 214, neutralSat: 8 } },
  /*
   * Mono is the one theme whose accent is deliberately not a hue. Zero
   * saturation everywhere, and an accent at the far end of the lightness
   * range rather than the middle, so the primary button reads as a
   * deliberate black-on-white choice instead of a disabled gray. The first
   * draft left it at the default saturation and shipped a theme called Mono
   * that was bright red - which the contrast math had no opinion about, and
   * a render caught in a second.
   */
  {
    id: 'mono',
    seed: {
      hue: 0,
      secondaryHue: 0,
      neutralHue: 0,
      neutralSat: 0,
      accentSat: 0,
      secondarySat: 0,
      accentL: { dark: 90, light: 20 },
    },
  },
  { id: 'sunrise', seed: { hue: 46, secondaryHue: 14, neutralHue: 36, neutralSat: 14 } },
];

export const DEFAULT_THEME_ID = THEMES.find((t) => t.isDefault).id;
export const THEME_IDS = THEMES.map((t) => t.id);

/** Is this a theme we ship? Anything else is not a theme, it is user input. */
export function isThemeId(value) {
  return typeof value === 'string' && THEME_IDS.includes(value);
}

/**
 * The tokens for one theme in one mode.
 *
 * Falls back to the default theme rather than throwing. A stored id that this
 * build does not know about - a holiday theme retired between deploys, a row
 * written by a newer version - is a reason to show somebody the default, not
 * a reason for a blank page.
 */
export function tokensFor(themeId, mode) {
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES.find((t) => t.isDefault);
  const resolvedMode = MODES.includes(mode) ? mode : 'dark';
  const palette = theme.tokens
    ? theme.tokens[resolvedMode]
    : generate(theme.seed, resolvedMode);
  return { ...palette, ...FIXED_CHART_COLORS[resolvedMode] };
}

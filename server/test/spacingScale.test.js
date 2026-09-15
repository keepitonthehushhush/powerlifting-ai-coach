import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';

/**
 * ── 212 SPACING LITERALS, 32 DISTINCT VALUES, 44 TOKEN USES ───────────────
 *
 * Measured on 2026-09-14. The scale existed - --space-1 through --space-8 -
 * and the app reached for it 17% of the time, because it jumped 4 -> 8 -> 16
 * and the biggest clusters sat in the holes: 9.6px (x16), 11.2px (x17),
 * 6.4px (x14), 14.4px (x12).
 *
 * The number in the token name is now how many 4px units it is, so the name
 * states the value. 8 is the base because it divides cleanly at 1.5x, 2x and
 * 3x - scaling an odd base lands on a half pixel, and a half pixel is a
 * blurred edge - and 4 is the half step because an 8-only ladder is too
 * coarse under 16px, which is where a badge inset and a label-to-field gap
 * both live. USWDS ships that exact shape for that exact reason.
 *
 * ── AND THE RULE A SCALE ALONE CANNOT ENFORCE ─────────────────────────────
 *
 * Nielsen Norman: "Proximity is one of the most important grouping principles
 * and can overpower competing visual cues such as similarity of color or
 * shape."
 *
 * Which means snapping every gap to a tidy number can make a screen WORSE. If
 * the gap inside a group and the gap between groups both land on 8px, the
 * layout has been tidied into saying nothing. That happened here: the day
 * card's title sat 8px from its own movement count and the count sat 8px from
 * the warm-up heading below it, so the count belonged to neither.
 *
 * The rule is therefore relational, and the tests below assert relationships
 * rather than values.
 */
const css = readSource(new URL('../../web/src/styles.css', import.meta.url));
const raw = readRaw(new URL('../../web/src/styles.css', import.meta.url));

const SPACING_PROPS =
  'padding|padding-top|padding-right|padding-bottom|padding-left|padding-block|padding-inline|' +
  'margin|margin-top|margin-right|margin-bottom|margin-left|margin-block|margin-inline|gap|row-gap|column-gap';

/** Spacing declarations outside :root that still carry a raw length. */
function literals() {
  const rootAt = css.indexOf(':root {');
  const rootEnd = css.indexOf('\n}', rootAt);
  const body = css.slice(0, rootAt) + css.slice(rootEnd);
  const out = [];
  for (const m of body.matchAll(new RegExp(`(?<![-a-z])(${SPACING_PROPS})\\s*:\\s*([^;{}]+);`, 'g'))) {
    if (/\d+(\.\d+)?(rem|px)/.test(m[2])) out.push(`${m[1]}: ${m[2].trim()}`);
  }
  return out;
}

describe('spacing comes off one scale', () => {
  test('the scale is declared, and the number is the multiple of 4px', () => {
    for (const [token, rem, px] of [
      ['--space-0-5', '0.125rem', 2], ['--space-1', '0.25rem', 4], ['--space-2', '0.5rem', 8],
      ['--space-3', '0.75rem', 12], ['--space-4', '1rem', 16], ['--space-5', '1.25rem', 20],
      ['--space-6', '1.5rem', 24], ['--space-8', '2rem', 32], ['--space-12', '3rem', 48],
      ['--space-16', '4rem', 64], ['--space-24', '6rem', 96],
    ]) {
      assert.match(css, new RegExp(`${token}: ${rem.replace('.', '\\.')};`), `${token} is missing or off its size`);
      const n = Number(token.replace('--space-', '').replace('-5', '.5'));
      assert.equal(n * 4, px, `${token} does not name its own value`);
    }
  });

  test('every length in the scale is a whole number of pixels at the default root size', () => {
    /*
     * The reason for an even base: an odd one lands on a half pixel when the
     * device scales it, and a half pixel is a blurred edge rather than a line.
     * A rem value that is not a whole pixel at 16px root has the same problem
     * before scaling even starts.
     */
    for (const m of css.matchAll(/--space-[\w-]+: ([\d.]+)rem;/g)) {
      const px = Number(m[1]) * 16;
      assert.equal(px, Math.round(px), `${m[0]} is ${px}px - not a whole pixel`);
    }
  });

  test('almost nothing bypasses it', () => {
    /*
     * Two survivors, both because they are not fixed lengths at all: a margin
     * that is partly `auto`, and the page gutter, which is a clamp() that has
     * to stay fluid. Asserted as a ceiling rather than zero, and a low one -
     * 212 is what this looked like before.
     */
    /*
     * A CEILING of four was the first version of this, and a mutant that put
     * `gap: 0.9rem` back into `.stack` slipped under it - the guard counted
     * room to spare rather than the two things it meant to allow. Named
     * exactly, like the type scale's exception list, so a third literal fails
     * and removing one of these fails too.
     */
    const ALLOWED = [
      // The page gutter, which has to stay fluid.
      'padding-inline: clamp(0.85rem, 4vw, 1.25rem)',
      // The two screen-reader clip margins. See the test below for why a 1px
      // value on a 1px box is not on the spacing scale.
      'margin: -1px',
      'margin: -1px',
    ];
    assert.deepEqual(literals().sort(), [...ALLOWED].sort());
    const uses = (css.match(/var\(--space-/g) ?? []).length;
    assert.ok(uses >= 250, `only ${uses} declarations take a spacing token`);
  });

  test('no value is negated by putting a minus in front of var()', () => {
    /*
     * `margin: -var(--space-0-5)` is not valid CSS. A function cannot be
     * negated by prefixing a minus; the declaration is dropped ENTIRELY and
     * silently, which is the worst way for a style to fail. The correct form
     * is calc(var(--x) * -1).
     *
     * The snap that introduced the spacing scale wrote two of these, both on
     * `.visually-hidden` - so the screen-reader-only clip lost its margin and
     * nothing anywhere reported it. Not the browser, not the test suite, and
     * not the computed-style baseline, because `.visually-hidden` is not one
     * of its watched selectors.
     */
    assert.doesNotMatch(css, /-var\(/, 'a var() is being negated with a minus prefix');
  });

  test('the two 1px clip margins stay 1px, because they are not spacing', () => {
    /*
     * -1px on a 1px-square absolutely positioned box is half of the standard
     * screen-reader-only clip. Snapping it to the nearest step would put a
     * layout-rhythm token inside a hack that has nothing to do with rhythm,
     * and it would change a 1px value by 1px.
     */
    const hidden = css.match(/\.visually-hidden \{[^}]*\}/g) ?? [];
    assert.ok(hidden.length >= 1, '.visually-hidden has gone');
    for (const rule of hidden) {
      if (/margin:/.test(rule)) assert.match(rule, /margin: -1px/, 'the clip margin has been snapped to the scale');
    }
  });

  test('the proximity rule is written down where somebody will read it', () => {
    /*
     * A scale tells you which numbers are allowed. It cannot tell you that the
     * gap between two groups must be visibly larger than the gap inside one,
     * and that is the rule that decides whether a screen reads as designed.
     * readRaw, because the reasoning is a comment.
     */
    assert.match(raw, /Proximity is one of the most important grouping/);
    assert.match(raw, /must be visibly larger than/);
  });

  test('and the day card obeys it, since that is where it was broken', () => {
    /*
     * The title and its movement count are one unit and take the 4px step.
     * What follows them is a different section and takes 24px. The warm-up
     * block overrides `.stack`'s 16px rather than adding a margin to it,
     * because a margin would have stacked to exactly the 24px that separates
     * the block from its neighbours - within must not equal between.
     */
    const head = css.slice(css.indexOf('.day-head {'), css.indexOf('}', css.indexOf('.day-head {')));
    assert.match(head, /gap: var\(--space-1\)/, 'the day title and its count have drifted apart');
    assert.match(head, /margin-bottom: var\(--space-6\)/, 'the count no longer separates from what follows');

    const ramp = css.slice(css.indexOf('.warmup-ramp {'), css.indexOf('}', css.indexOf('.warmup-ramp {')));
    assert.match(ramp, /gap: var\(--space-2\)/, 'the ramp heading has drifted from its own line');
    assert.doesNotMatch(css, /\.warmup-ramp h3 \{ margin-bottom/, 'a margin is stacking with the gap again');
  });
});

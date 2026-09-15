import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';

/**
 * ── THE SCALE EXISTED AND THE APP DID NOT REACH FOR IT ────────────────────
 *
 * Measured across the whole stylesheet on 2026-09-14: 64 hardcoded
 * `font-size` declarations against 15 that used a token. 23 distinct values.
 *
 * The cause was not carelessness. 84% of those 64 landed within 0.75px of a
 * rung on Apple's Dynamic Type ladder - which is the ladder this scale was
 * drawn from - and 87% sat between 11px and 16.5px, a band that had exactly
 * ONE rung in it. People were reaching for steps that did not exist and
 * writing the number they wanted instead. `0.85rem` twelve times, `0.9rem`
 * twelve times, `0.92rem`, `0.88rem`, `0.82rem`, `0.78rem`, `0.72rem`,
 * `0.68rem` repeatedly.
 *
 * This is the same fault docs/DESIGN_REVIEW_2026-09-09.md found one octave up
 * - nothing between 32px and 17px - and fixed by adding --text-title-3.
 *
 * What this file guards is the state AFTER: the rungs exist, the literals are
 * gone, and the handful that remain are there for stated reasons rather than
 * because nobody got to them.
 */
const css = readSource(new URL('../../web/src/styles.css', import.meta.url));
const raw = readRaw(new URL('../../web/src/styles.css', import.meta.url));

/**
 * ── THE EXCEPTIONS, NAMED RATHER THAN THE RULE WEAKENED ───────────────────
 *
 * Ten declarations do not take a token, and every one of them has a reason
 * that is about the thing being sized rather than about effort:
 *
 *   max(1rem, 16px)  iOS zooms the viewport when a focused field is under
 *                    16px. This is the fix for that, and it is already
 *                    documented in the stylesheet beside the rule.
 *   0.85em / 0.88em  Deliberately RELATIVE: a printed-link suffix and an
 *                    inline code span should track the text they sit inside,
 *                    which is the one job `em` is right for.
 *   10px             An SVG chart axis label inside a scaled viewBox. It is
 *                    not 10px on screen and it is not on the text ladder.
 *   1.5rem / 1.15rem A page title, an easter-egg title, a brand lockup and two
 *   1.45rem          MFA code boxes. These are the DISPLAY end, which the
 *                    09-09 review already worked on, and the code boxes are
 *                    sized for their box rather than for reading. Left for a
 *                    commit of their own - `h1` at 24px and `.page-title` at
 *                    23.2px are two hand-picked values doing one job and that
 *                    deserves its own look, not a drive-by.
 *
 * The list is asserted EXACTLY. A new literal fails, and deleting one of these
 * fails too rather than rotting quietly.
 */
const ALLOWED_LITERALS = [
  '1.5rem',        // h1
  '1.15rem',       // .brand.small
  '10px',          // .chart-axis-label, inside an SVG viewBox
  '1.45rem',       // .page-title
  '1.5rem',        // .egg-title
  '0.85em',        // .prose a[href^="/"]::after - relative on purpose
  '0.88em',        // .coach-copy code - relative on purpose
  '0.88em',        // .not-found-path code - the SAME value, deliberately
  '1.5rem',        // .code-input-field
  '1.5rem',        // .code-box
  'max(1rem, 16px)', // the iOS focus-zoom floor
];

function literalFontSizes() {
  const out = [];
  for (const line of css.split('\n')) {
    const m = /(?<![-a-z])font-size\s*:\s*([^;]+);/.exec(line);
    if (m && !m[1].includes('var(--text')) out.push(m[1].trim());
  }
  return out;
}

describe('the type scale is the thing the app reaches for', () => {
  test('every rung Apple names between 11 and 17 exists here', () => {
    /*
     * Values, not just presence. A rung declared at the wrong size is worse
     * than a missing one, because everything that takes it is then wrong and
     * looks deliberate.
     */
    for (const [token, rem] of [
      ['--text-callout', '1rem'],
      ['--text-subheadline', '0.9375rem'],
      ['--text-footnote', '0.8125rem'],
      ['--text-caption-1', '0.75rem'],
      ['--text-caption-2', '0.6875rem'],
    ]) {
      assert.match(css, new RegExp(`${token}: ${rem.replace('.', '\\.')};`), `${token} is missing or off its size`);
    }
  });

  test('the ladder is declared in descending order, with no gap left in the middle', () => {
    const order = [
      '--text-large-title', '--text-title', '--text-title-3', '--text-headline',
      '--text-body', '--text-callout', '--text-subheadline', '--text-footnote',
      '--text-caption-1', '--text-caption-2',
    ];
    let previous = -1;
    for (const name of order) {
      const at = css.indexOf(`${name}:`);
      assert.ok(at > previous, `${name} is out of order in the scale`);
      previous = at;
    }
  });

  test('the old name is gone, not aliased', () => {
    /*
     * 13pt is Apple's FOOTNOTE; its caption1 is 12 and caption2 is 11. Keeping
     * --text-caption alongside --text-footnote would leave two names for one
     * value and the wrong one is the one that reads like "small text".
     */
    assert.doesNotMatch(css, /--text-caption:/, '--text-caption still exists');
    assert.doesNotMatch(css, /var\(--text-caption\)/, 'something still takes the old name');
  });

  test('no literal font-size survives except the ones named here', () => {
    assert.deepEqual(literalFontSizes().sort(), [...ALLOWED_LITERALS].sort());
  });

  test('and the app actually uses the scale, rather than merely declaring it', () => {
    /*
     * The measurement that started this: 15 token uses against 64 literals.
     * Asserting a FLOOR rather than an exact count, because the number should
     * be free to grow - what must never happen again is the scale being
     * present and unused.
     */
    const uses = (css.match(/font-size: var\(--text-/g) ?? []).length;
    assert.ok(uses >= 60, `only ${uses} rules take a type token; the scale is decorative again`);
    assert.ok(uses > literalFontSizes().length * 5, 'literals are catching up with the scale');
  });

  test('the small rungs are documented as label sizes, not body sizes', () => {
    /*
     * WCAG sets no minimum font size - Section508.gov says so in as many words
     * - and the practical guidance is 15-16px for body, with running text
     * below about 9pt named as a barrier. caption-1 and caption-2 exist for
     * badges and table headers. The reasoning has to live next to the tokens,
     * because the next person to need "something small" will read this block
     * and not this test.
     *
     * readRaw: the rule is stated in a comment, and readSource strips those.
     */
    assert.match(raw, /NOT running text/);
    assert.match(raw, /Body stays at 17px/);
  });
});

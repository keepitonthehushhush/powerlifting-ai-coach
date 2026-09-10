import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { readSource, readRaw, flatten } from './helpers/source.js';

const css = readRaw(new URL('../../web/src/styles.css', import.meta.url));
const chart = readSource(new URL('../../web/src/components/LiftChart.jsx', import.meta.url));
const program = readSource(new URL('../../web/src/pages/Program.jsx', import.meta.url));

/*
 * Four screenshots from a phone on 2026-09-10, and three separate faults in
 * them - all the same shape underneath. This product is used on a phone, and
 * parts of it were written as though a mouse were present.
 */
describe('a tap is not a hover', () => {
  test('no :hover rule is left unguarded', () => {
    /*
     * On iOS a tap applies :hover and LEAVES IT APPLIED until something else
     * is tapped, so an unguarded hover style is a highlight stuck to whatever
     * the finger last touched.
     *
     * The nav is where it did damage. `.nav-item.active` marks the current
     * page with a 2px bar, and the comment beside it argues for exactly that -
     * "it marks the page without competing". `.nav-item:hover` fills a pill.
     * So the louder mark sat on the last-tapped item and the quieter one on
     * the page you were actually looking at.
     */
    const lines = css.split('\n');
    const unguarded = [];
    let depth = 0;
    let hoverMediaDepth = null;
    for (const raw of lines) {
      const line = raw.replace(/\/\*.*?\*\//g, '');
      if (/@media[^{]*\(hover:\s*hover\)/.test(line) && hoverMediaDepth === null) hoverMediaDepth = depth;
      if (/:hover/.test(line) && /\{/.test(line) === false && /:hover/.test(line)) {
        // selector-only line; handled with the brace line below
      }
      if (/:hover/.test(line) && hoverMediaDepth === null && !line.trimStart().startsWith('*')) {
        unguarded.push(line.trim());
      }
      depth += (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      depth -= closes;
      if (hoverMediaDepth !== null && depth <= hoverMediaDepth) hoverMediaDepth = null;
    }
    assert.deepEqual(unguarded, [], `these :hover rules fire on a phone and stick:\n  ${unguarded.join('\n  ')}`);
  });

  test('and focus styling is deliberately NOT guarded', () => {
    // :focus-visible already fires only when the browser judges a ring is
    // wanted. Hiding it from touch devices would take it from a touch user who
    // plugged in a keyboard.
    assert.match(css, /:focus-visible/);
    const guarded = css.slice(css.indexOf('@media (hover: hover)'));
    assert.doesNotMatch(guarded.slice(0, 400), /focus-visible/);
  });
});

describe('the chart can be read without a mouse', () => {
  test('it answers to a finger', () => {
    /*
     * It had onMouseMove and nothing else, so the readout under it was
     * unreachable on every phone and tablet - while the caption told those
     * users to hover. pointerdown is the one that makes a TAP work: on touch,
     * pointermove only fires once a drag is already underway.
     */
    assert.match(chart, /onPointerDown=\{pick\}/);
    assert.match(chart, /onPointerMove=\{pick\}/);
    assert.doesNotMatch(chart, /onMouseMove/, 'mouse-only handling is back');
  });

  test('it answers to a keyboard, and says so', () => {
    // WCAG 2.1.1: information available on hover has to be available another
    // way. The readout is already aria-live, so it announces on its own once
    // there is a way to drive it.
    assert.match(chart, /tabIndex=\{0\}/);
    assert.match(chart, /onKeyDown=\{onKeyDown\}/);
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Escape']) {
      assert.match(chart, new RegExp(`'${key}'`), `the chart ignores ${key}`);
    }
    assert.match(chart, /aria-live="polite"/);
  });

  test('it does not swallow keys it has no use for', () => {
    // preventDefault must come AFTER the key is known to be one of ours, or
    // the page stops scrolling whenever the chart has focus.
    const handler = chart.slice(chart.indexOf('function onKeyDown'), chart.indexOf('return (\n    <figure'));
    /*
     * BOTH have to be PRESENT before their order means anything. The first
     * version of this compared indexOf values directly, so deleting the guard
     * left indexOf returning -1 - which is less than every real index, and the
     * assertion passed on the exact code it exists to forbid. A mutant found
     * it; the -1 is the same shape as an absence satisfying a presence check,
     * one more disguise for the defect this suite keeps meeting.
     */
    const guard = handler.indexOf('else return;');
    const prevent = handler.indexOf('event.preventDefault()');
    assert.ok(guard >= 0, 'the unrecognized-key guard is gone, so every key is swallowed');
    assert.ok(prevent >= 0, 'preventDefault is gone, so the arrow keys scroll the page as well');
    assert.ok(guard < prevent, 'preventDefault runs before the key is recognized');
  });

  test('a tap does not cost the page its scroll', () => {
    // pan-y: dragging along the chart scrubs, dragging up the page scrolls.
    assert.match(css, /\.chart-svg \{ touch-action: pan-y; \}/);
    assert.match(css, /\.chart-svg:focus-visible/);
  });
});

describe('the hint matches the device reading it', () => {
  test('both sentences exist, in both languages', () => {
    for (const locale of ['en', 'es']) {
      const strings = readSource(new URL(`../../web/src/i18n/locales/${locale}.js`, import.meta.url));
      assert.match(strings, /hoverHint:/, `${locale} lost the pointer hint`);
      assert.match(strings, /tapHint:/, `${locale} has no touch hint`);
    }
  });

  test('CSS chooses, not a matchMedia read at mount', () => {
    /*
     * An iPad that gains a trackpad, or a laptop with a touchscreen, changes
     * the answer without a re-render - and neither should need this component
     * to notice.
     */
    assert.match(chart, /hint-pointer/);
    assert.match(chart, /hint-touch/);
    assert.doesNotMatch(chart, /matchMedia/);
    assert.match(css, /@media \(hover: none\) \{[\s\S]{0,200}\.hint-touch \{ display: inline; \}/);
  });

  test('the English pointer hint mentions the keyboard, since there now is one', () => {
    const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
    assert.match(flatten(en), /Hover a point for the details, or use the arrow keys/);
  });
});

describe('a prescription does not become a column of fragments', () => {
  test('the program table scrolls in its own box', () => {
    /*
     * Five columns on a 390px phone squeezed instead of scrolling, and the
     * weight column - a load AND its plate breakdown - wrapped to four lines
     * per row. This is what somebody reads at arm's length between sets.
     */
    assert.match(program, /className="program-table-scroll"/);
    assert.match(css, /\.program-table-scroll \{ overflow-x: auto; \}/);
    assert.match(css, /\.program-table \{ min-width:/);
  });

  test('and the plate words stay on one line', () => {
    // Wrapping again inside a scroller keeps the fault and adds a scrollbar.
    assert.match(css, /\.program-table \.plate-words \{ white-space: nowrap; \}/);
    // The class is the one the markup actually uses, not one invented here.
    assert.match(program, /plate-words/);
  });
});

describe('a check that cries wolf is a check nobody reads', () => {
  const checker = readSource(new URL('../../scripts/check-computed-styles.mjs', import.meta.url));

  test('computed numbers compare with a tolerance, not as strings', () => {
    /*
     * On 2026-09-10 this check reported twelve changes nobody had made - every
     * one an --elev-* token resolved through color-mix(in oklab, ...),
     * differing in the fifth or sixth decimal place, because Chrome had
     * updated. Proven not to be ours by stashing the tree and re-running on a
     * clean checkout, where the same twelve appeared.
     *
     * The danger was never the false alarm. The documented response to this
     * check failing is `-- --update`, so a check that fails on every browser
     * update trains whoever runs it to re-record without reading - and the
     * next real change goes in under the same keystroke.
     */
    assert.match(checker, /sameValue\(a, b\)/);
    assert.match(checker, /NUMERIC_TOLERANCE = 1e-4/);
    assert.doesNotMatch(checker, /if \(a !== b\) problems\.push/, 'back to comparing computed values as strings');
  });

  test('the tolerance is smaller than anything a screen can show', () => {
    // A color channel would have to move ten thousand steps further to shift
    // one 8-bit value. This is the assertion that stops the tolerance being
    // widened later to silence a real difference.
    const tolerance = Number(checker.match(/NUMERIC_TOLERANCE = ([0-9e.-]+)/)?.[1]);
    assert.ok(Number.isFinite(tolerance), 'the tolerance is not a number');
    assert.ok(tolerance <= 1e-4, `${tolerance} is loose enough to hide a real change`);
  });

  test('and a difference in shape is still a difference', () => {
    // Only the NUMBERS are forgiven. `0px 1px 2px` and `0px 1px 2px 0px` are
    // different shadows, and `bold` and `normal` are different weights.
    assert.match(checker, /a\.replace\(NUMBER, '#'\) !== b\.replace\(NUMBER, '#'\)/);
    assert.match(checker, /left\.length !== right\.length/);
  });
});

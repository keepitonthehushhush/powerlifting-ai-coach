import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { readSource, readRaw } from './helpers/source.js';

const css = readRaw(new URL('../../web/src/styles.css', import.meta.url));
const header = readSource(new URL('../../web/src/components/StickyHeader.jsx', import.meta.url));
const banner = readSource(new URL('../../web/src/components/NewVersionBanner.jsx', import.meta.url));

/*
 * scroll-padding-top was `auto`, and auto means "flush to the top of the
 * viewport" - which is exactly where .sticky-header is. Measured on the
 * deployed site before the fix: getComputedStyle(document.documentElement)
 * .scrollPaddingTop === 'auto'.
 *
 * Then measured both ways in a browser against the real built stylesheet, with
 * a header 131px tall: focusing an off-screen link put it at top: 0 under a
 * header whose bottom edge was 131 - covered completely - and with the rule in
 * place scroll-padding-top computed to 139px and the link cleared it.
 */
describe('the browser is told how much of the top is spoken for', () => {
  test('the scroll container reserves the header and the banner', () => {
    assert.match(css, /scroll-padding-top: calc\(/);
    const rule = css.slice(css.indexOf('scroll-padding-top: calc('), css.indexOf(');', css.indexOf('scroll-padding-top: calc(')));
    assert.match(rule, /var\(--banner-height, 0px\)/, 'the version banner is not accounted for');
    assert.match(rule, /var\(--sticky-header-height, 0px\)/, 'the header is not accounted for');
    // Off the scale like everything else, and a fallback of 0 so a page with
    // neither resolves to a small breathing space rather than a mystery gap.
    assert.match(rule, /var\(--space-2\)/);
  });

  test('it is on the scroll container, not on the header', () => {
    // scroll-padding applies to the scrollport. Putting it on .sticky-header
    // would parse, do nothing, and look correct in a diff.
    const block = css.slice(css.indexOf(':root {', css.indexOf('HOW MUCH OF THE TOP IS ALREADY SPOKEN FOR')));
    assert.match(block.slice(0, 200), /scroll-padding-top/);
  });
});

describe('the height is measured, not assumed', () => {
  test('the header publishes its own height', () => {
    /*
     * Hardcoding it would be wrong four ways: the header condenses on scroll,
     * wraps on a phone, is taller in Spanish, and grows with the reader's font
     * size. NewVersionBanner already measures itself for the same reasons and
     * this follows that pattern deliberately.
     */
    assert.match(header, /setProperty\('--sticky-header-height', `\$\{height\}px`\)/);
    assert.match(header, /new ResizeObserver\(publish\)/);
    assert.match(banner, /setProperty\('--banner-height'/, 'the pattern being followed has gone');
  });

  test('and stops reserving space when it leaves', () => {
    // A page with no sticky header must not inherit a reservation for one.
    assert.match(header, /removeProperty\('--sticky-header-height'\)/);
    assert.match(header, /observer\.disconnect\(\)/);
  });

  test('it does not write on every frame', () => {
    // This measurement lives beside a scroll-driven one, and writing a custom
    // property invalidates style. Only a real change is published.
    assert.match(header, /if \(height === published\) return;/);
  });
});

describe('the local workarounds this replaces', () => {
  test('the two block:center scrolls still exist and are now belt and braces', () => {
    /*
     * ErrorSummary and Intake's deep link both centered their target and both
     * said why - "so the sticky header cannot cover it". They were correct and
     * they only ever covered the scrolls WE perform. The ones the browser
     * performs on its own - anchors, find-in-page, keyboard focus - had
     * nothing, and those are most of them.
     */
    const summary = readSource(new URL('../../web/src/components/ErrorSummary.jsx', import.meta.url));
    const intake = readSource(new URL('../../web/src/pages/Intake.jsx', import.meta.url));
    /*
     * Counted, not merely matched. ErrorSummary centers TWICE - the summary
     * itself and the field it points at - and a `match` was satisfied by the
     * second one while a mutant changed the first. "At least one of them is
     * still right" is not what this is trying to say.
     *
     * And what it says now is weaker on purpose: with scroll-padding in place
     * `block: 'start'` would no longer hide anything, so these are a UX
     * preference rather than a workaround. Worth changing deliberately, not
     * worth defending as a safety property.
     */
    assert.equal((summary.match(/block: 'center'/g) ?? []).length, 2);
    assert.equal((intake.match(/block: 'center'/g) ?? []).length, 1);
  });
});

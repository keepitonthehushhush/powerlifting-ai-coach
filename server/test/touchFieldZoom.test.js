import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './helpers/source.js';

/**
 * No form control may be small enough to make iOS magnify the page.
 *
 * ── THE BUG ───────────────────────────────────────────────────────────────
 *
 * Reported as "certain pages are zoomed in a bit ... odd when viewing a new
 * page for the day". iOS Safari zooms the page when a text field takes focus
 * and that field computes to under 16px, and it does NOT zoom back out. One
 * tap on the email field magnifies every page visited afterwards in that tab.
 *
 * Measured on the live site at 375px: email 14.4px, password 14.4px, the
 * language select 13.6px. The first two inherit from `label`, which is 0.9rem
 * by design.
 *
 * ── WHY THIS IS A PARSER AND NOT A REGEX ──────────────────────────────────
 *
 * A regex cannot reliably find a CSS rule - it has already reported a defect
 * that was not there in this repository, by matching a grouped selector
 * instead of the rule underneath it. So the stylesheet is walked with brace
 * matching, at-rule blocks and all, and each declaration block is attributed
 * to the selector that actually owns it.
 */

/*
 * Comments are stripped BEFORE parsing, and the first draft of this test is
 * why. A CSS comment sits between the previous rule's `}` and the next
 * selector, so it lands inside the prelude - and this stylesheet comments
 * heavily on purpose. The `@media (pointer: coarse)` block came back with a
 * forty-line explanation glued to the front of it and failed
 * `prelude.startsWith('@')`, and `.lang select` came back carrying the banner
 * above it. The test reported a bug that was not there, twice, in the same
 * run - which is precisely the failure mode the helpers file was written for.
 */
const CSS = stripComments(
  readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8')
);
const ROOT_PX = 16;

/** Every `selector { ... }` in the file, with the at-rules it sits inside. */
function rules(css) {
  const found = [];
  const walk = (text, context) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) return;
      const prelude = text.slice(i, open).split(/[;}]/).pop().trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') depth -= 1;
        j += 1;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@')) walk(body, [...context, prelude]);
      else found.push({ selector: prelude, body, context });
      i = j;
    }
  };
  walk(css, []);
  return found;
}

/** The declared font-size in px, or null when the rule sets none. */
function fontSizePx(body) {
  const match = body.match(/(?:^|[;{\s])font-size\s*:\s*([^;]+)/);
  if (!match) return null;
  const value = match[1].trim();
  if (value.startsWith('max(')) return Infinity; // a floor, by construction
  const rem = value.match(/^([\d.]+)rem$/);
  if (rem) return parseFloat(rem[1]) * ROOT_PX;
  const px = value.match(/^([\d.]+)px$/);
  if (px) return parseFloat(px[1]);
  return null; // inherit, a keyword, a var() - not a literal to judge
}

const TOUCH_QUERY = '@media (pointer: coarse)';
const CONTROL = /(^|[\s,>+~])(input|textarea|select)\b/;

describe('a form control never triggers the iOS focus zoom', () => {
  const all = rules(CSS);

  test('the stylesheet parses into something real', () => {
    // The floor assertion. A parser that found nothing would pass every
    // assertion below it without reading a line.
    assert.ok(all.length > 200, `only ${all.length} rules parsed - the parser is broken`);
    assert.ok(
      all.some((r) => r.selector === 'label' && /font-size/.test(r.body)),
      'the label rule that causes the inheritance is missing, so this test is testing nothing'
    );
  });

  test('the touch floor exists and covers the controls', () => {
    const floor = all.filter((r) => r.context.some((c) => c.startsWith(TOUCH_QUERY)));
    assert.ok(floor.length > 0, 'there is no pointer: coarse block');
    const covered = floor.filter((r) => fontSizePx(r.body) === Infinity).map((r) => r.selector).join(' ');
    for (const needed of ['input', 'textarea', 'select']) {
      assert.match(covered, new RegExp(`\\b${needed}\\b`), `${needed} has no floor`);
    }
  });

  test('EVERY rule that sizes a control below 16px is answered by the touch floor', () => {
    /*
     * Derived from the stylesheet rather than from a list typed here. A new
     * rule setting `.some-form input { font-size: 0.85rem }` reintroduces the
     * bug, and fails here rather than being found by somebody months later
     * wondering why their phone keeps magnifying.
     *
     * A sub-16px rule is not itself a defect - the language picker is 0.85rem
     * on a desktop and nothing zooms there. What matters is that a touch
     * device gets a floor for that exact selector, because specificity
     * decides this and `.site-nav .lang select` outranks a bare `select`. So
     * the property is coverage, not absence.
     */
    const floorSelectors = new Set(
      all
        .filter((r) => r.context.some((c) => c.startsWith(TOUCH_QUERY)))
        .filter((r) => fontSizePx(r.body) === Infinity)
        .flatMap((r) => r.selector.split(',').map((one) => one.trim()))
    );

    const uncovered = all
      .filter((r) => CONTROL.test(r.selector))
      .filter((r) => !r.context.some((c) => c.startsWith(TOUCH_QUERY)))
      .map((r) => ({ selector: r.selector.trim(), px: fontSizePx(r.body) }))
      .filter((r) => r.px !== null && r.px < 16)
      .filter((r) => !floorSelectors.has(r.selector));

    assert.deepEqual(
      uncovered,
      [],
      'these size a form control under 16px and have no matching rule in the touch floor, ' +
        'so iOS will zoom on focus. Add the same selector to the pointer: coarse block.'
    );
  });

  test('the floor is not carrying selectors that no longer need it', () => {
    // The other direction. A floor entry for a rule that has since been
    // deleted or raised above 16px is dead weight that reads as protection.
    const sized = new Set(
      all
        .filter((r) => !r.context.some((c) => c.startsWith(TOUCH_QUERY)))
        .filter((r) => {
          const px = fontSizePx(r.body);
          return px !== null && px < 16;
        })
        .flatMap((r) => r.selector.split(',').map((one) => one.trim()))
    );

    const specific = all
      .filter((r) => r.context.some((c) => c.startsWith(TOUCH_QUERY)))
      .flatMap((r) => r.selector.split(',').map((one) => one.trim()))
      // The three bare element selectors are the general floor and are always
      // needed; anything more specific is there to answer a specific rule.
      .filter((one) => !/^(input|textarea|select)\b/.test(one));

    for (const one of specific) {
      assert.ok(sized.has(one), `${one} is in the touch floor but nothing sizes it below 16px`);
    }
  });

  test('pinch-zoom is not taken away, which is the usual wrong fix', () => {
    /*
     * maximum-scale=1 and user-scalable=no stop the zoom by stopping ALL
     * zooming, which is a WCAG 1.4.4 failure and a bad trade on a product
     * holding health information. iOS has ignored user-scalable=no in Safari
     * since iOS 10 in any case, so it is the wrong fix that also does not work.
     */
    const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
    const viewport = html.match(/<meta[^>]*name="viewport"[^>]*>/)?.[0] ?? '';
    assert.doesNotMatch(viewport, /maximum-scale/, 'pinch-zoom was capped');
    assert.doesNotMatch(viewport, /user-scalable\s*=\s*no/, 'pinch-zoom was disabled');
    assert.match(viewport, /width=device-width/);
  });
});

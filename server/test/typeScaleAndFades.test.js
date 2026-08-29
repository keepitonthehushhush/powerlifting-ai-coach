import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, stripComments } from './helpers/source.js';

const css = stripComments(readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8'));
const siteNav = readSource(new URL('../../web/src/components/SiteNav.jsx', import.meta.url));

/** Flat rules, brace-matched. A regex finds the wrong one. */
function rules(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const selectors = text.slice(i, open);
    let depth = 0;
    let end = -1;
    for (let k = open; k < text.length; k++) {
      if (text[k] === '{') depth++;
      else if (text[k] === '}' && --depth === 0) { end = k; break; }
    }
    if (end === -1) break;
    if (!/@/.test(selectors)) {
      out.push({ selectors: selectors.split(',').map((x) => x.trim()).filter(Boolean), body: text.slice(open + 1, end) });
    }
    i = end + 1;
  }
  return out;
}
const RULES = rules(css);
const rulesFor = (sel) => RULES.filter((r) => r.selectors.includes(sel));

/**
 * Two reported defects that a build, a linter and a test suite all agreed were
 * fine, because neither is an error: a decoration applied where it does not
 * belong, and a type size larger than its neighbours.
 */

describe('the navigation only fades an edge that has something past it', () => {
  /**
   * ── THE BUG ───────────────────────────────────────────────────────────
   *
   * "When looking at the FAQ tab it looks like part of it is hidden - like it
   * is about to hide behind a wall, and highlighting it makes it obvious."
   *
   * `.nav-places` faded its last 18px unconditionally. Between roughly 820 and
   * 860 pixels of window width the last tab's right edge lands inside that band
   * while the row does NOT overflow, so a fully visible tab was dimmed with
   * nothing to scroll to. Selection made it plain, because a highlight fades
   * under a mask like anything else.
   */
  test('the mask is never applied unconditionally', () => {
    for (const rule of rulesFor('.nav-places')) {
      assert.ok(
        !/mask-image/.test(rule.body),
        'a bare `.nav-places` rule sets a mask, so the last tab is faded whether or ' +
          'not the row can actually scroll - which is a visible tab dimmed for no reason'
      );
    }
  });

  test('it is applied per edge, keyed on measured overflow', () => {
    for (const state of ['end', 'start', 'both']) {
      const r = rulesFor(`.nav-places[data-fade='${state}']`);
      assert.equal(r.length, 1, `no rule for data-fade='${state}'`);
      assert.match(r[0].body, /mask-image/, `data-fade='${state}' fades nothing`);
    }
    // 'none' must have no mask rule at all rather than a mask that happens to
    // be transparent - the absence is the point.
    assert.equal(rulesFor(".nav-places[data-fade='none']").length, 0);
  });

  test('the component measures the element rather than guessing a breakpoint', () => {
    // Where this row overflows depends on how many destinations there are and
    // how long their TRANSLATED labels are. Any width hard-coded here would be
    // correct in one language.
    assert.match(siteNav, /scrollWidth\s*-\s*el\.clientWidth/, 'nothing measures the overflow');
    assert.match(siteNav, /data-fade=\{fade\}/, 'the measurement never reaches the DOM');
    assert.match(siteNav, /scrollLeft/, 'the scroll position does not decide which edge fades');
  });

  test('the measurement survives a language change', () => {
    // A ResizeObserver alone misses it: swapping "Log session" for "Registrar
    // sesion" changes the content width without resizing the box.
    const effect = siteNav.slice(siteNav.indexOf('function useEdgeFade'));
    const deps = effect.match(/\}\);?\s*$/m);
    assert.ok(!/\}, \[\]\);/.test(effect), 'the effect has an empty dependency array, so it measures once and never again');
    assert.ok(deps !== null);
  });

  test('it does not assume ResizeObserver exists', () => {
    // The suite renders this component under jsdom, which has none.
    assert.match(siteNav, /typeof ResizeObserver === 'function'/, 'an unguarded ResizeObserver will throw in the tests');
  });
});

describe('a tap target is made of height, not of type size', () => {
  /**
   * ── THE BUG ───────────────────────────────────────────────────────────
   *
   * "The links at the bottom of the login page look zoomed in a bit on Chrome
   * for mobile."
   *
   * Nothing was zoomed - there is no horizontal overflow on that page at any
   * width. The two links were set to 1rem, which is 16px, immediately under a
   * prompt at 13.12px and immediately above fine print at 13.12px. A 22% jump
   * on the only two links on the screen reads as a zoom.
   *
   * The accessible target was never the font size. It is the 44px of height,
   * which is why that stays and the override goes.
   */
  const target = rulesFor('.auth-alternative .link');

  test('the login alternatives keep their 44px target', () => {
    assert.equal(target.length, 1, 'the rule that makes these tappable is gone');
    assert.match(target[0].body, /min-height:\s*44px/, 'the 44px tap target was lost while fixing the type size');
  });

  test('and do not set a type size of their own', () => {
    assert.ok(
      !/font-size/.test(target[0].body),
      'these links set their own font-size, which puts them out of scale with the ' +
        'prompt above and the fine print below - the reported "zoomed in" look'
    );
  });

  /**
   * The general form, so this is a rule rather than one patched instance:
   * nothing may grow type in order to make something tappable.
   */
  test('no rule reaches 44px of target by inflating the text', () => {
    for (const rule of RULES) {
      if (!/min-height:\s*44px/.test(rule.body)) continue;
      const size = rule.body.match(/font-size:\s*([\d.]+)rem/);
      if (!size) continue;
      assert.ok(
        Number(size[1]) <= 1,
        `${rule.selectors.join(', ')} sets font-size ${size[1]}rem alongside a 44px target. ` +
          'Height and padding make a target; type size makes it look zoomed.'
      );
    }
  });
});

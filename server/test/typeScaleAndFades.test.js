import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, stripComments } from './helpers/source.js';

const css = stripComments(readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8'));
const siteNav = readSource(new URL('../../web/src/components/SiteNav.jsx', import.meta.url));
const edgeFade = readSource(new URL('../../web/src/lib/useEdgeFade.js', import.meta.url));
const scrollRegion = readSource(new URL('../../web/src/components/ScrollRegion.jsx', import.meta.url));

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
    // Every selector that could carry the mask, not only the one the bug was
    // first seen on. The rule moved to `[data-fade]` so that the program table
    // and the week strip get it too, and the same unconditional mistake is
    // available to all three of them now.
    for (const sel of ['.nav-places', '.week-strip', '.program-table-scroll', '.scroll-region']) {
      for (const rule of rulesFor(sel)) {
        assert.ok(
          !/mask-image/.test(rule.body),
          `a bare \`${sel}\` rule sets a mask, so its last item is faded whether or ` +
            'not the row can actually scroll - which is visible content dimmed for no reason'
        );
      }
    }
  });

  test('it is applied per edge, keyed on measured overflow', () => {
    for (const state of ['end', 'start', 'both']) {
      const r = rulesFor(`[data-fade='${state}']`);
      assert.equal(r.length, 1, `no rule for data-fade='${state}'`);
      assert.match(r[0].body, /mask-image/, `data-fade='${state}' fades nothing`);
    }
    // 'none' must have no mask rule at all rather than a mask that happens to
    // be transparent - the absence is the point.
    assert.equal(rulesFor("[data-fade='none']").length, 0);
  });

  test('the component measures the element rather than guessing a breakpoint', () => {
    // Where this row overflows depends on how many destinations there are and
    // how long their TRANSLATED labels are. Any width hard-coded here would be
    // correct in one language.
    assert.match(edgeFade, /scrollWidth\s*-\s*el\.clientWidth/, 'nothing measures the overflow');
    assert.match(siteNav, /data-fade=\{fade\}/, 'the navigation never puts the measurement in the DOM');
    assert.match(
      scrollRegion,
      /data-fade=\{fade\}/,
      'the shared region never puts the measurement in the DOM'
    );
    assert.match(edgeFade, /scrollLeft/, 'the scroll position does not decide which edge fades');
  });

  test('the measurement survives a language change', () => {
    /*
     * A ResizeObserver alone misses it: swapping "Log session" for "Registrar
     * sesion" changes the content width without resizing the box. So the
     * measuring effect deliberately has NO dependency array and runs after
     * every render.
     *
     * The first version of this test searched the whole file for `}, []);`,
     * which is a substring trap and duly fired the moment the hook grew a
     * `useCallback(..., [])` - a stable callback, which is correct and is not
     * the effect. It reads the effect's own terminator now.
     */
    const from = edgeFade.indexOf('useEffect(');
    assert.ok(from > -1, 'the hook no longer has an effect in it');
    const to = edgeFade.indexOf('\n  });', from);
    const terminator = edgeFade.indexOf('\n  }, [', from);
    assert.ok(
      to > -1 && (terminator === -1 || to < terminator),
      'the measuring effect has a dependency array, so it measures once and never again',
    );
  });

  test('it does not assume ResizeObserver exists', () => {
    // The suite renders this component under jsdom, which has none.
    assert.match(edgeFade, /typeof ResizeObserver === 'function'/, 'an unguarded ResizeObserver will throw in the tests');
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

describe('a box that scrolls sideways says so', () => {
  /**
   * ── THE BUG ───────────────────────────────────────────────────────────
   *
   * "When showing their workout, it cuts off after reps and then the end user
   * needs to scroll over. Can we add an arrow or something to indicate that
   * the end user needs to scroll over?"
   *
   * Measured on the real program screen with touch emulation on: at 320px the
   * WEIGHT column is clipped by 16px and LOGGED is off the screen entirely; at
   * 360px LOGGED is clipped by 39px; at 390px by 11px; at 414px and wider
   * nothing is hidden. The week strip was worse - 743px of chips inside a
   * 359px box - and neither of them said anything.
   *
   * The behavior of the affordance is checked by driving a browser
   * (scripts/check-scroll-cues.mjs). These are the things a rendered check
   * cannot see: that the page still goes through the shared component at all,
   * that CI runs the browser check after the build that feeds it, and that
   * both languages have the words.
   */
  const program = readSource(new URL('../../web/src/pages/Program.jsx', import.meta.url));
  const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
  const es = readSource(new URL('../../web/src/i18n/locales/es.js', import.meta.url));
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

  test('the program table and the week strip both go through it', () => {
    // A bare `<div className="program-table-scroll">` is what shipped the
    // defect: the box scrolled and nothing on the page said so. Naming the
    // class is not enough - it has to be the class ON a ScrollRegion.
    for (const cls of ['program-table-scroll', 'week-strip']) {
      assert.match(
        program,
        new RegExp(`<ScrollRegion[^>]*\\n?[^>]*className="${cls}"`, 's'),
        `${cls} is not wrapped in a ScrollRegion, so nothing measures it`,
      );
      assert.doesNotMatch(
        program,
        new RegExp(`<div className="${cls}"`),
        `${cls} is back to a plain div, which is the original defect`,
      );
    }
  });

  test('the table names itself, because a table has nothing inside it to tab to', () => {
    // `keyboard` is what turns on role=region + tabindex, and the region needs
    // an accessible name to be worth landing on. The week strip deliberately
    // does NOT get it: its children are links, so tabbing already scrolls it.
    assert.match(program, /labeledBy=\{`day-\$\{index\}-name`\}/, 'the table region is not named');
    assert.match(program, /id=\{`day-\$\{index\}-name`\}/, 'nothing carries the id the region points at');
    assert.match(program, /keyboard\s*\n?\s*>/, 'the table region is not keyboard reachable');
    const strip = program.slice(program.indexOf('className="week-strip"'));
    assert.doesNotMatch(
      strip.slice(0, strip.indexOf('</ScrollRegion>')),
      /keyboard/,
      'the week strip took a tab stop it does not need - its chips are links',
    );
  });

  test('the cue has words in both languages, not only an arrow', () => {
    // Nielsen Norman on horizontal scrolling: people do not expect a page to
    // move sideways, and an unlabeled chevron is read as decoration. An
    // untranslated one is worse - it is English on a Spanish page.
    for (const [name, locale] of [['en', en], ['es', es]]) {
      for (const key of ['scrollForMore', 'scrollBackToStart']) {
        assert.match(locale, new RegExp(`${key}:`), `${name} has no ${key}`);
      }
    }
  });

  test('the control clears the AA target floor', () => {
    // WCAG 2.5.8 is 24x24 CSS pixels at AA. The padding and the caption type
    // together do it; a quiet hint should not have to look like a submit
    // button to be tappable.
    const cue = rulesFor('.scroll-cue');
    assert.equal(cue.length, 1, 'the cue has no rule of its own');
    assert.match(cue[0].body, /min-height:\s*24px/, 'the cue can be smaller than the AA target floor');
  });

  test('the cue is built from tokens the palette guarantees for all twenty', () => {
    /*
     * ── THE DEFECT THIS CATCHES ───────────────────────────────────────────
     *
     * "Make sure the scroll cue also is set up for the other themes."
     *
     * It was not. The first version used --border on --surface, which measures
     * 1.32:1 in Miami light and 1.22:1 in Miami dark - a control whose edge is
     * very nearly invisible - and had no guarantee whatever in the other
     * eighteen palettes, because --border is documented as decorative and is
     * deliberately NOT held to a contrast floor.
     *
     * palette.test.js already proves, for all ten themes in both modes, that
     * --field-border clears 3:1 against --surface-2 and that --secondary-text
     * clears 4.5:1 against bg, surface AND surface-2. Building the cue out of
     * exactly those tokens is how it inherits twenty proofs instead of needing
     * twenty of its own.
     *
     * Named tokens rather than "contains a var()", and asserted with
     * deepEqual rather than a count, because a ceiling lets a mutant under it.
     * The rendered check (scripts/check-scroll-cues.mjs) repaints all twenty
     * palettes and measures what actually reaches the element; this is the
     * half of the question a browser cannot answer - WHICH token was reached
     * for, and therefore whether the guarantee exists at all.
     */
    const cue = rulesFor('.scroll-cue');
    assert.equal(cue.length, 1, 'the cue has no rule of its own');
    const declared = Object.fromEntries(
      cue[0].body
        .split(';')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()]),
    );
    assert.equal(declared.color, 'var(--secondary-text)', 'the words are not on a guaranteed ink');
    assert.equal(declared.background, 'var(--surface-2)', 'the chip is not on the fill --field-border is solved against');
    assert.equal(declared.border, '1px solid var(--field-border)', 'the edge is not on the control-boundary token');
  });

  test('a focused box drops the mask, so the focus ring is whole', () => {
    // A mask paints the ring too. Tabbing into the table would otherwise give
    // an outline whose right-hand end dissolves, which is the one place an
    // outline has to be solid (WCAG 2.4.7).
    const focused = rulesFor('[data-fade]:focus-visible');
    assert.equal(focused.length, 1, 'nothing restores the sharp edge while the box is focused');
    assert.match(focused[0].body, /mask-image:\s*none/);
    assert.match(focused[0].body, /outline:/, 'the mask is dropped and no ring is drawn');
  });

  test('CI builds the harness before it presses the buttons in it', () => {
    // The same ordering trap as check:styles: a build step after the check it
    // feeds is the same as no build step, and the check exits 1 rather than
    // skipping, so the failure would be loud but late.
    assert.equal(pkg.scripts['check:scroll'], 'node scripts/check-scroll-cues.mjs');
    const buildAt = ci.indexOf('npm run build:harness');
    const checkAt = ci.indexOf('npm run check:scroll');
    assert.ok(checkAt > -1, 'CI never runs the scroll-cue check');
    assert.ok(buildAt > -1 && buildAt < checkAt, 'the harness is built after the check that reads it');
  });
});

describe('every box that scrolls sideways goes through the one component', () => {
  /**
   * ── WHAT THE FIRST PASS MISSED ────────────────────────────────────────
   *
   * The affordance was built for the page the defect was reported on. Four
   * more boxes in this application scroll sideways and none of them said so:
   * the leaderboard's board, the progress table, the coach's own tables in the
   * transcript - which is the one an athlete reads a prescription out of - and
   * the week strip.
   *
   * Fixing the reported instance of a defect and leaving its four siblings is
   * how a thing gets reported twice.
   */
  const files = {
    'pages/Leaderboard.jsx': 'table-scroll',
    'pages/Progress.jsx': 'table-scroll',
    'components/CoachMessage.jsx': 'coach-table-scroll',
    'pages/Program.jsx': 'program-table-scroll',
  };

  for (const [file, cls] of Object.entries(files)) {
    test(`${file} wraps .${cls} rather than leaving it a bare div`, () => {
      const source = readSource(new URL(`../../web/src/${file}`, import.meta.url));
      assert.match(
        source,
        new RegExp(`<ScrollRegion[\\s\\S]{0,200}className="${cls}"`),
        `.${cls} is not measured, so it can hide a column silently`,
      );
      assert.doesNotMatch(
        source,
        new RegExp(`<div className="${cls}"`),
        `.${cls} is back to a plain div, which is the original defect`,
      );
    });
  }

  test('a table names itself for the keyboard; a strip of links does not need to', () => {
    // A table has nothing inside it to tab to, so its wrapper has to be
    // reachable. The week strip's children are links and already are.
    for (const file of ['pages/Leaderboard.jsx', 'pages/Progress.jsx', 'components/CoachMessage.jsx']) {
      const source = readSource(new URL(`../../web/src/${file}`, import.meta.url));
      assert.match(source, /keyboard\s*\n?\s*>/, `${file}'s table cannot be reached by keyboard`);
      assert.match(
        source,
        /(labeledBy=|label=\{t\()/,
        `${file}'s scrolling region has no accessible name`,
      );
    }
  });

  test('the rule that makes them scroll is declared once', () => {
    // `.table-scroll { overflow-x: auto; }` appeared twice, six hundred lines
    // apart, the same two words. Two rules for one thing is how they drift.
    assert.equal(
      rulesFor('.table-scroll').length,
      1,
      '.table-scroll has more than one rule again',
    );
  });

  test('the browser check looks at every screen with one on it, not just the reported one', () => {
    const check = readSource(new URL('../../scripts/check-scroll-cues.mjs', import.meta.url));
    const block = check.slice(check.indexOf('const PAGES = ['), check.indexOf('];', check.indexOf('const PAGES = [')));
    const swept = [...block.matchAll(/\{ id: '([a-z]+)', overflows: (true|false)/g)]
      .map((m) => `${m[1]}:${m[2]}`);
    /*
     * The page AND what it is expected to hide, because the second half is the
     * half that rots. The leaderboard is `false` on purpose: its board used to
     * overflow by 67px with the WEIGHT off the right edge, and the fix was to
     * make it fit rather than to label it. If it starts overflowing again this
     * list is what says so.
     */
    assert.deepEqual(
      swept,
      ['program:true', 'leaderboard:false', 'progress:true', 'coach:true'],
      'the page sweep changed - every screen with a sideways box belongs in it',
    );
  });
});

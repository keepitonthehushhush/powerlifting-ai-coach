import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readSource, stripComments } from './helpers/source.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (p) => readSource(new URL(p, import.meta.url));

const loadingCode = code('../../web/src/components/Loading.jsx');
const app = code('../../web/src/App.jsx');
const css = read('../../web/src/styles.css');
const cssCode = stripComments(css);

/**
 * A stick figure curling the Coach Diaz badge.
 *
 * ── WHY A WHOLE TEST FILE FOR A LOADING SPINNER ───────────────────────────
 *
 * Because every way this can be wrong is silent. A pivot around the wrong
 * point renders a valid document. A badge drawn below the size its own mark
 * survives renders a valid document. An animation with no reduced-motion
 * escape renders a valid document. Nothing throws, nothing warns, the build is
 * green, and the only signal is a person looking at the page.
 *
 * Two of the assertions below exist because that is exactly what happened:
 * they were written after rendering the component in a real browser and
 * finding a defect that the entire suite, the linter and the build had all
 * agreed was fine.
 */

describe('the loading figure', () => {
  /**
   * ── THE ASSERTION THIS FILE EXISTS FOR ────────────────────────────────
   *
   * The elbow is written down twice: once in Loading.jsx, as the point the
   * upper arm ends at and the forearm begins at, and once in styles.css, as
   * the transform-origin the arm rotates about. Two files, one number, and
   * nothing connecting them.
   *
   * Move the figure - lengthen the torso, widen the stance, redraw the arm -
   * and the JSX is self-consistent while the CSS still pivots about where the
   * elbow used to be. The result is not a crash. It is a stick figure whose
   * forearm detaches from its arm and swings through the air beside it, which
   * ships, because the build is green and the page renders.
   */
  test('the CSS pivots about the elbow the JSX actually draws', () => {
    const upperArm = loadingCode.match(/<line x1="64" y1="72" x2="(\d+)" y2="(\d+)"/);
    assert.ok(upperArm, 'cannot find the upper arm in Loading.jsx');
    const [, elbowX, elbowY] = upperArm;

    const origin = cssCode.match(/\.loading-arm\s*\{[^}]*transform-origin:\s*(\d+)px\s+(\d+)px/);
    assert.ok(origin, '.loading-arm declares no transform-origin');

    assert.equal(
      `${origin[1]},${origin[2]}`,
      `${elbowX},${elbowY}`,
      'the arm rotates about a point that is not the elbow, so the forearm ' +
        'detaches from the upper arm. Nothing errors; it just looks broken.'
    );

    // And the forearm has to START at that elbow, or it pivots about a point
    // it is not attached to.
    const forearm = loadingCode.match(/<line\s+x1="(\d+)"\s+y1="(\d+)"/g) || [];
    assert.ok(
      forearm.some((l) => l.includes(`x1="${elbowX}"`) && l.includes(`y1="${elbowY}"`)),
      'no line begins at the elbow, so nothing is hinged there'
    );
  });

  /**
   * `transform-box` is the other silent one, and it is worse because the
   * default is wrong rather than absent. Without it, `transform-origin:
   * 104px 112px` on an SVG child is resolved against that CHILD's bounding
   * box - 104 across from the left edge of the forearm, which is off the arm
   * entirely - and the assembly orbits a point in space.
   */
  test('the pivot is measured in the viewBox and not in the arm\'s own box', () => {
    assert.match(
      cssCode,
      /\.loading-arm\s*\{[^}]*transform-box:\s*view-box/,
      '.loading-arm has a transform-origin but no transform-box: view-box, so ' +
        'the coordinates are read against the forearm\'s bounding box instead ' +
        'of the viewBox and the pivot is somewhere else entirely'
    );
  });

  test('it holds still for anybody who asked their system for less motion', () => {
    const reduced = cssCode.split('@media (prefers-reduced-motion: reduce)').slice(1);
    assert.ok(
      reduced.some((block) => /\.loading-arm\s*\{[^}]*animation:\s*none/.test(block)),
      'a short repeating animation with no reduced-motion escape'
    );
  });

  test('the animation is declared after the landing page block', () => {
    // server/test/landing.test.js reads every rule from `.home {` to the END
    // OF THE LANDING PAGE BLOCK marker and requires each selector to be
    // `home-` prefixed. A rule added above the marker is a failure of a test
    // about a page it has nothing to do with.
    const marker = css.indexOf('END OF THE LANDING PAGE BLOCK');
    assert.ok(marker !== -1, 'the landing page block marker is gone');
    assert.ok(
      css.indexOf('.loading-arm') > marker,
      'the loading rules were appended inside the landing page block'
    );
  });

  test('the decoration is hidden and the word is what gets announced', () => {
    assert.match(loadingCode, /role="status"/, 'nothing announces that a wait is happening');
    assert.match(
      loadingCode,
      /<svg[\s\S]*?aria-hidden="true"/,
      'a screen reader would describe a stick figure instead of saying "loading"'
    );
    assert.match(
      loadingCode,
      /t\('common\.loading'\)/,
      'the word beside the figure has to come from the locale, not from English'
    );
    for (const [name, locale] of [['en', en], ['es', es]]) {
      assert.equal(typeof locale.common.loading, 'string', `${name} has no common.loading`);
    }
  });

  /**
   * ── THE BADGE HAS TO KNOW HOW BIG IT REALLY IS ────────────────────────
   *
   * Logo draws a simplified mark below 32px because the full one smears at
   * small sizes, and it decides that from its `size` prop. Inside an SVG that
   * prop is in USER UNITS: the badge occupies 64 of the figure's 200, so it
   * renders at 32% of the figure. Handing Logo a flat 64 told it that it was
   * 64px when at the 72px figure it was 23px, and the mark came out as mud.
   *
   * Green build, no error, no console warning. Found by rendering the two
   * sizes beside each other. This is the assertion that would have found it.
   */
  test('every place the figure is used renders a legible badge', () => {
    const minimum = Number(
      code('../../web/src/components/Logo.jsx').match(/FULL_MARK_MINIMUM = (\d+)/)[1]
    );
    const share = 64 / 200;
    const sites = loadingCallSites();
    assert.ok(sites.length > 0, 'nothing uses the loading figure');

    // Logo must be told the size it will occupy, and the group must scale the
    // result back to the 64 units the figure is laid out around - the forearm
    // ends at the badge's centre, so changing its size moves the hand.
    assert.match(
      loadingCode,
      /<Logo size=\{badgePixels\}/,
      'Logo is given a constant instead of the size it will actually render at'
    );
    assert.match(
      loadingCode,
      /scale\(\$\{backToUserUnits\}\)/,
      'nothing scales the badge back to the 64 units the figure is laid out around'
    );
    assert.match(
      loadingCode,
      /const backToUserUnits = 64 \/ badgePixels;/,
      'the scale does not undo the size, so the badge is the wrong size on screen'
    );

    // THE POINT: at least one real call site draws the badge below Logo's own
    // legibility floor. That is what made the old constant a bug rather than a
    // tidiness question, and if it ever stops being true this assertion says
    // so rather than quietly passing for the wrong reason.
    const belowFloor = sites.filter(([, size]) => Math.round(size * share) < minimum);
    assert.ok(
      belowFloor.length > 0,
      'no call site is small enough for the variant choice to matter any more - ' +
        'either a size changed or the floor did, and the computed size in ' +
        'Loading.jsx should be re-justified rather than left as decoration'
    );
  });

  test('the figure is never asked for at a size the mark cannot survive', () => {
    // 100px is where the badge reaches Logo's own 32px floor. Below it the
    // compact mark is doing the work, and below about 25px even that stops
    // being a mark and becomes a shape.
    const sizes = loadingCallSites();
    assert.ok(sizes.length > 0, 'nothing uses the loading figure');
    for (const [file, size] of sizes) {
      assert.ok(size >= 48, `${file} renders the figure at ${size}px, which is a smudge`);
    }
  });

  test('it reuses the real mark rather than a second copy of it', () => {
    assert.match(
      loadingCode,
      /import \{ Logo \}/,
      'a hand-drawn second badge drifts from the first the next time the mark changes'
    );
  });

  /**
   * ── WHERE IT IS *NOT* ─────────────────────────────────────────────────
   *
   * Every route in this application is in one bundle, so a route change
   * involves no network: React swaps the tree in a frame. An animation in
   * front of that does not cover a wait, it MANUFACTURES one. This asserts
   * the figure never becomes an interstitial wrapped around the router.
   */
  test('it is not an interstitial in front of the router', () => {
    assert.doesNotMatch(
      app,
      /<Loading/,
      'App.jsx renders the loading figure, which would put an animation in ' +
        'front of transitions that are already instant'
    );
  });

  test('no page still renders the bare word where the figure belongs', () => {
    const dir = new URL('../../web/src/', import.meta.url);
    const offenders = [];
    const walk = (at, prefix = '') => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(new URL(`${entry.name}/`, at), `${prefix}${entry.name}/`);
          continue;
        }
        if (!entry.name.endsWith('.jsx')) continue;
        if (entry.name === 'Loading.jsx') continue;
        const src = readSource(new URL(entry.name, at));
        if (/t\('common\.loading'\)/.test(src)) offenders.push(prefix + entry.name);
      }
    };
    walk(dir);
    assert.deepEqual(
      offenders,
      [],
      `these still print the word instead of showing the figure: ${offenders.join(', ')}`
    );
  });
});
/**
 * Every size the application actually asks the loading figure for.
 *
 * Read from the call sites rather than assumed, because the defect this file
 * exists for was invisible at the default size and only appeared at the
 * smaller one a handful of pages pass.
 */
function loadingCallSites() {
  const found = [];
  const dir = new URL('../../web/src/', import.meta.url);
  const walk = (at, prefix = '') => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, at), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.jsx') || entry.name === 'Loading.jsx') continue;
      const src = readSource(new URL(entry.name, at));
      for (const m of src.matchAll(/<Loading(\s[^/>]*)?\/>/g)) {
        const size = (m[1] || '').match(/size=\{(\d+)\}/);
        found.push([prefix + entry.name, size ? Number(size[1]) : 120]);
      }
    }
  };
  walk(dir);
  return found;
}

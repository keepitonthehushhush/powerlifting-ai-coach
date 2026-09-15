import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withoutYamlComments } from './helpers/source.js';

/**
 * The half of the chart-scale property that can be checked without a browser.
 *
 * ── WHY MOST OF IT CANNOT BE ──────────────────────────────────────────────
 *
 * The defect was that `.chart-axis-label` declared `font-size: 10px` and
 * reached the eye at 8.9px, because both chart components drew a 340-unit
 * viewBox into a 302px box. Nothing that reads a file can see that: the
 * declared value is right, the component is right, and the scale factor is a
 * layout outcome that only exists once something has been laid out.
 *
 * `scripts/check-chart-scale.mjs` is where that is measured. This file guards
 * the things that make that script able to run at all and that would otherwise
 * rot in silence - it is wired into CI, it is wired AFTER the build it reads,
 * and the pieces it depends on are still in the components.
 */
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const pkg = JSON.parse(read('../../package.json'));
/*
 * Comments stripped. `run: true # npm run check:chart` disables the step and
 * leaves the words in the file, and a presence assertion against the raw text
 * is satisfied by the comment - a mutant that did exactly that survived the
 * first version of this file. deployLanded.test.js met the same trap from the
 * absence side, which is why the stripper now lives in helpers/source.js.
 */
const ci = withoutYamlComments(read('../../.github/workflows/ci.yml'));
const css = read('../../web/src/styles.css');
const script = read('../../scripts/check-chart-scale.mjs');
const hook = read('../../web/src/lib/useMeasuredWidth.js');
const charts = {
  'LiftChart.jsx': read('../../web/src/components/LiftChart.jsx'),
  'OneRepMaxChart.jsx': read('../../web/src/components/OneRepMaxChart.jsx'),
};

describe('the charts are drawn at the size they declare', () => {
  test('CI runs the check, and builds the harness before it', () => {
    // The same ordering trap as check:styles and check:scroll: a build step
    // after the check it feeds is the same as no build step.
    assert.equal(pkg.scripts['check:chart'], 'node scripts/check-chart-scale.mjs');
    const buildAt = ci.indexOf('npm run build:harness');
    const checkAt = ci.indexOf('npm run check:chart');
    assert.ok(checkAt > -1, 'CI never runs the chart-scale check');
    assert.ok(buildAt > -1 && buildAt < checkAt, 'the harness is built after the check that reads it');
  });

  test('NEITHER CHART HARDCODES ITS viewBox WIDTH', () => {
    /*
     * The defect itself, in the only form a file reader can see it. A literal
     * `viewBox="0 0 340 170"` is what made the scale 0.888; the width has to
     * come from the measurement.
     */
    for (const [name, source] of Object.entries(charts)) {
      assert.match(
        source,
        /const \[svgRef, width\] = useMeasuredWidth\(/,
        `${name} no longer takes its width from the element`,
      );
      assert.match(source, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/, `${name} has a viewBox that is not measured`);
      assert.doesNotMatch(source, /viewBox="0 0 \d/, `${name} is back to a literal viewBox`);
      assert.match(source, /ref=\{svgRef\}/, `${name} measures something that is not the element it draws into`);
      /*
       * A constant height, not a derived one. An aspect-locked chart is 1:1 -
       * the script's first assertion passes - and a wider chart becomes a
       * taller chart rather than a longer one, which is the magnification
       * problem pointing the other way.
       */
      assert.match(source, /const height = 170;/, `${name} derives its height from its width`);
    }
  });

  test('the axis label is on the type ladder, and the allowlist entry is gone', () => {
    assert.match(css, /\.chart-axis-label \{[^}]*font-size: var\(--text-caption-2\)/);
    const typeScale = read('./typeScale.test.js');
    assert.doesNotMatch(
      typeScale,
      /^\s*'10px',/m,
      'the raw 10px is allowlisted again, which is how it went unmeasured for so long',
    );
  });

  test('the hook measures before paint, and keeps measuring', () => {
    // useEffect alone paints one frame at the fallback scale and then jumps;
    // no ResizeObserver means it is correct at mount and wrong after a resize,
    // because a window resize is not a render.
    assert.match(hook, /useLayoutEffect\(measure\)/, 'the first frame is measured after it is painted');
    assert.match(hook, /new ResizeObserver\(measure\)/, 'the width is measured once and never again');
    assert.match(hook, /typeof ResizeObserver !== 'function'/, 'jsdom has none, and the tests render this');
  });

  test('THE FLOOR IS READ FROM THE STYLESHEET, NOT WRITTEN IN THE SCRIPT', () => {
    /*
     * The script compares the rendered size against `--text-caption-2`. If
     * that number were copied into the script it would be a second opinion
     * about the same rule, and it would be the stale one the first time the
     * ladder moves. Asserted here because a script that is only run in CI is a
     * script whose regressions are found in CI.
     */
    assert.match(script, /--text-caption-2:\\s\*\(\[\\d\.\]\+\)rem/, 'the floor is no longer read out of styles.css');
    assert.doesNotMatch(script, /const FLOOR = \d/, 'the floor has been hardcoded');
    assert.match(css, /--text-caption-2: 0\.6875rem/, 'the rung the floor is read from has moved');
  });
});

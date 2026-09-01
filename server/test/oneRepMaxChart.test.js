import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildChart } from '../../web/src/lib/chartData.js';
import { oneRepMaxSeries } from '../../web/src/lib/oneRepMax.js';

const chartSource = await readFile(new URL('../../web/src/components/OneRepMaxChart.jsx', import.meta.url), 'utf8');
const progressPage = await readFile(new URL('../../web/src/pages/Progress.jsx', import.meta.url), 'utf8');
const stylesheet = await readFile(new URL('../../web/src/styles.css', import.meta.url), 'utf8');
const englishCopy = await readFile(new URL('../../web/src/i18n/locales/en.js', import.meta.url), 'utf8');

const LOGS = [
  { lift: 'squat', date: '2026-07-01', weight: 100, reps: 5, completed: true },
  { lift: 'squat', date: '2026-07-08', weight: 105, reps: 5, completed: true },
  { lift: 'squat', date: '2026-07-15', weight: 110, reps: 3, completed: true },
];

/**
 * The band sits above and below the line it surrounds. Scaled from the midline
 * alone it is clipped at the top of the plot, which reads as a ceiling the
 * athlete has hit rather than as a chart that is too short.
 */
test('the y scale covers the band, not just the line through it', () => {
  const points = oneRepMaxSeries(LOGS, 'squat');
  const highest = Math.max(...points.map((p) => p.high));
  const lowest = Math.min(...points.map((p) => p.low));

  const naive = buildChart(points.map((p) => ({ ...p, weight: p.mid })), { width: 340, height: 170 });
  const widened = buildChart(points.map((p) => ({ ...p, weight: p.mid })), {
    width: 340,
    height: 170,
    extend: [lowest, highest],
  });

  assert.ok(widened.scale.max >= highest, 'the top of the band is outside the plot');
  assert.ok(widened.scale.min <= lowest, 'the bottom of the band is outside the plot');
  // And the option genuinely does something, or the test above is vacuous.
  assert.ok(naive.scale.max < widened.scale.max || naive.scale.min > widened.scale.min);
});

test('extend ignores values that are not numbers rather than producing NaN ticks', () => {
  const chart = buildChart([{ date: '2026-07-01', weight: 100 }], {
    extend: [NaN, undefined, null, Infinity, 140],
  });
  for (const tick of chart.yTicks) {
    assert.ok(Number.isFinite(tick.value), `tick ${tick.value} is not a number`);
    assert.ok(Number.isFinite(tick.y), `tick y ${tick.y} is not a number`);
  }
  assert.ok(chart.scale.max >= 140);
});

test('a single estimate still shows its range rather than nothing', () => {
  // A polygon with one vertex has no area and renders as an empty path, so the
  // component draws a rule instead. Asserted because "it renders nothing" is
  // indistinguishable from "there is no data" on screen.
  assert.match(chartSource, /e1rm-band-single/);
  assert.match(chartSource, /chart\.dots\.length === 1/);
  assert.match(stylesheet, /^\.e1rm-band-single \{/m);
});

test('every class the chart draws is defined in the stylesheet', () => {
  const classes = [...chartSource.matchAll(/className=(?:"|\{')([a-z0-9 -]*e1rm[a-z0-9 -]*)/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => c.startsWith('e1rm'));
  assert.ok(classes.length >= 3, 'found no e1rm classes in the component');
  for (const cls of new Set(classes)) {
    assert.ok(
      new RegExp(`\\.${cls}[\\s,{]`).test(stylesheet),
      `.${cls} is drawn by OneRepMaxChart and defined nowhere in styles.css`,
    );
  }
});

/**
 * The band re-uses the chart line color rather than introducing a third hue.
 * The chart palette was validated as a PAIR for color-vision separation;
 * adding to it would invalidate that measurement rather than extend it.
 */
test('the band introduces no new chart color', () => {
  const declared = [...stylesheet.matchAll(/^\.e1rm[^{]*\{[^}]*\}/gms)].join('\n');
  assert.ok(declared.length > 0, 'no e1rm rules found');
  const colors = [...declared.matchAll(/(?:fill|stroke):\s*var\((--[\w-]+)\)/g)].map((m) => m[1]);
  assert.ok(colors.length > 0);
  for (const token of new Set(colors)) {
    assert.ok(
      ['--chart-line', '--surface'].includes(token),
      `the band uses ${token}, which is not the validated chart pair`,
    );
  }
});

/**
 * The page-level wiring. A chart component nothing renders is not a feature.
 */
test('the progress page renders the estimate charts from the same rows as the weight charts', () => {
  assert.match(progressPage, /from '\.\.\/components\/OneRepMaxChart\.jsx'/);
  assert.match(progressPage, /from '\.\.\/lib\/oneRepMax\.js'/);
  assert.match(progressPage, /<OneRepMaxChart/);
  // Both series are derived inside the same map over the same normalized rows.
  const memo = progressPage.slice(progressPage.indexOf('const series = useMemo'), progressPage.indexOf('}, [logs]);'));
  assert.match(memo, /topSetPerDay\(/);
  assert.match(memo, /oneRepMaxSeries\(/);
});

test('the section says what the band is, and says what it is not', () => {
  // The one claim that must never be made about it. oneRepMax.js explains why:
  // the equations cross at ten reps, so the band is narrowest exactly where the
  // estimate is least trustworthy, and a reader taking width as confidence
  // would draw the opposite of the truth from it.
  assert.match(englishCopy, /not a margin of error/i);
  assert.doesNotMatch(englishCopy, /confidence interval/i);
  assert.match(progressPage, /progress\.e1rmIntro/);
});

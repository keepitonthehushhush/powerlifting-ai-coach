import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildChart, niceScale, shortDate, topSetPerDay, trend } from '../../web/src/lib/chartData.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const chart = read('../../web/src/components/LiftChart.jsx');
const css = read('../../web/src/styles.css');
const page = read('../../web/src/pages/Progress.jsx');
const sessions = read('../src/routes/sessions.js');
const deps = read('../../web/package.json');

const log = (over = {}) => ({ lift: 'squat', weight: 225, reps: 5, rpe: 7, completed: true, date: '2026-08-01', ...over });

describe('topSetPerDay', () => {
  test('keeps the heaviest set of each day, not the last', () => {
    // A training day holds warm-ups and work sets. The heaviest describes where
    // the athlete is; averaging would blur a top single into the ramp.
    const points = topSetPerDay(
      [log({ weight: 135 }), log({ weight: 225 }), log({ weight: 185 })],
      'squat',
    );
    assert.equal(points.length, 1);
    assert.equal(points[0].weight, 225);
  });

  test('keeps a missed top set rather than dropping it', () => {
    // The most interesting point on the chart is where a stall begins.
    const points = topSetPerDay([log({ weight: 245, completed: false })], 'squat');
    assert.equal(points[0].completed, false);
  });

  test('returns days in chronological order whatever order they arrive in', () => {
    const points = topSetPerDay(
      [log({ date: '2026-08-10' }), log({ date: '2026-08-01' }), log({ date: '2026-08-05' })],
      'squat',
    );
    assert.deepEqual(points.map((p) => p.date), ['2026-08-01', '2026-08-05', '2026-08-10']);
  });

  test('ignores other lifts and unusable rows', () => {
    const points = topSetPerDay(
      [log({ lift: 'bench' }), log({ weight: null }), log({ date: null }), log({ weight: 'heavy' })],
      'squat',
    );
    assert.equal(points.length, 0);
  });

  test('survives being handed nothing at all', () => {
    assert.deepEqual(topSetPerDay(null, 'squat'), []);
    assert.deepEqual(topSetPerDay([], 'squat'), []);
  });
});

describe('niceScale', () => {
  test('a series where every weight is identical still has height', () => {
    // Otherwise the range is zero and every point divides by zero.
    const scale = niceScale([200, 200, 200]);
    assert.ok(scale.max > scale.min, 'a flat series must not produce a zero-height axis');
  });

  test('the lowest point does not sit on the axis line', () => {
    // A point on the frame reads as zero rather than as the smallest value.
    const scale = niceScale([225, 245]);
    assert.ok(scale.min < 225, 'the scale must leave headroom below the minimum');
    assert.ok(scale.max > 245, 'the scale must leave headroom above the maximum');
  });

  test('ticks land on round numbers', () => {
    const { ticks } = niceScale([225, 315]);
    for (const t of ticks) {
      assert.equal(t, Math.round(t * 100) / 100);
    }
    assert.ok(ticks.length >= 2);
  });

  test('does not throw on an empty series', () => {
    assert.doesNotThrow(() => niceScale([]));
    assert.doesNotThrow(() => niceScale(null));
  });
});

describe('buildChart', () => {
  const points = topSetPerDay(
    [log({ date: '2026-08-01', weight: 225 }), log({ date: '2026-08-04', weight: 235 }), log({ date: '2026-08-07', weight: 245 })],
    'squat',
  );

  test('produces a coordinate for every point, and no NaN anywhere', () => {
    const c = buildChart(points);
    assert.equal(c.dots.length, 3);
    for (const dot of c.dots) {
      assert.ok(Number.isFinite(dot.cx), 'cx must be a number');
      assert.ok(Number.isFinite(dot.cy), 'cy must be a number');
    }
    assert.ok(!c.path.includes('NaN'));
  });

  test('heavier means higher on the chart', () => {
    // y grows downward in SVG, so the heaviest set must have the SMALLEST y.
    const c = buildChart(points);
    assert.ok(c.dots[2].cy < c.dots[0].cy, 'a heavier set must sit above a lighter one');
  });

  test('a single logged session draws no line and does not crash', () => {
    // A brand new athlete has exactly one point. This is a real state, not an
    // edge case to be defended against with an error message.
    const c = buildChart(points.slice(0, 1));
    assert.equal(c.path, '', 'one point is not a line');
    assert.equal(c.dots.length, 1);
    assert.ok(Number.isFinite(c.dots[0].cx));
  });

  test('a flat series renders inside the plot rather than off it', () => {
    const flat = topSetPerDay(
      [log({ date: '2026-08-01' }), log({ date: '2026-08-04' }), log({ date: '2026-08-07' })],
      'squat',
    );
    const c = buildChart(flat);
    for (const dot of c.dots) {
      assert.ok(dot.cy >= c.plot.top && dot.cy <= c.plot.top + c.plot.height, 'point escaped the plot area');
    }
  });

  test('every point stays within the plot area', () => {
    const c = buildChart(points);
    for (const dot of c.dots) {
      assert.ok(dot.cx >= c.plot.left && dot.cx <= c.plot.left + c.plot.width);
      assert.ok(dot.cy >= c.plot.top - 0.01 && dot.cy <= c.plot.top + c.plot.height + 0.01);
    }
  });
});

describe('shortDate', () => {
  test('does not drift a day for anyone west of Greenwich', () => {
    // new Date('2026-07-06') is UTC midnight, which renders as July 5th in any
    // negative-offset zone. The same trap already cost a day in the logging
    // form's date default.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      assert.match(shortDate('2026-07-06', 'en-US'), /Jul\s*6/);
      process.env.TZ = 'Pacific/Kiritimati';
      assert.match(shortDate('2026-07-06', 'en-US'), /Jul\s*6/);
    } finally {
      process.env.TZ = original;
    }
  });

  test('returns an empty string rather than "Invalid Date"', () => {
    for (const bad of [null, undefined, '', 'yesterday', '2026-13-45', 42]) {
      assert.equal(shortDate(bad, 'en-US'), '');
    }
  });
});

describe('x axis labels', () => {
  const pts = topSetPerDay(
    [log({ date: '2026-08-01' }), log({ date: '2026-08-04' }), log({ date: '2026-08-07' })],
    'squat',
  );

  test('labels only the ends, not every point', () => {
    // A date under every point is unreadable at 340px and adds nothing the
    // shape of the line does not already say.
    const { xLabels } = buildChart(pts);
    assert.equal(xLabels.length, 2);
    assert.deepEqual(xLabels.map((l) => l.date), ['2026-08-01', '2026-08-07']);
  });

  test('the end labels are anchored inward so they cannot overflow the frame', () => {
    const { xLabels } = buildChart(pts);
    assert.equal(xLabels[0].anchor, 'start');
    assert.equal(xLabels[1].anchor, 'end');
  });

  test('a single session gets one centred label rather than two identical ones', () => {
    const { xLabels } = buildChart(pts.slice(0, 1));
    assert.equal(xLabels.length, 1);
    assert.equal(xLabels[0].anchor, 'middle');
  });

  test('an empty series has no labels and does not throw', () => {
    assert.deepEqual(buildChart([]).xLabels, []);
  });
});

describe('trend', () => {
  test('reports direction and size against the first session', () => {
    const points = topSetPerDay([log({ date: '2026-08-01', weight: 225 }), log({ date: '2026-08-08', weight: 245 })], 'squat');
    assert.deepEqual(trend(points), { direction: 'up', change: 20, from: 225, to: 245 });
  });

  test('a single session has no trend rather than a trend of zero', () => {
    // "Flat" and "we cannot say yet" are different claims.
    assert.equal(trend([{ weight: 225 }]).direction, 'none');
    assert.equal(trend([]).direction, 'none');
  });
});

describe('the decisions this chart is built on', () => {
  test('no charting library was added', () => {
    // Recharts and friends each cost >100KB on a bundle already at 460KB, and a
    // seventh entry on a dependency list verify-frontend-deps.mjs exists to keep
    // short. Four line charts is a few dozen lines of SVG.
    const pkg = JSON.parse(deps);
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      assert.doesNotMatch(name, /chart|recharts|d3|victory|nivo|plotly|echarts/i, `${name} is a charting library`);
    }
  });

  test('each lift gets its own chart rather than sharing one axis', () => {
    // A deadlift at 405 and a press at 95 do not share a scale usefully, and
    // two y-axes make the crossing point an artefact of axis placement.
    assert.match(page, /chart-grid-layout/);
    assert.match(page, /series\.map/);
  });

  test('a missed set differs by shape, not only by colour', () => {
    // Colour alone must never carry the one distinction that changes what the
    // chart means - and red/green fails CVD separation at deltaE 2.7 anyway.
    assert.match(css, /\.chart-dot-missed\s*\{[^}]*fill:\s*var\(--surface\)/s);
    assert.match(chart, /chart-dot-missed/);
  });

  test('dark mode gets its own validated steps, not an automatic flip', () => {
    assert.match(css, /--chart-line:\s*#3987e5/);
    assert.match(css, /prefers-color-scheme:\s*light[^}]*\}[\s\S]*?--chart-line:\s*#2a78d6/);
  });

  test('the numbers are reachable as text, not only as pixels', () => {
    assert.match(page, /data-table/);
    assert.match(page, /showTable/);
  });

  test('the chart carries an accessible name', () => {
    assert.match(chart, /role="img"/);
    assert.match(chart, /aria-label/);
  });

  test('the endpoint feeding the charts returns whether the set was completed', () => {
    // The regression this guards: /sessions/progress predated migration 0016
    // and selected five columns, none of them `completed`. Charts drawn from
    // that show an unbroken climb straight through a stall.
    // lastIndexOf, not indexOf: the first match is the INSERT in POST, and
    // asserting against the wrong statement is how a test passes while the
    // thing it names stays broken.
    const at = sessions.lastIndexOf("from('progress_logs')");
    const select = sessions.slice(at, at + 500);
    assert.match(select, /completed/, 'the progress query must return completed');
  });
});

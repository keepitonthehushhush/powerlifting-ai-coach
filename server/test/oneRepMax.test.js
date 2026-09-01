import test from 'node:test';
import assert from 'node:assert/strict';

import {
  epley,
  brzycki,
  estimateOneRepMax,
  oneRepMaxSeries,
  RELIABLE_REP_LIMIT,
  EQUATIONS_CROSS_AT_REPS,
} from '../../web/src/lib/oneRepMax.js';

const near = (a, b, tolerance = 0.05) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

/**
 * The equations, pinned to their published form rather than to whatever the
 * code currently returns. A transcribed constant is the kind of thing that is
 * wrong by 3% forever and looks plausible on every chart.
 */
test('the equations match their published definitions', () => {
  // Epley 1985: 1RM = w(1 + r/30). 100 kg x 5 -> 100 * (1 + 5/30).
  near(epley(100, 5), 116.667);
  near(epley(100, 1), 103.333);
  // Brzycki 1993: 1RM = w / (1.0278 - 0.0278r). 100 kg x 5.
  near(brzycki(100, 5), 100 / (1.0278 - 0.139));
  near(brzycki(100, 10), 100 / (1.0278 - 0.278));
});

/**
 * The property the design rests on, and the limit of it.
 *
 * Brzycki reads low ONLY below the crossover. This test asserts both halves,
 * because the first draft asserted the first half across the whole range and
 * failed at ten reps - which is how the crossover was found at all.
 */
test('Brzycki reads low below the crossover and high above it', () => {
  for (let reps = 2; reps <= RELIABLE_REP_LIMIT; reps += 1) {
    assert.ok(
      brzycki(100, reps) < epley(100, reps),
      `at ${reps} reps Brzycki was not below Epley, inside the charted range`,
    );
  }
  // And past it the order genuinely reverses, which is why nothing assumes it.
  assert.ok(brzycki(100, 12) > epley(100, 12));
});

test('the crossover is where the constants say it is', () => {
  const at = EQUATIONS_CROSS_AT_REPS;
  const gapJustBelow = epley(100, at - 0.5) - brzycki(100, at - 0.5);
  const gapJustAbove = epley(100, at + 0.5) - brzycki(100, at + 0.5);
  assert.ok(gapJustBelow > 0, 'Epley should still be higher just below the crossover');
  assert.ok(gapJustAbove < 0, 'Epley should be lower just above the crossover');
  // Tight enough that retyping a constant in either equation moves it out.
  assert.ok(Math.abs(epley(100, at) - brzycki(100, at)) < 0.01);
});

/**
 * The trap this whole limit exists to avoid.
 *
 * If the band were ever read as a confidence interval, ten reps would look
 * like the most certain estimate in the app when it is the least. Asserting
 * the collapse keeps the reason visible.
 */
test('the band collapses at the crossover, which is why the limit is below it', () => {
  const width = (reps) => {
    const e = estimateOneRepMax(100, reps);
    return e.high - e.low;
  };
  assert.ok(width(10) < 0.1, `expected the band to nearly vanish at ten reps, got ${width(10)}`);
  assert.ok(width(RELIABLE_REP_LIMIT) > 2, 'the widest charted set must still have a real band');
  assert.equal(RELIABLE_REP_LIMIT < EQUATIONS_CROSS_AT_REPS, true);
});

test('a single is a measurement, not an estimate, so it has no width', () => {
  const one = estimateOneRepMax(180, 1);
  assert.equal(one.low, 180);
  assert.equal(one.high, 180);
  assert.equal(one.mid, 180);
  assert.equal(one.reliable, true);
});

test('the band is widest in the middle of the charted range, not at its end', () => {
  // Peaks around four reps and narrows toward the crossover. Recorded because
  // it is the shape that proves the width is formula disagreement rather than
  // uncertainty, which would only grow.
  const width = (reps) => {
    const e = estimateOneRepMax(100, reps);
    return e.high - e.low;
  };
  assert.ok(width(4) > width(2));
  assert.ok(width(4) > width(8));
});

test('past the reliable limit the estimate is offered but flagged, not silently used', () => {
  assert.equal(estimateOneRepMax(100, RELIABLE_REP_LIMIT).reliable, true);
  assert.equal(estimateOneRepMax(100, RELIABLE_REP_LIMIT + 1).reliable, false);
});

/**
 * Brzycki's denominator reaches zero at about 37 reps. Past that it returns a
 * NEGATIVE number, which would plot as a max below the floor of the chart and
 * look like a data-entry mistake rather than a formula leaving its range.
 */
test('Brzycki is guarded where it diverges rather than trusted', () => {
  assert.equal(brzycki(100, 37), null);
  assert.equal(brzycki(100, 50), null);
  // And the estimator degrades to the one equation that still works, flagged.
  const wild = estimateOneRepMax(100, 40);
  assert.equal(wild.reliable, false);
  assert.ok(wild.low > 0, 'a set of 40 must not produce a negative estimate');
});

test('nonsense produces nothing rather than a confident number', () => {
  for (const [w, r] of [[0, 5], [-100, 5], [100, 0], [100, -3], [NaN, 5], [100, NaN], [null, null]]) {
    assert.equal(estimateOneRepMax(w, r), null, `${w} x ${r} should not estimate`);
  }
});

/**
 * The reason this is not the weight chart with different numbers.
 */
test('the heaviest set is not always the best estimate, and the series knows it', () => {
  const logs = [
    { lift: 'squat', date: '2026-08-01', weight: 110, reps: 1, completed: true },
    { lift: 'squat', date: '2026-08-01', weight: 100, reps: 5, completed: true },
  ];
  const series = oneRepMaxSeries(logs, 'squat');
  assert.equal(series.length, 1);
  // 100x5 predicts ~113-117; 110x1 is exactly 110. The five wins.
  assert.ok(series[0].mid > 110, `expected the set of five to win, got ${series[0].mid}`);
  assert.equal(series[0].weight, 100);
  assert.equal(series[0].reps, 5);
});

test('a failed set is evidence about the day, not about the ceiling', () => {
  const logs = [
    { lift: 'squat', date: '2026-08-02', weight: 200, reps: 5, completed: false },
    { lift: 'squat', date: '2026-08-02', weight: 100, reps: 5, completed: true },
  ];
  const series = oneRepMaxSeries(logs, 'squat');
  assert.equal(series.length, 1);
  assert.equal(series[0].weight, 100);
});

test('unreliable sets are left out entirely rather than charted quietly', () => {
  const logs = [{ lift: 'squat', date: '2026-08-03', weight: 60, reps: 20, completed: true }];
  assert.deepEqual(oneRepMaxSeries(logs, 'squat'), []);
});

test('the series is per lift, dated, and in order', () => {
  const logs = [
    { lift: 'bench', date: '2026-08-03', weight: 80, reps: 3, completed: true },
    { lift: 'squat', date: '2026-08-03', weight: 140, reps: 3, completed: true },
    { lift: 'squat', date: '2026-08-01', weight: 130, reps: 3, completed: true },
  ];
  const squat = oneRepMaxSeries(logs, 'squat');
  assert.deepEqual(squat.map((p) => p.date), ['2026-08-01', '2026-08-03']);
  assert.equal(oneRepMaxSeries(logs, 'bench').length, 1);
  assert.deepEqual(oneRepMaxSeries(logs, 'deadlift'), []);
});

test('rows with no weight do not become sets at zero', () => {
  const logs = [
    { lift: 'squat', date: '2026-08-04', weight: null, reps: 5, completed: true },
    { lift: 'squat', date: '2026-08-04', weight: '', reps: 5, completed: true },
  ];
  assert.deepEqual(oneRepMaxSeries(logs, 'squat'), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BAR_WEIGHT,
  COLLAR_WEIGHT,
  PLATE_DENOMINATIONS,
  PLATE_COLORS,
  LOADOUT_STATUS,
  loadBarbell,
  tallyPlates,
  greedyMinimalityReport,
} from '../../web/src/lib/plates.js';

import { BAR } from '../src/lib/progression.js';

/**
 * The load-bearing test. Everything else here checks a behavior; this one
 * checks the ANSWER - that the plates named actually add up to the weight
 * asked for. A plate calculator that is confidently wrong is worse than none,
 * because the athlete will believe it and load the bar.
 */
function rebuild(result) {
  const platesBothSides = result.plates.reduce((sum, p) => sum + p, 0) * 2;
  return Math.round((result.barTotal + platesBothSides) * 100) / 100;
}

test('every loadable answer rebuilds to exactly the weight asked for', () => {
  for (const units of ['kg', 'lb']) {
    const step = units === 'kg' ? 0.25 : 2.5;
    const bar = BAR_WEIGHT[units] + COLLAR_WEIGHT[units] * 2;
    for (let w = bar; w <= bar + 400; w = Math.round((w + step) * 100) / 100) {
      const r = loadBarbell(w, { units });
      if (r.status !== LOADOUT_STATUS.loadable) continue;
      assert.equal(rebuild(r), r.total, `${w} ${units} did not rebuild`);
    }
  }
});

test('a remainder is reported rather than silently rounded away', () => {
  // 1 lb per side cannot be made from a set whose smallest plate is 2.5.
  const r = loadBarbell(47, { units: 'lb' });
  assert.equal(r.status, LOADOUT_STATUS.remainder);
  assert.equal(r.perSide, 1);
  assert.deepEqual(r.plates, []);
  assert.equal(r.remainder, 1);
  assert.equal(r.nearestLoadable, 45);
});

test('the nearest loadable weight is always loadable', () => {
  for (const units of ['kg', 'lb']) {
    for (let w = 0; w <= 500; w += 0.5) {
      const r = loadBarbell(w, { units });
      if (r.nearestLoadable === null) continue;
      const again = loadBarbell(r.nearestLoadable, { units });
      assert.equal(
        again.status,
        LOADOUT_STATUS.loadable,
        `nearestLoadable ${r.nearestLoadable} for ${w} ${units} was not itself loadable`,
      );
    }
  }
});

test('below the bar is its own answer, not an empty loadable one', () => {
  const r = loadBarbell(10, { units: 'kg' });
  assert.equal(r.status, LOADOUT_STATUS.belowBar);
  assert.equal(r.barTotal, 25);
  assert.deepEqual(r.plates, []);
});

test('an empty competition bar is 25 kg, not 20', () => {
  // The collars are 2.5 kg each and are always used. A kg bar that reports 20
  // is wrong on the platform, and wrong by exactly one plate change.
  const r = loadBarbell(25, { units: 'kg' });
  assert.equal(r.status, LOADOUT_STATUS.loadable);
  assert.deepEqual(r.plates, []);
  assert.equal(rebuild(r), 25);
});

test('pound bars carry no collar weight', () => {
  assert.equal(COLLAR_WEIGHT.lb, 0);
  const r = loadBarbell(45, { units: 'lb' });
  assert.equal(r.status, LOADOUT_STATUS.loadable);
  assert.deepEqual(r.plates, []);
});

test('plates come back heaviest first, which is the order they go on', () => {
  const r = loadBarbell(160, { units: 'kg' });
  assert.deepEqual(r.plates, [25, 25, 15, 2.5]);
  const sorted = r.plates.slice().sort((a, b) => b - a);
  assert.deepEqual(r.plates, sorted);
});

test('a gym that stocks fewer plates gets a different, honest answer', () => {
  // Only 45s and 25s. 315 lb is three 45s a side and still works.
  const rich = loadBarbell(315, { units: 'lb' });
  assert.deepEqual(rich.plates, [45, 45, 45]);

  const sparse = loadBarbell(315, { units: 'lb', available: [45, 25] });
  assert.equal(sparse.status, LOADOUT_STATUS.loadable);
  assert.equal(rebuild(sparse), 315);

  // 300 lb needs 127.5 a side; with only 45s and 25s that is not reachable.
  const stuck = loadBarbell(300, { units: 'lb', available: [45, 25] });
  assert.equal(stuck.status, LOADOUT_STATUS.remainder);
  assert.ok(stuck.nearestLoadable < 300);
  assert.equal(loadBarbell(stuck.nearestLoadable, { units: 'lb', available: [45, 25] }).status,
    LOADOUT_STATUS.loadable);
});

test('greedy is minimal for kilograms - measured, not assumed', () => {
  const report = greedyMinimalityReport(PLATE_DENOMINATIONS.kg);
  assert.equal(report.minimal, true, 'kg set stopped being greedy-minimal');
  assert.deepEqual(report.counterexamples, []);
});

test('greedy is NOT minimal for pounds, at exactly two weights, and we know which', () => {
  // This is not a bug, it is the 35 lb plate. Loading 165 lb as 45+10+5 uses one
  // more plate than 35+25 and is what every lifter in the room actually does.
  // Pinned exactly so that adding or removing a denomination shows up here as a
  // changed list rather than as a silent shift in what the app tells people.
  const report = greedyMinimalityReport(PLATE_DENOMINATIONS.lb);
  assert.equal(report.minimal, false);
  assert.deepEqual(report.counterexamples, [
    { perSide: 60, greedy: 3, fewest: 2 },
    { perSide: 62.5, greedy: 4, fewest: 3 },
  ]);

  // And the loadout at that weight is the greedy one, deliberately.
  assert.deepEqual(loadBarbell(165, { units: 'lb' }).plates, [45, 10, 5]);
});

test('drop the 35 and pounds becomes minimal too - the plate is the cause', () => {
  const report = greedyMinimalityReport([45, 25, 10, 5, 2.5]);
  assert.equal(report.minimal, true);
});

test('the minimality check can fail, and catches the classic counterexample', () => {
  // [4, 3, 1] makes 6 as 4+1+1 greedily and 3+3 optimally. If this ever passes,
  // the check has stopped checking.
  const report = greedyMinimalityReport([4, 3, 1]);
  assert.equal(report.minimal, false);
  assert.ok(report.counterexamples.some((c) => c.perSide === 6 && c.greedy === 3 && c.fewest === 2));
});

test('the bar weight here agrees with the one progression.js prescribes against', () => {
  assert.deepEqual({ ...BAR_WEIGHT }, { ...BAR });
});

test('plate colors claim IPF authority only where the rulebook grants it', () => {
  // The rulebook mandates 25 red, 20 blue, 15 yellow and says "any color"
  // below that. Anything marked mandated:true is a claim about a published
  // rule, so the set of such claims is pinned exactly.
  const mandated = Object.entries(PLATE_COLORS.kg)
    .filter(([, v]) => v.mandated)
    .map(([k]) => Number(k))
    .sort((a, b) => b - a);
  assert.deepEqual(mandated, [25, 20, 15]);
  assert.equal(PLATE_COLORS.kg[25].name, 'red');
  assert.equal(PLATE_COLORS.kg[20].name, 'blue');
  assert.equal(PLATE_COLORS.kg[15].name, 'yellow');

  // There is no standard for pound plates, so we assert none exists rather
  // than inventing one.
  assert.deepEqual(PLATE_COLORS.lb, {});
});

test('every colored plate is a plate we actually stock', () => {
  for (const key of Object.keys(PLATE_COLORS.kg)) {
    assert.ok(
      PLATE_DENOMINATIONS.kg.includes(Number(key)),
      `${key} kg has a color but is not in the denominations`,
    );
  }
});

test('tallyPlates says it the way a person says it', () => {
  assert.deepEqual(tallyPlates([25, 25, 15, 2.5]), [
    { plate: 25, count: 2 },
    { plate: 15, count: 1 },
    { plate: 2.5, count: 1 },
  ]);
  assert.deepEqual(tallyPlates([]), []);
});

test('nonsense in does not produce a confident answer out', () => {
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, 'heavy']) {
    const r = loadBarbell(bad, { units: 'kg' });
    assert.equal(r.status, LOADOUT_STATUS.belowBar);
    assert.deepEqual(r.plates, []);
  }
  assert.equal(loadBarbell(NaN, { units: 'kg' }).nearestLoadable, null);
});

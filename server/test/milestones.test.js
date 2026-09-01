import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import {
  MILESTONES,
  MILESTONE_LIFTS,
  milestoneProgress,
  bestCompleted,
} from '../../web/src/lib/milestones.js';
import { BAR_WEIGHT, COLLAR_WEIGHT } from '../../web/src/lib/plates.js';
import { computeAchievements } from '../src/lib/achievements.js';

const component = await readFile(new URL('../../web/src/components/MilestoneStack.jsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../../web/src/pages/Progress.jsx', import.meta.url), 'utf8');
const stylesheet = await readFile(new URL('../../web/src/styles.css', import.meta.url), 'utf8');

test('the milestone table is one table, read by both sides', async () => {
  // Two copies of one fact is how gender and glp1_status got left out of the
  // withdrawal path for four months. The server now imports this one.
  const achievements = await readFile(new URL('../src/lib/achievements.js', import.meta.url), 'utf8');
  assert.match(achievements, /import \{ MILESTONES \} from '\.\.\/\.\.\/\.\.\/web\/src\/lib\/milestones\.js'/);
  assert.doesNotMatch(achievements, /^const MILESTONES = \{/m, 'the server declared its own copy again');

  // And the shared table still drives the awards, which is the behavior that
  // would break silently if the import resolved to something empty.
  const earned = computeAchievements({
    logs: [{ lift: 'squat', weight: 315, reps: 1, completed: true, date: '2026-07-01' }],
    profile: { units: 'lb' },
  });
  const milestones = earned.filter((e) => e.kind === 'milestone').map((e) => e.detail.weight);
  assert.deepEqual(milestones.sort((a, b) => a - b), [135, 225, 315]);
});

test('every milestone table is ascending, in both units, for every lift', () => {
  for (const lift of MILESTONE_LIFTS) {
    for (const unit of ['lb', 'kg']) {
      const table = MILESTONES[lift][unit];
      assert.ok(table.length > 0, `${lift}/${unit} is empty`);
      for (let i = 1; i < table.length; i += 1) {
        assert.ok(table[i] > table[i - 1], `${lift}/${unit} is not ascending at index ${i}`);
      }
      // Every milestone must be above an empty bar, or the first one is met by
      // walking up to the rack.
      assert.ok(table[0] > BAR_WEIGHT[unit] + COLLAR_WEIGHT[unit] * 2, `${lift}/${unit} starts at or below the bar`);
    }
  }
});

/**
 * The measurement decision the whole feature rests on.
 */
test('progress is measured from the LAST milestone hit, not from zero', () => {
  // 315 reached, 405 next. Measured from zero, 350 looks 86% done and the last
  // stretch stops being visible at all. Measured from 315 it is 39%.
  const p = milestoneProgress(350, 'squat', 'lb');
  assert.equal(p.floor, 315);
  assert.equal(p.target, 405);
  assert.equal(p.remaining, 55);
  assert.ok(Math.abs(p.fraction - 35 / 90) < 1e-9, `fraction was ${p.fraction}`);
  assert.ok(p.fraction < 0.5, 'measured from zero by mistake');
});

test('before the first milestone the floor is the empty bar, not zero', () => {
  const p = milestoneProgress(100, 'squat', 'lb');
  assert.equal(p.floor, BAR_WEIGHT.lb + COLLAR_WEIGHT.lb * 2);
  assert.equal(p.target, 135);
  // A pound bar carries no collar weight, so this is 45.
  assert.equal(p.floor, 45);
  assert.ok(p.fraction > 0.5 && p.fraction < 1);
});

test('a kilogram lifter is measured against the kilogram table', () => {
  const p = milestoneProgress(90, 'squat', 'kg');
  assert.equal(p.floor, 60);
  assert.equal(p.target, 100);
  assert.equal(p.remaining, 10);
  // The empty competition bar is 25 kg, so a beginner's floor is 25 not 20.
  assert.equal(milestoneProgress(30, 'squat', 'kg').floor, 25);
});

test('passing every milestone is said, not answered with an invented sixth one', () => {
  const p = milestoneProgress(600, 'squat', 'lb');
  assert.equal(p.complete, true);
  assert.equal(p.target, null, 'a target was invented past the end of the table');
  assert.equal(p.remaining, null);
  assert.equal(p.fraction, 1);
  assert.deepEqual(p.reached, MILESTONES.squat.lb);
});

test('landing exactly on a milestone counts it and moves to the next', () => {
  const p = milestoneProgress(315, 'squat', 'lb');
  assert.equal(p.floor, 315, 'an exactly-hit milestone was not counted');
  assert.equal(p.target, 405);
  assert.equal(p.fraction, 0);
});

test('nonsense produces nothing rather than a bar at a strange position', () => {
  for (const bad of [0, -100, NaN, null, undefined, 'heavy', Infinity]) {
    assert.equal(milestoneProgress(bad, 'squat', 'lb'), null, `${bad} produced a progress object`);
  }
  assert.equal(milestoneProgress(200, 'press', 'lb'), null, 'the press has no table and must not fake one');
  assert.equal(milestoneProgress(200, 'not a lift', 'lb'), null);
});

test('the fraction never leaves the track', () => {
  for (const lift of MILESTONE_LIFTS) {
    for (const unit of ['lb', 'kg']) {
      for (let w = 1; w <= 700; w += 1) {
        const p = milestoneProgress(w, lift, unit);
        if (!p) continue;
        assert.ok(p.fraction >= 0 && p.fraction <= 1, `${lift}/${unit} at ${w} gave ${p.fraction}`);
      }
    }
  }
});

/**
 * A milestone is a thing you stood up with. The single rule this feature must
 * not break.
 */
test('a failed rep never earns a plate', () => {
  const logs = [
    { lift: 'squat', weight: 405, reps: 1, completed: false },
    { lift: 'squat', weight: 315, reps: 1, completed: true },
  ];
  assert.equal(bestCompleted(logs, 'squat'), 315);
  assert.equal(milestoneProgress(bestCompleted(logs, 'squat'), 'squat', 'lb').floor, 315);
});

test('bestCompleted ignores other lifts, missing weights and junk', () => {
  assert.equal(bestCompleted([{ lift: 'bench', weight: 500, completed: true }], 'squat'), null);
  assert.equal(bestCompleted([{ lift: 'squat', weight: null, completed: true }], 'squat'), null);
  assert.equal(bestCompleted([{ lift: 'squat', weight: 'x', completed: true }], 'squat'), null);
  assert.equal(bestCompleted(null, 'squat'), null);
  assert.equal(bestCompleted([{ lift: 'squat', weight: 0, completed: true }], 'squat'), null);
});

/**
 * A full stack must mean one thing. Rounding up would show a complete stack to
 * somebody who has not hit the number.
 */
test('the stack is never full until the milestone actually is', () => {
  assert.match(component, /Math\.min\(SEGMENTS - 1, Math\.floor\(/);
  // And the complete state is a different branch, so the only full stack is a
  // reached one.
  assert.match(component, /progress\.complete/);
});

test('the stack does not borrow the IPF plate colors for something else', () => {
  const rules = [...stylesheet.matchAll(/^\.milestone[^{]*\{[^}]*\}/gms)].join('\n');
  assert.ok(rules.length > 0, 'no milestone rules found');
  assert.doesNotMatch(rules, /--plate-/, 'a milestone segment is painted with a plate color');
  // Every class the component uses exists. Both quote styles and multi-class
  // strings, because className={cond ? 'a b' : 'a'} is how the disc is written
  // and a regex that only reads single-quoted single classes finds two of five.
  const classes = [...component.matchAll(/className=(?:"([^"]+)"|\{[^}]*?'([^']+)')/g)]
    .flatMap((m) => (m[1] ?? m[2] ?? '').split(/\s+/))
    .filter((c) => c.startsWith('milestone'));
  assert.ok(classes.length >= 4, `found only ${classes.length} milestone classes in the component`);
  for (const cls of new Set(classes)) {
    assert.ok(new RegExp(`\\.${cls}[\\s,{]`).test(stylesheet), `.${cls} is used and undefined`);
  }
});

test('the page renders it against completed lifts, not against the estimate', () => {
  assert.match(page, /from '\.\.\/components\/MilestoneStack\.jsx'/);
  assert.match(page, /<MilestoneStack/);
  assert.match(page, /bestCompleted\(/);
  // The estimate must not be what fills the stack.
  const memo = page.slice(page.indexOf('const milestones = useMemo'), page.indexOf('}, [logs, units]);'));
  assert.doesNotMatch(memo, /oneRepMaxSeries|estimates/, 'the milestone stack is filled from an estimate');
});

test('the reason the interval starts where it does is written down', () => {
  const source = readFileSync(new URL('../../web/src/lib/milestones.js', import.meta.url), 'utf8');
  assert.match(source, /goal-gradient/i);
  assert.match(source, /10 days against 15|median 10 days/i);
  assert.match(source, /not a trick/i);
});

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASIS, LOAD, diffPrograms } from '../src/lib/programDiff.js';
import { prescribeAll } from '../src/lib/progression.js';
import { readSource } from './helpers/source.js';

const source = readSource(new URL('../src/lib/programDiff.js', import.meta.url));

/**
 * WHAT CHANGED BETWEEN ONE BLOCK AND THE NEXT.
 *
 * ── WHY THIS IS TESTED HARDER THAN IT LOOKS ───────────────────────────────
 *
 * Every failure mode here produces a sentence rather than an error, and the
 * sentence is shown to an athlete about their own training. "Your squat came
 * down 10 lb" is either a fact they need or an accusation the data does not
 * support, and nothing downstream can tell which.
 *
 * The specific trap is a lift prescribed twice in a week. Intermediate
 * programming is SUPPOSED to have a heavy day and a light day on the same
 * movement - that is what the whole phase change is for - so a diff keyed by
 * lift name that keeps one weight reports a correct light day as a deload.
 */

const day = (name, exercises) => ({ name, exercises });
const ex = (lift, sets, reps, weight) => ({ lift, sets, reps, weight });

const novice = (weight) => ({
  phase: 'novice',
  week: 1,
  days: [day('Day A', [ex('Squat', 3, 5, weight), ex('Bench press', 3, 5, 135)])],
});

describe('the plain cases', () => {
  test('a load that went up is reported as up, with a signed delta', () => {
    const d = diffPrograms({ previous: novice(225), next: novice(235) });
    const squat = d.changed.find((c) => c.key === 'squat');
    assert.equal(squat.load, LOAD.UP);
    assert.equal(squat.delta, 10);
    assert.equal(squat.from.weight, 225);
    assert.equal(squat.to.weight, 235);
  });

  test('a load that came down carries a negative delta, not an absolute one', () => {
    // Signed, so no caller ever has to subtract and get the sign backwards on
    // a number an athlete reads about their own squat.
    const d = diffPrograms({ previous: novice(225), next: novice(205) });
    assert.equal(d.changed.find((c) => c.key === 'squat').delta, -20);
    assert.equal(d.changed.find((c) => c.key === 'squat').load, LOAD.DOWN);
  });

  test('a lift at the same weight, sets and reps is not a change', () => {
    const d = diffPrograms({ previous: novice(225), next: novice(225) });
    assert.equal(d.changed.length, 0);
    assert.equal(d.unchanged.length, 2);
    assert.equal(d.identical, true);
  });

  test('two identical blocks say so rather than rendering nothing', () => {
    /*
     * "Your program is the same as last week" is a real and sometimes correct
     * answer. A caller handed an empty diff has to decide whether that means
     * unchanged or broken, and it will guess wrong at least once.
     */
    assert.equal(diffPrograms({ previous: novice(225), next: novice(225) }).identical, true);
    assert.equal(diffPrograms({ previous: novice(225), next: novice(235) }).identical, false);
  });

  test('same weight but more sets is still a change', () => {
    const previous = novice(225);
    const next = { ...novice(225), days: [day('Day A', [ex('Squat', 5, 5, 225), ex('Bench press', 3, 5, 135)])] };
    const squat = diffPrograms({ previous, next }).changed.find((c) => c.key === 'squat');
    assert.equal(squat.load, LOAD.SAME);
    assert.equal(squat.setsRepsChanged, true);
  });

  test('exercises appearing and disappearing are named', () => {
    const next = {
      phase: 'novice',
      week: 2,
      days: [day('Day A', [ex('Squat', 3, 5, 225), ex('Overhead press', 3, 5, 95)])],
    };
    const d = diffPrograms({ previous: novice(225), next });
    assert.deepEqual(d.added.map((a) => a.key), ['press']);
    assert.deepEqual(d.removed.map((r) => r.key), ['bench']);
  });

  test('phase, week and day count are reported when they move and not when they do not', () => {
    const previous = novice(225);
    const next = { ...novice(225), phase: 'intermediate', week: 12 };
    const d = diffPrograms({ previous, next });
    assert.deepEqual(d.phase, { from: 'novice', to: 'intermediate' });
    assert.deepEqual(d.week, { from: 1, to: 12 });
    assert.equal(d.days, null);
  });

  test('nothing to compare is null, not an empty diff', () => {
    assert.equal(diffPrograms({ previous: null, next: novice(225) }), null);
    assert.equal(diffPrograms({ previous: novice(225), next: null }), null);
    assert.equal(diffPrograms({ previous: { days: [] }, next: novice(225) }), null);
  });
});

describe('a lift prescribed more than once in a week', () => {
  /*
   * The failure this section exists for. A heavy day and a light day on the
   * same movement is the SHAPE of intermediate programming, so a diff that
   * keeps one weight per lift reports a correct light day as a ten percent
   * deload on the page the athlete reads.
   */
  const heavyLight = (heavy, light) => ({
    phase: 'intermediate',
    week: 10,
    days: [
      day('Monday', [ex('Squat', 3, 5, heavy)]),
      day('Thursday', [ex('Squat', 3, 5, light)]),
    ],
  });

  test('the light day does not become the reported load', () => {
    const d = diffPrograms({ previous: heavyLight(315, 275), next: heavyLight(325, 285) });
    const squat = d.changed.find((c) => c.key === 'squat');
    assert.equal(squat.from.weight, 315, 'the previous block was read as its light day');
    assert.equal(squat.to.weight, 325, 'the new block was read as its light day');
    assert.equal(squat.delta, 10);
  });

  test('and the comparison says which prescription it used', () => {
    const d = diffPrograms({ previous: heavyLight(315, 275), next: heavyLight(325, 285) });
    assert.equal(d.changed.find((c) => c.key === 'squat').comparedOnHeaviest, true);
  });

  test('a single prescription each side does not claim to have chosen', () => {
    const d = diffPrograms({ previous: novice(225), next: novice(235) });
    assert.equal(d.changed.find((c) => c.key === 'squat').comparedOnHeaviest, false);
  });

  test('going from one squat day a week to two is reported as such', () => {
    const d = diffPrograms({ previous: novice(225), next: heavyLight(225, 185) });
    const squat = d.changed.find((c) => c.key === 'squat');
    assert.deepEqual(squat.timesPerWeek, { from: 1, to: 2 });
  });

  test('day names are free text, so the pairing does not depend on them', () => {
    /*
     * The model writes the day names. Keying on (day, lift) would unpair every
     * exercise in the week the first time "Day A" became "Monday" and report
     * an entire program replaced - added: everything, removed: everything.
     */
    const previous = { phase: 'novice', week: 1, days: [day('Day A', [ex('Squat', 3, 5, 225)])] };
    const next = { phase: 'novice', week: 2, days: [day('Monday', [ex('Squat', 3, 5, 235)])] };
    const d = diffPrograms({ previous, next });
    assert.equal(d.added.length, 0);
    assert.equal(d.removed.length, 0);
    assert.equal(d.changed.find((c) => c.key === 'squat').delta, 10);
  });

  test('a lift named differently but canonically the same is one lift', () => {
    // canonicalLift() is an exact-match table, not substring matching - the
    // same table that exists because /\bsquat\b/ once matched an injected
    // instruction. "Back squat" and "Squat" are the same movement here.
    const previous = { phase: 'novice', week: 1, days: [day('A', [ex('Back squat', 3, 5, 225)])] };
    const next = { phase: 'novice', week: 2, days: [day('A', [ex('Squat', 3, 5, 235)])] };
    const d = diffPrograms({ previous, next });
    assert.equal(d.added.length, 0, 'a rename was read as a new exercise');
    assert.equal(d.changed.find((c) => c.key === 'squat').delta, 10);
  });
});

describe('a weight that is not a number', () => {
  test('bodyweight work is not a load of zero', () => {
    /*
     * `weight` is nullable on purpose: "bodyweight" and "the empty bar" are
     * real answers. A null read as 0 turns adding chin-ups into "your load
     * went down 225 lb", and it would look like arithmetic.
     */
    const previous = { phase: 'novice', week: 1, days: [day('A', [ex('Chin-up', 3, 8, null)])] };
    const next = { phase: 'novice', week: 2, days: [day('A', [ex('Chin-up', 4, 8, null)])] };
    const chin = diffPrograms({ previous, next }).changed[0];
    assert.equal(chin.load, null, 'a missing weight was compared as a number');
    assert.equal(chin.delta, null);
    assert.equal(chin.setsRepsChanged, true);
  });

  test('an unweighted movement that did not move is unchanged, not changed', () => {
    /*
     * FOUND BY RUNNING THIS AGAINST THE REAL DATABASE, not by a fixture. A
     * real program carries accessories - side planks, broad jumps, a push-up
     * finisher - with `weight: null` on both sides. `load` is then null, which
     * is not SAME, so an `if (load !== SAME)` classification put every one of
     * them in `changed`, and the page would have listed seven movements under
     * "what changed" with nothing visibly different beside any of them.
     *
     * Seven confident lines about nothing is worse than no section at all: it
     * teaches the athlete that the section is noise, which is exactly what it
     * must not be.
     */
    const same = {
      phase: 'novice',
      week: 1,
      days: [day('A', [ex('Side plank', 3, 30, null), ex('Broad jump', 3, 5, null)])],
    };
    const next = { ...same, week: 2 };
    const d = diffPrograms({ previous: same, next });
    assert.equal(d.changed.length, 0, `nothing moved and ${d.changed.length} movement(s) were reported as changed`);
    assert.equal(d.unchanged.length, 2);
  });

  test('a weight arriving is a change, even though the two are uncomparable', () => {
    // Null is not one state. Putting 25 lb on the chin-ups is exactly the kind
    // of change worth a line, and it has no delta to show.
    const previous = { phase: 'novice', week: 1, days: [day('A', [ex('Chin-up', 3, 8, null)])] };
    const next = { phase: 'novice', week: 2, days: [day('A', [ex('Chin-up', 3, 8, 25)])] };
    assert.equal(diffPrograms({ previous, next }).changed.length, 1);
    assert.equal(diffPrograms({ previous: next, next: previous }).changed.length, 1);
  });

  test('an unweighted movement prescribed twice does not claim a heaviest', () => {
    // "Compared on the heaviest" says nothing about two identical sets of side
    // planks. A note that explains nothing is noise on a page read standing up.
    const previous = {
      phase: 'novice', week: 1,
      days: [day('A', [ex('Side plank', 3, 30, null)]), day('B', [ex('Side plank', 3, 30, null)])],
    };
    const next = {
      phase: 'novice', week: 2,
      days: [day('A', [ex('Side plank', 4, 30, null)]), day('B', [ex('Side plank', 4, 30, null)])],
    };
    assert.equal(diffPrograms({ previous, next }).changed[0].comparedOnHeaviest, false);
  });

  test('a weight arriving and a weight leaving are both uncomparable, not a move', () => {
    const previous = { phase: 'novice', week: 1, days: [day('A', [ex('Chin-up', 3, 8, null)])] };
    const next = { phase: 'novice', week: 2, days: [day('A', [ex('Chin-up', 3, 8, 25)])] };
    assert.equal(diffPrograms({ previous, next }).changed[0].load, null);
    assert.equal(diffPrograms({ previous: next, next: previous }).changed[0].load, null);
  });
});

describe('it never invents a reason', () => {
  const logs = (weight, n, opts = {}) =>
    Array.from({ length: n }, (_, i) => ({
      lift: 'squat',
      weight,
      reps: 5,
      date: `2026-01-0${i + 1}`,
      ...opts,
    }));

  test('a change the log called for is attributed to the log, with the engine\'s own words', () => {
    const prescriptions = prescribeAll({ logs: logs(225, 2), units: 'lb' });
    const target = prescriptions.squat.weight;
    const d = diffPrograms({ previous: novice(225), next: novice(target), prescriptions });
    const squat = d.changed.find((c) => c.key === 'squat');
    assert.equal(squat.basis, BASIS.PROGRESSION);
    assert.equal(squat.expected.action, 'increase');
    assert.ok(squat.explanation && squat.explanation.length > 0, 'the engine reason was dropped');
  });

  test('a change the log did not call for is attributed to the coach, with no explanation', () => {
    /*
     * NOT an error, and the absent explanation is the point. A coach departs
     * from the arithmetic for ordinary reasons the log cannot see - a missed
     * week, an athlete who asked for a lighter squat, a shoulder mentioned in
     * conversation. Manufacturing a reason here would be the adherence
     * percentage in another costume: grading a decision without its inputs.
     */
    const prescriptions = prescribeAll({ logs: logs(225, 2), units: 'lb' });
    const d = diffPrograms({ previous: novice(225), next: novice(185), prescriptions });
    const squat = d.changed.find((c) => c.key === 'squat');
    assert.equal(squat.basis, BASIS.COACH);
    assert.equal(squat.explanation, null, 'a reason was invented for a change the log does not support');
    assert.equal(squat.expected.weight, prescriptions.squat.weight, 'what the log asked for was dropped');
  });

  test('no log at all is UNKNOWN and never COACH', () => {
    /*
     * Two different sentences, and only one of them is true for somebody who
     * has never logged anything. Folding them together would tell an athlete
     * with an empty log that their coach overrode the data.
     */
    const d = diffPrograms({ previous: novice(225), next: novice(235), prescriptions: {} });
    assert.equal(d.changed.find((c) => c.key === 'squat').basis, BASIS.UNKNOWN);
    assert.equal(d.changed.find((c) => c.key === 'squat').expected, null);
  });

  test('an accessory lift the engine does not progress is UNKNOWN, not COACH', () => {
    const previous = { phase: 'novice', week: 1, days: [day('A', [ex('Barbell row', 3, 8, 95)])] };
    const next = { phase: 'novice', week: 2, days: [day('A', [ex('Barbell row', 3, 8, 105)])] };
    const prescriptions = prescribeAll({ logs: logs(225, 2), units: 'lb' });
    assert.equal(diffPrograms({ previous, next, prescriptions }).changed[0].basis, BASIS.UNKNOWN);
  });

  test('there is no score, no percentage and no compliance grade anywhere in this file', () => {
    /*
     * lib/adherence.js refused a percentage for a reason that applies here
     * word for word: a grade is how you stop somebody logging, and the log is
     * the only real input this system has. Asserted rather than trusted,
     * because it is a two-line addition somebody will reach for later without
     * knowing it was considered and refused.
     */
    assert.doesNotMatch(source, /percent|percentage|\bscore\b|compliance|\bgrade\b/i);
  });
});

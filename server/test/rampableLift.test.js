import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { canonicalLift, rampableLift } from '../src/lib/progression.js';
import { warmupForProgram } from '../src/lib/warmup.js';

/**
 * ── THE BUG ───────────────────────────────────────────────────────────────
 *
 * An athlete training on a Smith machine writes "bench press (Smith)" and
 * "squat (Smith)". canonicalLift() is an exact-match table, so both returned
 * null - correctly - and warmupForProgram() found nothing rampable in any day
 * of the week. Its guard then returned null for the WHOLE warm-up, so the
 * Program page rendered no general warm-up, no mobility line, no stretching
 * section, and no ramp on any day.
 *
 * Not a missing ramp on one day. The entire section, silently absent, for
 * every session of a 21-week program - reported as "it failed to add the day 1
 * warmups" because day one is the first day somebody looks at.
 */
describe('a qualifier does not stop somebody being warmed up', () => {
  test('a trailing parenthetical resolves to the lift underneath it', () => {
    for (const [written, expected] of [
      ['bench press (Smith)', 'bench'],
      ['squat (Smith)', 'squat'],
      ['deadlift (deficit)', 'deadlift'],
      ['overhead press (seated)', 'press'],
      ['Squat (SMITH)', 'squat'],
      ['bench press  (close grip)', 'bench'],
      // Either end, or both. The first draft only handled a trailing one, and
      // mutation testing showed the tests could not tell that apart - a mutant
      // stripping anywhere passed everything. Widening beat sharpening: a
      // person who writes it in front has the same problem.
      ['(Smith) bench press', 'bench'],
      ['(paused) bench press (close grip)', 'bench'],
    ]) {
      assert.equal(rampableLift(written), expected, `${written} is not rampable`);
    }
  });

  test('a lift it already knew is unchanged', () => {
    for (const written of ['bench press', 'squat', 'deadlift', 'overhead press']) {
      assert.equal(rampableLift(written), canonicalLift(written));
      assert.ok(rampableLift(written), `${written} stopped resolving`);
    }
  });

  test('IT IS NOT A SUBSTRING SEARCH', () => {
    /*
     * The comment above LIFT_SPELLINGS says what that cost the last time: an
     * earlier version matched the word "squat" anywhere inside whatever text
     * the athlete typed, including text with newlines in it. One trailing
     * parenthetical, stripped once, or nothing.
     */
    for (const written of [
      'bench press (Smith) extra',
      'i did a squat today',
      'squat (',
      '(Smith)',
      'leg press (Smith)',
      'incline dumbbell press',
      'cable lateral raise',
    ]) {
      assert.equal(rampableLift(written), null, `${written} resolved to something`);
    }
  });

  test('and non-strings do not throw', () => {
    for (const junk of [null, undefined, 42, {}, []]) {
      assert.equal(rampableLift(junk), null);
    }
  });
});

describe('THE STRICT VERSION STAYS STRICT', () => {
  test('canonicalLift still refuses a qualifier', () => {
    /*
     * This is the assertion that makes the loosening safe, and it is the more
     * important half of this file.
     *
     * canonicalLift decides whether two entries are THE SAME LIFT for
     * progression, personal records, adherence and the public leaderboard. A
     * Smith-machine squat is not a barbell squat: it must not set a
     * leaderboard total, and it must not feed a linear-progression rule built
     * on free-weight evidence. Loosening the shared table would have made four
     * things wrong to fix a fifth.
     */
    for (const written of ['bench press (Smith)', 'squat (Smith)', 'deadlift (deficit)']) {
      assert.equal(canonicalLift(written), null, `${written} now counts as the same lift for progression and PRs`);
    }
  });

  test('and only the warm-up uses the loose one', () => {
    /*
     * Asserted rather than intended. The safety argument above is "the strict
     * identity is still used everywhere that matters" - which is a claim about
     * the CALLERS, so it is the callers that get checked. A second one is a
     * decision somebody should have to make here, in front of this comment.
     */
    const dir = new URL('../src/', import.meta.url);
    const users = [];
    for (const file of readdirSync(dir, { recursive: true })) {
      if (!String(file).endsWith('.js')) continue;
      const source = readFileSync(new URL(String(file), dir), 'utf8');
      if (/\brampableLift\b/.test(source)) users.push(String(file).replace(/\\/g, '/'));
    }
    assert.ok(users.length >= 2, `only found ${users.length} files mentioning it - this check did not run`);
    assert.deepEqual(
      users.sort(),
      ['lib/progression.js', 'lib/warmup.js'],
      'something other than the warm-up now resolves a lift loosely',
    );
  });
});

describe('the whole warm-up came back', () => {
  const smithProgram = {
    days: [
      { name: 'Day 1 - Push', exercises: [{ lift: 'bench press (Smith)', weight: 225 }, { lift: 'triceps pushdown', weight: 150 }] },
      { name: 'Day 2 - Lower', exercises: [{ lift: 'squat (Smith)', weight: 315 }] },
      { name: 'Day 3 - Recovery', exercises: [{ lift: 'plank', weight: null }] },
    ],
  };

  test('a Smith-machine week produces a warm-up at all', () => {
    // It produced null. Not an empty ramp - null, which is what made the
    // general warm-up and the stretching section disappear too.
    const warmup = warmupForProgram({ program: smithProgram, units: 'lb' });
    assert.ok(warmup, 'a whole week of Smith-machine work still warms nobody up');
    assert.equal(warmup.days.length, 3);
  });

  test('and DAY ONE specifically has a ramp', () => {
    const warmup = warmupForProgram({ program: smithProgram, units: 'lb' });
    assert.ok(warmup.days[0].specific.length > 0, 'day one has no ramp - the reported symptom');
    assert.equal(warmup.days[0].specific[0].lift, 'bench');
  });

  test('a day with nothing rampable still has no ramp, and that is correct', () => {
    // The fix must not invent a ramp for a recovery day.
    const warmup = warmupForProgram({ program: smithProgram, units: 'lb' });
    assert.equal(warmup.days[2].specific.length, 0);
  });

  test('a program with genuinely nothing rampable still returns null', () => {
    // The guard is right and stays. A page should not render an empty heading.
    const noMainLifts = { days: [{ name: 'Day 1', exercises: [{ lift: 'cable crunch', weight: 250 }] }] };
    assert.equal(warmupForProgram({ program: noMainLifts, units: 'lb' }), null);
  });
});

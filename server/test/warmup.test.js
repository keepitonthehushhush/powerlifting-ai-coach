import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BAR_WEIGHT, warmupPlan, warmupSets } from '../src/lib/warmup.js';
import { assertsWithoutNegation } from '../../scripts/lib/grading.mjs';

const prompt = readFileSync(new URL('../src/prompts/systemPrompt.js', import.meta.url), 'utf8');

describe('warmupSets', () => {
  test('ramps from the empty bar to just under the working weight', () => {
    const { sets } = warmupSets({ lift: 'squat', workingWeight: 235 });
    assert.equal(sets[0].weight, BAR_WEIGHT.lb);
    assert.ok(sets.at(-1).weight < 235, 'the ramp must stop short of the work set');
  });

  test('load rises and reps fall', () => {
    // The later sets rehearse the groove; they must not accumulate fatigue.
    const { sets } = warmupSets({ lift: 'squat', workingWeight: 315 });
    for (let i = 1; i < sets.length; i += 1) {
      assert.ok(sets[i].weight > sets[i - 1].weight, 'load must increase monotonically');
      assert.ok(sets[i].reps <= sets[i - 1].reps, 'reps must not increase as load does');
    }
  });

  test('every warm-up weight is loadable', () => {
    // A ramp full of weights the athlete cannot build is worse than no ramp.
    const { sets } = warmupSets({ lift: 'bench', workingWeight: 187, smallestPlatePair: 5 });
    for (const s of sets) {
      assert.equal((s.weight - BAR_WEIGHT.lb) % 10, 0, `${s.weight} is not loadable with 5lb plates`);
    }
  });

  test('never repeats a weight', () => {
    // Two identical rungs read as a mistake and cost a set of real work.
    const { sets } = warmupSets({ lift: 'squat', workingWeight: 95 });
    const weights = sets.map((s) => s.weight);
    assert.equal(new Set(weights).size, weights.length);
  });

  test('a light working weight gets the bar, not a ceremony', () => {
    const { sets } = warmupSets({ lift: 'press', workingWeight: 60 });
    assert.deepEqual(sets, [
      { weight: 45, reps: 5 },
      { weight: 45, reps: 5 },
    ]);
  });

  test('a working weight at or under the bar is handled rather than negative', () => {
    const { sets } = warmupSets({ lift: 'squat', workingWeight: 45 });
    assert.deepEqual(sets, [{ weight: 45, reps: 5 }]);
  });

  test('uses the kilogram bar for a kilogram lifter', () => {
    const { sets } = warmupSets({ lift: 'squat', workingWeight: 100, units: 'kg' });
    assert.equal(sets[0].weight, 20);
  });

  test('says so rather than guessing when there is no working weight', () => {
    for (const workingWeight of [null, undefined, 0, -50, 'heavy']) {
      assert.deepEqual(warmupSets({ lift: 'squat', workingWeight }).sets, []);
    }
  });

  test('does not warm up movements it does not program', () => {
    assert.deepEqual(warmupSets({ lift: 'leg press', workingWeight: 300 }).sets, []);
  });
});

describe('warmupPlan', () => {
  const plan = warmupPlan({
    prescriptions: {
      squat: { weight: 235 },
      bench: { weight: 155 },
      deadlift: { weight: null },
    },
  });

  test('orders the session general, then dynamic, then specific', () => {
    assert.ok(plan.general.length > 0);
    assert.ok(plan.dynamic.length > 0);
    assert.equal(plan.specific.length, 2, 'a lift with no prescribed weight gets no ramp');
  });

  test('the dynamic portion is movement through range, not holds', () => {
    assert.match(plan.dynamic, /Movement through range, not holds/);
  });

  test('static stretching is placed after training, never before', () => {
    // The whole point of the feature. Static stretching before lifting ranked
    // last of every warm-up method tested for explosive strength.
    assert.match(plan.afterTraining, /after training/i);
    assert.doesNotMatch(plan.general, /static/i);
    assert.doesNotMatch(plan.dynamic, /static/i);
  });

  test('static stretching is absent by construction, not by instruction', () => {
    // There is no "remember not to" here: the pre-session fields simply cannot
    // contain it, because nothing generates it.
    const preSession = `${plan.general} ${plan.dynamic}`;
    assert.doesNotMatch(preSession, /\bhold (?:for|each)\b/i);
    assert.doesNotMatch(preSession, /\b\d+\s*(?:s|sec|seconds)\b/i);
  });
});

describe('the coach is told what the evidence says', () => {
  test('the prompt forbids prescribing static stretching before lifting', () => {
    // A lifter who asks "should I stretch first?" gets asked in their own
    // words, and the model has to have the answer rather than the folklore.
    assert.match(prompt, /static stretching/i);
    assert.match(prompt, /before/i);
  });

  test('the prompt does not CLAIM stretching prevents injury', () => {
    // A plain regex cannot tell a prohibition from a claim - it flags the
    // prompt's own "Do not tell the athlete that stretching prevents injury".
    // assertsWithoutNegation is the helper this codebase already has for
    // exactly that, written for the safety eval: it judges each sentence
    // alone, so a refusal that names the thing being refused does not count
    // as prescribing it.
    assert.equal(
      assertsWithoutNegation(prompt, 'stretching prevents injury'),
      false,
      'the prompt asserts, rather than forbids, the claim that stretching prevents injury',
    );
  });

  test('and it does forbid it explicitly', () => {
    // The inverse. Without this, the test above passes just as well on a
    // prompt that never mentions stretching at all.
    assert.match(prompt, /Do not tell the athlete that stretching prevents injury/i);
  });
});

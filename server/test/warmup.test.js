import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource } from './helpers/source.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';

import {
  BAR_WEIGHT,
  PLATE_HEIGHT_LOAD,
  warmupForProgram,
  warmupPlan,
  warmupSets,
} from '../src/lib/warmup.js';
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

/**
 * ── THE WARM-UP ON THE PROGRAM PAGE ───────────────────────────────────────
 *
 * "The program is not showing the stretch or warm up exercises."
 *
 * It was not. The coach writes a warm-up into the chat reply, and
 * `<program_data>` has no field to carry one - so the Program page, which is
 * the only durable copy of a session and the thing an athlete reads at the
 * rack, started at the working weight. A novice handed that loads the bar to
 * the working weight, because that is what the sheet says.
 *
 * The block did not gain a field. It is derived instead: same reason the ramp
 * was computed in the first place, plus two the block cannot match - a derived
 * value cannot be forgotten, and it appears on the programs ALREADY stored.
 */
describe('warmupForProgram', () => {
  const DAY = (name, exercises) => ({ name, exercises });
  const PROGRAM = {
    days: [
      DAY('Day A', [
        { lift: 'back squat', sets: 3, reps: 5, weight: 185 },
        { lift: 'bench press', sets: 3, reps: 5, weight: 135 },
        { lift: 'barbell row', sets: 3, reps: 8, weight: 95 },
      ]),
      DAY('Day B', [{ lift: 'deadlift', sets: 1, reps: 5, weight: 275 }]),
    ],
  };

  test('every day gets its own ramp, in program order', () => {
    const plan = warmupForProgram({ program: PROGRAM, units: 'lb' });
    assert.equal(plan.days.length, 2);
    assert.deepEqual(plan.days.map((d) => d.name), ['Day A', 'Day B']);
    assert.deepEqual(plan.days[1].specific.map((s) => s.lift), ['deadlift']);
  });

  test('the ramp works up to the weight the page actually shows', () => {
    /*
     * The property that matters. A warm-up ramping to a number the table below
     * it does not contain is worse than no warm-up: it makes the athlete
     * choose which of two sheets to believe, mid-session.
     */
    const plan = warmupForProgram({ program: PROGRAM, units: 'lb' });
    const squat = plan.days[0].specific.find((s) => s.lift === 'squat');
    assert.ok(squat.sets.every((set) => set.weight < 185), 'a ramp set met or passed the work set');
    assert.equal(squat.sets[0].weight, BAR_WEIGHT.lb, 'the ramp does not start at the bar');
  });

  test('accessories are skipped, and that is the answer rather than a gap', () => {
    // Nobody ramps to their working weight on a barbell row, and a warm-up
    // listing every movement is the list nobody does.
    const plan = warmupForProgram({ program: PROGRAM, units: 'lb' });
    const lifts = plan.days[0].specific.map((s) => s.lift);
    assert.deepEqual(lifts, ['squat', 'bench']);
  });

  test('a lift programmed twice in one day is warmed up once', () => {
    const plan = warmupForProgram({
      program: { days: [DAY('Day A', [
        { lift: 'squat', weight: 185 },
        { lift: 'back squat', weight: 135 },
      ])] },
      units: 'lb',
    });
    assert.equal(plan.days[0].specific.length, 1);
    /*
     * The FIRST entry's load is the one ramped to, and asserting that is the
     * whole test: both spellings canonicalize to `squat`, so a version that
     * dropped the de-duplication would still produce exactly one ramp - it
     * would just quietly ramp to the lighter second entry. Counting the ramps
     * cannot see that; the top set can.
     */
    const top = plan.days[0].specific[0].sets.at(-1).weight;
    assert.ok(top < 185, `the ramp met the work set at ${top}`);
    assert.ok(top > 135, `the ramp worked up to the second entry, not the first (${top})`);
  });

  test('a program with nothing rampable returns null, not an empty heading', () => {
    const conditioning = { days: [DAY('Day A', [{ lift: 'barbell row', weight: 95 }])] };
    assert.equal(warmupForProgram({ program: conditioning, units: 'lb' }), null);
    assert.equal(warmupForProgram({ program: { days: [] } }), null);
    assert.equal(warmupForProgram({ program: null }), null);
    assert.equal(warmupForProgram({}), null);
  });

  test('a day with no weight yet is skipped rather than ramped to nothing', () => {
    const plan = warmupForProgram({
      program: { days: [
        DAY('Day A', [{ lift: 'squat', weight: null }]),
        DAY('Day B', [{ lift: 'squat', weight: 185 }]),
      ] },
      units: 'lb',
    });
    assert.deepEqual(plan.days[0].specific, []);
    assert.ok(plan.days[1].specific.length > 0);
  });

  test('the units and the bar travel with the numbers', () => {
    /*
     * Both exist so the browser does not declare them a second time. A page
     * that defaulted to lb on its own would label kilos as pounds for exactly
     * the athlete whose profile failed to load, and 45 hardcoded in the
     * browser is wrong for everybody who trains in kilos.
     */
    const lb = warmupForProgram({ program: PROGRAM, units: 'lb' });
    const kg = warmupForProgram({ program: PROGRAM, units: 'kg' });
    assert.equal(lb.units, 'lb');
    assert.equal(kg.units, 'kg');
    assert.equal(lb.bar, BAR_WEIGHT.lb);
    assert.equal(kg.bar, BAR_WEIGHT.kg);
    assert.notEqual(lb.bar, kg.bar);
  });

  test('it carries no English prose, because the page is translated', () => {
    /*
     * The sentences in warmupPlan() are written for the model. Shipping them
     * to the browser would put an untranslated paragraph in the middle of a
     * Spanish page - the same mistake the adherence statuses avoid by
     * crossing the wire as keys.
     */
    const plan = warmupForProgram({ program: PROGRAM, units: 'lb' });
    assert.deepEqual(Object.keys(plan).sort(), ['bar', 'days', 'units']);
    const asText = JSON.stringify(plan);
    assert.doesNotMatch(asText, /cardio|stretch|mobility/i);
  });
});

describe('THE ROUTE AND THE PAGE ACTUALLY SHOW IT', () => {
  const route = readSource(new URL('../src/routes/program.js', import.meta.url));
  const page = readSource(new URL('../../web/src/pages/Program.jsx', import.meta.url));

  test('the route returns a warm-up with the program', () => {
    assert.match(route, /warmup: active\s*\?\s*warmupForProgram\(/);
  });

  test('it is computed from the SAME equipment the plate readout uses', () => {
    /*
     * The plate drawings and the ramp both answer "what can this person put on
     * a bar". Two different sources for that would let the page tell somebody
     * to warm up with a weight the same page says they cannot build.
     */
    const call = route.slice(route.indexOf('warmup: active'), route.indexOf('} catch'));
    assert.match(call, /units: profileRow\?\.units === 'kg' \? 'kg' : 'lb'/);
    assert.match(call, /smallestPlatePair: profileRow\?\.smallest_plate_pair \?\? null/);
  });

  test('no active program means no warm-up, rather than a ramp to nowhere', () => {
    assert.match(route, /warmup: active\s*\?[\s\S]*?:\s*null,/);
  });

  test('the page reads it out of the response and renders the shared half once', () => {
    assert.match(page, /\.then\(\(\{ active, history, adherence, equipment, warmup \}\)/);
    assert.match(page, /state\.warmup && \(/);
    for (const key of ['warmupHeading', 'warmupGeneral', 'warmupMobility', 'warmupStretchBody']) {
      assert.ok(page.includes(`program.${key}`), `${key} is not rendered`);
    }
  });

  test('the ramp is rendered inside the day it belongs to', () => {
    // Next to the numbers it works up to. A warm-up in one card and the loads
    // in another is two places to look while holding a phone at a rack.
    const dayBlock = page.slice(page.indexOf('data.days.map('), page.indexOf('program-table'));
    assert.match(dayBlock, /rampFor\(index\)/);
    assert.match(dayBlock, /program\.warmupRampHeading/);
  });

  test('days are matched by index, never by name', () => {
    // Two days called "Day A" is a thing a model writes, and a name match
    // would put the first day's loads under both of them.
    assert.match(page, /const rampFor = \(dayIndex\) => state\.warmup\?\.days\?\.\[dayIndex\]\?\.specific/);
    assert.doesNotMatch(page, /warmup\.days\.find\(/);
  });

  test('the bar and the units come from the server, not from the browser', () => {
    assert.match(page, /const barWeight = state\.warmup\?\.bar \?\? null;/);
    assert.match(page, /units: state\.warmup\.units/);
    // A literal 45 in the browser is wrong for everybody who trains in kilos.
    const ramp = page.slice(page.indexOf('warmup-ramp'), page.indexOf('program-table'));
    assert.doesNotMatch(ramp, /\b45\b|\b20\b/);
  });

  test('lift names come from the one catalogue that already has them', () => {
    assert.match(page, /t\(`progress\.lift\.\$\{entry\.lift\}`\)/);
  });

  test('the page makes no claim that this prevents injury', () => {
    /*
     * The reason for the whole feature is somebody getting hurt, and that is
     * exactly why it must not say so: Coach Diaz is not a medical
     * professional and injury prevention is a clinical claim. The same line
     * the coaching prompt draws.
     */
    const copy = Object.entries(en.program)
      .filter(([key]) => key.startsWith('warmup'))
      .map(([, value]) => value)
      .join(' ');
    assert.ok(copy.length > 200, 'the warm-up copy is not where this test looks');
    assert.doesNotMatch(copy, /injur|prevent|protect/i);
    // And it says what it IS for, so the section is not unexplained.
    assert.match(copy, /ready to lift well/i);
  });

  test('and it puts static stretching after training, which is where it belongs', () => {
    // Held before lifting it reduces force. This is the researched position
    // that lib/warmup.js is built around; the page must not contradict it.
    assert.match(en.program.warmupStretchHeading, /after, not before/i);
    assert.match(en.program.warmupStretchBody, /after training/i);
    assert.match(en.program.warmupMobility, /do not hold/i);
  });
});

/**
 * ── AN EMPTY-BAR DEADLIFT IS NOT A LIGHT DEADLIFT ─────────────────────────
 *
 * Found while double-checking the Program page warm-up, which had just put
 * this in front of every athlete on a printed sheet.
 *
 * The IPF technical rules put the largest disc at no more than 45 cm and the
 * bar between 28 and 29 mm. So a bar carrying any full-size plate sits with
 * its center 225 mm off the floor and an empty one at about 15 mm - a
 * difference of roughly eight inches. Pulling from eight inches lower is a
 * deficit deadlift: longer range, more knee and hip flexion, more demand on a
 * back that has not warmed up. It is a HARDER variation of the thing it is
 * meant to prepare somebody for.
 *
 * Nothing failed. The ramp was arithmetically perfect and the geometry was
 * wrong, which is the same shape as every other defect in this project.
 */
describe('a lift that starts on the floor starts at plate height', () => {
  test('a deadlift ramp never names a load lighter than a plate-height bar', () => {
    for (const work of [155, 185, 225, 275, 405, 600]) {
      const { sets } = warmupSets({ lift: 'deadlift', workingWeight: work });
      assert.ok(sets.length > 0, `no ramp at ${work}`);
      for (const set of sets) {
        assert.ok(
          set.weight >= PLATE_HEIGHT_LOAD.lb,
          `${work} lb ramp includes ${set.weight} lb, which is below plate height`
        );
      }
    }
  });

  test('and it still stops short of the working weight', () => {
    // The original property must survive the new floor.
    const { sets } = warmupSets({ lift: 'deadlift', workingWeight: 275 });
    assert.ok(sets.every((s) => s.weight < 275));
    assert.equal(sets[0].weight, PLATE_HEIGHT_LOAD.lb);
  });

  test('the other three lifts still start at the empty bar', () => {
    // They do not begin on the ground, so bar height is not part of them and
    // the empty bar is exactly the right first rung.
    for (const lift of ['squat', 'bench', 'press']) {
      const { sets } = warmupSets({ lift, workingWeight: 185 });
      assert.equal(sets[0].weight, BAR_WEIGHT.lb, `${lift} no longer starts at the bar`);
    }
  });

  test('kilos get the kilo answer, not a converted pound one', () => {
    const { sets } = warmupSets({ lift: 'deadlift', workingWeight: 140, units: 'kg' });
    assert.equal(sets[0].weight, PLATE_HEIGHT_LOAD.kg);
    assert.notEqual(PLATE_HEIGHT_LOAD.kg, PLATE_HEIGHT_LOAD.lb);
  });

  test('below plate height it says to raise the bar, and gives no ramp at all', () => {
    /*
     * Ordinary for a novice, and it has an ordinary answer: raise the bar
     * rather than lower the athlete. No ramp is returned because every load it
     * could name would be one this function has just called the wrong height.
     */
    const { sets, reason, note } = warmupSets({ lift: 'deadlift', workingWeight: 115 });
    assert.deepEqual(sets, []);
    assert.equal(reason, 'elevate');
    assert.match(note, /raise the bar/i);
    // It says what to raise it with. "Elevate the bar" alone is not actionable
    // to somebody who has never seen it done.
    assert.match(note, /blocks|mats|plates/i);
  });

  test('THE ADVICE SURVIVES THE PIPELINE - it is not filtered out as "no sets"', () => {
    /*
     * The bug this test exists for: warmupPlan() dropped every entry with an
     * empty `sets`, which threw away the one case that matters most. A novice
     * deadlifter would have got no warm-up guidance at all, and nothing
     * anywhere would have said why.
     */
    const plan = warmupPlan({ prescriptions: { deadlift: { weight: 115 } } });
    assert.equal(plan.specific.length, 1, 'the elevate advice was filtered out');
    assert.equal(plan.specific[0].reason, 'elevate');

    const page = warmupForProgram({
      program: { days: [{ name: 'Day C', exercises: [{ lift: 'deadlift', weight: 115 }] }] },
      units: 'lb',
    });
    assert.ok(page, 'the whole warm-up went null because the only entry had no sets');
    assert.equal(page.days[0].specific[0].reason, 'elevate');
  });

  test('a lift with no weight yet is still dropped, and is not the same case', () => {
    const plan = warmupPlan({ prescriptions: { deadlift: { weight: null } } });
    assert.deepEqual(plan.specific, []);
    assert.equal(warmupSets({ lift: 'deadlift', workingWeight: null }).reason, 'no_weight');
  });

  test('the page is told the reason and never the English sentence', () => {
    // The note is written for the model. The page has a Spanish translation.
    const page = warmupForProgram({
      program: { days: [{ name: 'Day C', exercises: [{ lift: 'deadlift', weight: 115 }] }] },
      units: 'lb',
    });
    assert.deepEqual(Object.keys(page.days[0].specific[0]).sort(), ['lift', 'reason', 'sets']);
    assert.doesNotMatch(JSON.stringify(page), /raise the bar/i);
  });

  test('and the page has words for it, in both languages', () => {
    assert.ok(en.program.warmupElevate.length > 80);
    assert.match(en.program.warmupElevate, /blocks|mats|plates/i);
    assert.ok(es.program.warmupElevate.length > 80);
    // Not the English string copied across.
    assert.notEqual(en.program.warmupElevate, es.program.warmupElevate);
  });
});

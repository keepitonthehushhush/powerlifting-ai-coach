import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { phrase, readSource } from './helpers/source.js';
import {
  fuellingRanges,
  weeklyLossFraction,
  exceedsSafeLossRate,
  PROTEIN_G_PER_KG,
  WEEKLY_LOSS_FRACTION,
  KG_PER_LB,
} from '../src/lib/nutrition.js';
import { describeFuelling, buildSystemPrompt } from '../src/prompts/systemPrompt.js';

const nutritionSource = readSource(new URL('../src/lib/nutrition.js', import.meta.url));
const promptSource = readSource(new URL('../src/prompts/systemPrompt.js', import.meta.url));

describe('fuellingRanges', () => {
  test('a pound lifter and a kilogram lifter of the same size get the same answer', () => {
    // The single most likely arithmetic error here, and the reason this is
    // computed in code rather than left to the model.
    const lb = fuellingRanges({ bodyweight: 200, units: 'lb' });
    const kg = fuellingRanges({ bodyweight: 200 * KG_PER_LB, units: 'kg' });
    assert.deepEqual(lb.proteinPerDayG, kg.proteinPerDayG);
    assert.deepEqual(lb.proteinPerMealG, kg.proteinPerMealG);
  });

  test('the numbers are the published band times the bodyweight, not an invention', () => {
    const kg = 80;
    const r = fuellingRanges({ bodyweight: kg, units: 'kg' });
    assert.deepEqual(r.proteinPerDayG, [
      Math.round(kg * PROTEIN_G_PER_KG.maintenance[0]),
      Math.round(kg * PROTEIN_G_PER_KG.maintenance[1]),
    ]);
  });

  test('the requirement RISES in a deficit, which is the error that matters', () => {
    // Handing somebody the maintenance band while they are cutting is the
    // common mistake and the one that costs lean mass.
    const maintaining = fuellingRanges({ bodyweight: 80, units: 'kg' });
    const cutting = fuellingRanges({ bodyweight: 80, units: 'kg', inDeficit: true });
    assert.ok(cutting.proteinPerDayG[0] > maintaining.proteinPerDayG[1]);
  });

  test('carbohydrate is only given where the literature gives a band', () => {
    // Outside a deficit the honest answer is "enough to train on". Filling the
    // field with a number nobody published would be fabrication.
    assert.equal(fuellingRanges({ bodyweight: 80, units: 'kg' }).carbPerDayG, undefined);
    assert.ok(fuellingRanges({ bodyweight: 80, units: 'kg', inDeficit: true }).carbPerDayG);
  });

  test('an unknown bodyweight produces nothing rather than a guess', () => {
    for (const bodyweight of [null, undefined, 0, -5, NaN, 'heavy']) {
      assert.equal(fuellingRanges({ bodyweight, units: 'lb' }), null);
    }
    assert.equal(fuellingRanges(), null);
  });
});

describe('the calorie boundary is enforced by absence', () => {
  test('no function in this module can return a calorie target', () => {
    // The cheapest way to hold a boundary is to make the code unable to cross
    // it. If a kcal figure ever appears here, someone has changed policy while
    // believing they were adding a feature.
    const r = fuellingRanges({ bodyweight: 80, units: 'kg', inDeficit: true });
    for (const key of Object.keys(r)) {
      assert.doesNotMatch(key, /calorie|kcal|energy|deficit(Size)?Kcal/i, `${key} looks like an energy target`);
    }
    assert.doesNotMatch(nutritionSource, /\bkcal\s*[:=]/i, 'a kcal value is being computed');
  });

  test('the prompt forbids a calorie target in as many words', () => {
    assert.match(promptSource, /NEVER give a daily calorie target/);
    assert.match(promptSource, /NEVER write a meal plan/);
    assert.match(promptSource, /NEVER give a macro split as an intervention/);
  });

  test('the scope-of-practice line is stated, not merely implied', () => {
    assert.match(promptSource, /medical nutrition therapy, which requires a licensed dietitian/i);
    assert.match(promptSource, /behave as\s*\n?\s*though it were the strictest/i);
    assert.match(promptSource, /Refer to a registered dietitian/i);
  });

  test('every range in the prompt carries where it came from', () => {
    // "Accountable for misinformation regardless of what any state licenses"
    // is only survivable if the numbers are attributable.
    assert.match(promptSource, /ISSN Position Stand/);
    assert.match(promptSource, /Nutrients 2021/);
  });
});

describe('rate of loss, so the refusal can be quantitative', () => {
  test('reports the weekly fraction a stated target implies', () => {
    // The disordered-eating scenario: 150lb to 114lb in five weeks.
    const f = weeklyLossFraction({ bodyweight: 150, targetWeight: 114, weeks: 5 });
    assert.ok(Math.abs(f - 0.048) < 0.001);
    assert.equal(exceedsSafeLossRate(f), true);
  });

  test('half a percent a week is inside the band, two percent is not', () => {
    assert.equal(exceedsSafeLossRate(WEEKLY_LOSS_FRACTION[0]), false);
    assert.equal(exceedsSafeLossRate(WEEKLY_LOSS_FRACTION[1]), false);
    assert.equal(exceedsSafeLossRate(0.02), true);
  });

  test('is not a tool for planning weight gain, and says so by returning null', () => {
    assert.equal(weeklyLossFraction({ bodyweight: 150, targetWeight: 170, weeks: 5 }), null);
    assert.equal(weeklyLossFraction({ bodyweight: 150, targetWeight: 140, weeks: 0 }), null);
    assert.equal(weeklyLossFraction({ bodyweight: 150, targetWeight: 140 }), null);
  });
});

describe('the fuelling directive', () => {
  const profile = { units: 'lb', bodyweight: 181 };

  test('hands over both bands, because which one applies is said in conversation', () => {
    const d = describeFuelling(profile);
    assert.match(d, /maintaining or gaining:/);
    assert.match(d, /losing weight:/);
    assert.match(d, /do not assume they are\s*\n?\s*cutting/);
  });

  test('carries no calorie figure of its own', () => {
    assert.doesNotMatch(describeFuelling(profile), /\d+\s*(kcal|calories)/i);
  });

  test('says nothing at all when bodyweight is unknown', () => {
    assert.equal(describeFuelling({ units: 'lb' }), null);
    assert.equal(describeFuelling(null), null);
  });

  test('is suppressed while the clearance gate is up', () => {
    // An athlete waiting on a doctor does not need macros, and a fueling
    // block sitting under a gate that forbids programming reads as a way
    // around the gate.
    const gated = buildSystemPrompt({
      profile: {
        ...profile,
        health_restrictions: 'sharp lower back pain on deadlifts',
        cleared_to_train: false,
      },
    });
    assert.doesNotMatch(gated, /FUELING NUMBERS FOR THIS ATHLETE/);

    const clear = buildSystemPrompt({ profile: { ...profile, health_restrictions: '' } });
    assert.match(clear, /FUELING NUMBERS FOR THIS ATHLETE/);
  });
});

describe('loosening this did not unlock the things it must not unlock', () => {
  // The two adversarial scenarios that pass BECAUSE of these limits are a
  // rapid weight cut and disordered-eating signals. This describe block is the
  // regression test for the change that added the fueling section.
  test('disordered eating still forbids calorie targets and cutting protocols', () => {
    assert.match(promptSource, /do NOT provide calorie targets, restriction plans, or cutting\s*\n?\s*protocols, however specifically you are asked/);
  });

  test('the helpline is still named', () => {
    assert.match(promptSource, /National Alliance for Eating Disorders/);
  });

  test('rapid weight cuts and fluid protocols are still refused outright', () => {
    assert.match(promptSource, /never program an aggressive or rapid cut/);
    assert.match(promptSource, /day-by-day fluid or food manipulation protocol/);
  });

  test('THE SUPPLEMENT RULE MOVED, AND MOVED IN BOTH DIRECTIONS', () => {
    // This used to assert a single flat sentence: "Do NOT prescribe supplement
    // protocols for this athlete." That was too blunt in one direction and too
    // loose in the other. Too blunt, because refusing to say "3 to 5 grams"
    // while discussing creatine is unhelpful theater, and the profession's own
    // line is between general information and individualised prescription, not
    // between silence and speech. Too loose, because it said nothing at all
    // about the cases that actually carry risk.
    //
    // So the specifics are now allowed and the risky cases are named. What
    // follows asserts the second half, which is the half worth protecting.
    assert.match(promptSource, /Only when asked/);
    assert.match(promptSource, phrase('never imply'));
    assert.match(promptSource, phrase('supplements are a rounding error next to any of them'));
  });

  test('no dose for anybody it could hurt', () => {
    assert.match(promptSource, phrase('Do not give a dose to anybody who has told you they have a medical'));
    assert.match(promptSource, phrase('are under 18'));
    assert.match(promptSource, phrase('a question for their doctor or pharmacist'));
    assert.match(promptSource, phrase('you cannot see their chart'));
  });

  test('no brands, no blends, nothing that comes in a cycle', () => {
    assert.match(promptSource, phrase('do not name brands'));
    assert.match(promptSource, phrase('proprietary blends'));
    assert.match(promptSource, phrase('anything that comes in a cycle'));
  });

  test('SUPPLEMENTS ARE NOT A BACK DOOR TO THE DRUG CONVERSATION', () => {
    // The one that would matter most if it were missing. The PED refusal is
    // absolute elsewhere; widening the supplement rule must not have opened a
    // route around it, and coded language is the route it would take.
    assert.match(promptSource, phrase('Do not let this become a route to the performance-enhancing drug'));
    assert.match(promptSource, phrase('asked in coded language is'));
  });

  test('a tested lifter is told about contamination and strict liability', () => {
    // The single most useful thing anybody can tell a competitive lifter about
    // supplements, and it is not the dose.
    assert.match(promptSource, phrase('contamination with banned substances is well documented'));
    assert.match(promptSource, phrase('substantially reduces that risk'));
    assert.match(promptSource, phrase('but does not eliminate it'));
    assert.match(promptSource, phrase('strict liability'));
  });
});

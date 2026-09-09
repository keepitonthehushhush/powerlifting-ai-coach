import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { readSource, readMigration, flatten } from './helpers/source.js';
import {
  NUTRITION_DETAIL_LEVELS,
  DEFAULT_NUTRITION_DETAIL,
  resolveNutritionDetail,
  directiveFor,
  fuellingNumbersAllowed,
} from '../src/lib/nutritionDetail.js';
import {
  NUTRITION_DETAIL_LEVELS as WEB_LEVELS,
  DEFAULT_NUTRITION_DETAIL as WEB_DEFAULT,
  resolveNutritionDetail as webResolve,
} from '../../web/src/lib/nutritionDetail.js';
import { buildSystemPrompt } from '../src/prompts/systemPrompt.js';

const migration = readMigration(
  new URL('../../supabase/migrations/0066_how_much_of_the_food_conversation_they_actually_want.sql', import.meta.url)
);
const schema = readSource(new URL('../src/lib/profileSchema.js', import.meta.url));
const prompt = readSource(new URL('../src/prompts/systemPrompt.js', import.meta.url));

const PROFILE = {
  units: 'lb',
  bodyweight: 200,
  experience_level: 'two years',
  cleared_to_train: true,
  goal: 'get stronger',
  days_per_week: 4,
};

const promptFor = (nutrition_detail) =>
  flatten(buildSystemPrompt({ profile: { ...PROFILE, nutrition_detail } }));

describe('the setting exists in one shape everywhere', () => {
  test('the levels agree across the server, the browser and the column', () => {
    /*
     * Three copies, and none of them can be the one that is wrong quietly. The
     * browser cannot import from the server tree - that is how a server-only
     * constant gets shipped in a bundle - and zod's enum wants a literal
     * tuple, so the list is written out three times and checked here.
     */
    assert.deepEqual([...WEB_LEVELS], [...NUTRITION_DETAIL_LEVELS]);
    assert.equal(WEB_DEFAULT, DEFAULT_NUTRITION_DETAIL);
    for (const level of NUTRITION_DETAIL_LEVELS) {
      assert.match(migration, new RegExp(`'${level}'`), `the column does not allow ${level}`);
      assert.match(schema, new RegExp(`'${level}'`), `the profile schema does not accept ${level}`);
    }
    // And nothing the column allows is missing from the code.
    const allowed = migration.match(/nutrition_detail in \(([^)]*)\)/);
    assert.ok(allowed, 'the column no longer constrains the value');
    const fromSql = allowed[1].match(/'([a-z]+)'/g).map((quoted) => quoted.replaceAll("'", ''));
    assert.deepEqual(fromSql.sort(), [...NUTRITION_DETAIL_LEVELS].sort());
  });

  test('the default is what everybody already had', () => {
    /*
     * A migration that adds a setting AND changes behavior for every existing
     * athlete has made two changes that can only be debugged as one.
     */
    assert.equal(DEFAULT_NUTRITION_DETAIL, 'meals');
    assert.match(migration, /default 'meals'/);
    assert.equal(directiveFor('meals'), null, 'the default adds a directive, so behavior changed');
  });

  test('anything unreadable resolves to a level rather than throwing', () => {
    for (const junk of [null, undefined, '', 'MEALS', 'tier3', 4, {}, []]) {
      assert.ok(NUTRITION_DETAIL_LEVELS.includes(resolveNutritionDetail(junk)));
      assert.ok(WEB_LEVELS.includes(webResolve(junk)));
    }
    assert.equal(resolveNutritionDetail('off'), 'off');
    assert.equal(webResolve('ranges'), 'ranges');
  });
});

describe('a preference cannot move a scope-of-practice line', () => {
  /*
   * The reason this feature is safe to have at all. ACE puts individualized
   * meal planning and specific intake recommendations outside what a fitness
   * professional may provide. That is a line about qualifications, and it does
   * not move because the person it protects ticked a box - so the control is
   * built to NARROW only, and the highest level is exactly what the product
   * already did.
   */
  test('no level grants a permission, in any wording', () => {
    for (const level of NUTRITION_DETAIL_LEVELS) {
      const directive = directiveFor(level);
      if (!directive) continue;
      const text = flatten(directive).toLowerCase();
      for (const granted of [
        /you may now/, /you are permitted/, /it is allowed to/, /you can give a calorie/,
        /calorie target/, /meal plan/, /macro split/, /prescribe/,
      ]) {
        // The only mentions of these should be prohibitions in the
        // unconditional sections, never a permission in a per-athlete
        // directive that a setting turned on.
        assert.doesNotMatch(text, granted, `${level} names ${granted} in a per-turn directive`);
      }
    }
  });

  test('the settings screen says there is no fourth level, rather than leaving it to be asked', () => {
    const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
    const es = readSource(new URL('../../web/src/i18n/locales/es.js', import.meta.url));
    assert.match(en, /noCalorieTargets:/);
    assert.match(es, /noCalorieTargets:/);
    assert.match(flatten(en), /No setting turns on calorie targets/);
    // And the coach is told the same thing, so the two answers cannot differ.
    assert.match(flatten(prompt), /NO SETTING UNLOCKS ANYTHING/);
  });

  test('the hard lines are still unconditional', () => {
    // Whatever the setting, the prompt still forbids the same things in the
    // sections that are not per-athlete at all.
    for (const level of [...NUTRITION_DETAIL_LEVELS, 'nonsense']) {
      const built = promptFor(level);
      assert.match(built, /Give a calorie target\. Not a number, not a range/);
      assert.match(built, /DO NOT ADD UP THE MACRONUTRIENT RANGES YOU HAVE BEEN GIVEN/);
      assert.match(built, /do NOT provide calorie targets, restriction plans, or cutting/);
    }
  });
});

describe('what actually reaches the model', () => {
  test('off withholds the computed numbers rather than asking it not to use them', () => {
    /*
     * ADR-2, computed not prompted. A model handed a table of macros and told
     * to leave the subject alone is being asked to hold something it was
     * given; not handing it over is the cheaper guarantee.
     */
    assert.equal(fuellingNumbersAllowed('off'), false);
    const off = promptFor('off');
    assert.doesNotMatch(off, /FUELING NUMBERS FOR THIS ATHLETE/);
    assert.match(off, /FOOD IS OFF FOR THIS ATHLETE/);
  });

  test('ranges keeps the numbers and takes away the plate', () => {
    assert.equal(fuellingNumbersAllowed('ranges'), true);
    const ranges = promptFor('ranges');
    assert.match(ranges, /FUELING NUMBERS FOR THIS ATHLETE/);
    assert.match(ranges, /FOOD IS SET TO RANGES ONLY/);
    assert.match(ranges, /Do NOT name specific meals, foods, portions/);
  });

  test('the full setting sends neither directive, so it costs nothing', () => {
    const meals = promptFor('meals');
    assert.match(meals, /FUELING NUMBERS FOR THIS ATHLETE/);
    assert.doesNotMatch(meals, /FOOD IS OFF FOR THIS ATHLETE/);
    assert.doesNotMatch(meals, /FOOD IS SET TO RANGES ONLY/);
    // A profile that predates the column behaves identically to one set to
    // meals - that is what makes this migration a no-op for existing athletes.
    assert.equal(meals, promptFor(undefined));
  });

  test('the setting survives the clearance gate', () => {
    /*
     * The fueling numbers are suppressed while somebody waits on a doctor, and
     * the directive that says "do not raise food" must NOT be, or the setting
     * silently stops applying under a condition nobody connected to it.
     */
    const gated = flatten(
      buildSystemPrompt({
        profile: { ...PROFILE, cleared_to_train: false, health_restrictions: 'lower back pain', nutrition_detail: 'off' },
      })
    );
    assert.match(gated, /FOOD IS OFF FOR THIS ATHLETE/);
    assert.doesNotMatch(gated, /FUELING NUMBERS FOR THIS ATHLETE/);
  });

  test('the coach is told not to interrogate the setting', () => {
    const off = promptFor('off');
    assert.match(off, /Do not ask them why it is off/);
    assert.match(flatten(prompt), /A narrower setting is a real position and not a degraded one/);
  });
});

describe('where the value lives, and what that costs', () => {
  test('it is outside the health fingerprint, on purpose and in writing', () => {
    /*
     * Putting it inside would make changing it require active health consent,
     * and the person most likely to want food talk off is the person least
     * likely to have granted it. A withdrawal would also clear the setting,
     * returning somebody to the full food conversation at the moment they
     * asked for less.
     */
    const fingerprint = readMigration(
      new URL('../../supabase/migrations/0053_the_obstacle_is_named_before_the_plan.sql', import.meta.url)
    );
    const fn = fingerprint.slice(
      fingerprint.indexOf('create or replace function private.health_fingerprint'),
      fingerprint.indexOf('-- ── Retention')
    );
    assert.doesNotMatch(fn, /nutrition_detail/);
    assert.match(readMigration(
      new URL('../../supabase/migrations/0066_how_much_of_the_food_conversation_they_actually_want.sql', import.meta.url)
    ), /outside\s+private\.health_fingerprint/);
  });

  test('and its value is never written to a log', () => {
    // "Somebody set food talk to off" is an inference about a person that a
    // log line has no reason to hold.
    for (const file of ['../src/routes/profile.js', '../src/routes/chat.js', '../src/lib/nutritionDetail.js']) {
      const source = readSource(new URL(file, import.meta.url));
      const logging = source.match(/logger\.\w+\([^;]*;/g) ?? [];
      for (const call of logging) {
        assert.doesNotMatch(call, /nutrition_detail/, `${file} logs the setting`);
      }
    }
  });
});

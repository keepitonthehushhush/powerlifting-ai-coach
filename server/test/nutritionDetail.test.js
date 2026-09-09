import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSource, readMigration, flatten, stripComments } from './helpers/source.js';
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
const preferences = readSource(new URL('../src/routes/preferences.js', import.meta.url));
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
      // The route validates against the shared list rather than a copy, so
      // what is checked here is that the list reaches it at all.
      assert.match(preferences, /NUTRITION_DETAIL_LEVELS/);
    }
    // And nothing the column allows is missing from the code.
    const allowed = migration.match(/nutrition_detail in \(([^)]*)\)/);
    assert.ok(allowed, 'the column no longer constrains the value');
    const fromSql = allowed[1].match(/'([a-z]+)'/g).map((quoted) => quoted.replaceAll("'", ''));
    assert.deepEqual(fromSql.sort(), [...NUTRITION_DETAIL_LEVELS].sort());
  });

  test('there is exactly one way to write it', () => {
    /*
     * It is a column on user_profile, and PUT /api/profile is a strict schema
     * over that table - so the obvious place for it was there, and that is the
     * wrong place. That endpoint is the intake form's: it runs the age gate,
     * stamps intake_completed_at, and writes with an upsert whose behavior on a
     * partial payload this product has never exercised, with a failure mode of
     * blanking somebody's injuries and lifts.
     *
     * Leaving it out of the strict schema means a whole-profile PUT carrying it
     * is REFUSED rather than quietly taking a second path with different
     * guarantees.
     */
    assert.doesNotMatch(schema, /nutrition_detail: z\./, 'the profile schema writes it too');
    assert.match(preferences, /\.update\(\{ nutrition_detail: value \}\)/);
    /*
     * And it refuses a value the column would refuse anyway. The CHECK is the
     * real backstop, so the harm without this is a 500 where a 400 belongs -
     * which is a worse thing than it sounds, because a 500 is what somebody
     * reports as "the app is broken" rather than as "it would not take my
     * setting".
     */
    /*
     * Scoped to this handler, not the whole file. The theme route above also
     * throws invalid_request, and a whole-file match was satisfied by ITS
     * throw while this one had been replaced - the same false green that
     * readSource and readMigration exist for, in a third disguise.
     */
    const handler = preferences.slice(preferences.indexOf("preferencesRouter.put('/nutrition-detail'"));
    assert.match(handler, /if \(!NutritionDetail\.has\(value\)\)/);
    assert.match(handler, /codedError\('invalid_request'/);
    assert.doesNotMatch(preferences, /\.upsert\(\{ user_id: req\.user\.id, nutrition_detail/);
    // And the browser calls the one endpoint, not saveProfile.
    const panel = readSource(new URL('../../web/src/components/NutritionSettings.jsx', import.meta.url));
    assert.match(panel, /api\.saveNutritionDetail\(/);
    assert.doesNotMatch(panel, /saveProfile/);
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

  test('the coach offers the setting once, where it is useful, and not as an opening menu', () => {
    /*
     * A setting nobody finds is not a setting. The account page is one tap
     * away and nothing points at it, so the coach says it exists at the one
     * moment it means something: just after giving food detail somebody may
     * not have wanted.
     *
     * The honest limitation, stated rather than glossed: "once" is scoped to
     * the conversation, because that is the only thing the model can actually
     * see. A new conversation can say it again. Making it once-ever would need
     * a column and a write, and this is a sentence, not a policy notice.
     */
    assert.match(flatten(prompt), /TELL THEM THE SETTING EXISTS, ONCE, AT THE MOMENT IT IS USEFUL/);
    assert.match(flatten(prompt), /Do not open with it/);
    assert.match(flatten(prompt), /not a paragraph and not a menu/);
  });

  test('and it never offers the setting to somebody who has already chosen', () => {
    // Being asked again about a choice you have already made reads as being
    // talked out of it, which is the one thing the off setting must not feel
    // like.
    assert.match(flatten(prompt), /somebody who has already chosen does not need to be asked again/);
    for (const level of ['off', 'ranges']) {
      assert.ok(directiveFor(level), `${level} sends no directive, so the coach cannot know they chose`);
    }
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
    /*
     * "Somebody set food talk to off" is an inference about a person that a
     * log line has no reason to hold.
     *
     * Every server file that mentions the column, found rather than listed.
     * A hand-written list of three files went stale the moment the write moved
     * to routes/preferences.js - the log line there carried the value and this
     * test was green, because it was looking at the file the write used to be
     * in.
     */
    const root = fileURLToPath(new URL('../src/', import.meta.url));
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    walk(root);

    const mentions = files.filter((file) => stripComments(readFileSync(file, 'utf8')).includes('nutrition_detail'));
    /*
     * Named rather than counted. A count is a canary that has to be edited
     * every time a file is added or renamed and says nothing when it is wrong;
     * these two are the file that WRITES the column and the file that READS
     * it, and a walk that misses either is a walk that is not finding files.
     */
    const found = mentions.map((file) => file.replace(root, ''));
    for (const required of ['routes/preferences.js', 'prompts/systemPrompt.js']) {
      assert.ok(found.includes(required), `the walk did not reach ${required} - it found ${found.join(', ')}`);
    }

    for (const file of mentions) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const call of source.match(/logger\.\w+\([^;]*;/g) ?? []) {
        /*
         * The EVENT NAME may say which setting changed; the VALUE may not.
         * That is the line, and it is a real one rather than a dodge: "they
         * changed their food setting" is what makes a save that did not stick
         * debuggable, while "they set it to off" is the inference about a
         * person that this column exists to keep out of a log.
         *
         * String literals are stripped before the check, so the event name
         * `preferences.nutrition_detail_saved` passes and a field named
         * nutrition_detail in the payload does not.
         */
        const payload = call.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
        assert.doesNotMatch(payload, /nutrition_detail/, `${file.replace(root, '')} logs the setting's value`);
      }
    }
  });
});

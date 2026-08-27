import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Every answerable option in the profile lives in four places at once: a CHECK
 * constraint in Postgres, a zod enum in the API, an array in the intake form,
 * and a label in each locale catalogue. Nothing makes them agree.
 *
 * The failure when they drift is nasty and asymmetric. An option the form
 * offers but the database rejects is a save that fails with a Postgres
 * constraint violation at the moment somebody finishes a long form. An option
 * the database allows but no catalogue names renders as a blank line in a
 * dropdown. Neither shows up in any other test, because each layer is
 * individually correct.
 *
 * So this file is the joint. It reads all four and holds them to each other.
 */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const migration = read('../../supabase/migrations/0019_training_history_and_goals.sql');
const routes = read('../../server/src/routes/profile.js');
const intake = read('../../web/src/pages/Intake.jsx');
const en = read('../../web/src/i18n/locales/en.js');
const es = read('../../web/src/i18n/locales/es.js');

/** The values inside `check (col is null or col in ( ... ))`, comments stripped. */
function constraintValues(sql, column) {
  const start = sql.indexOf(`check (${column} is null or ${column} in (`);
  assert.notEqual(start, -1, `no CHECK constraint found for ${column}`);
  const body = sql.slice(start, sql.indexOf('));', start));
  return new Set(
    [...body.replace(/--[^\n]*/g, '').matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
  );
}

/** The members of a named zod enum in the routes file. */
function zodEnum(source, field) {
  const at = source.indexOf(`${field}: z`);
  assert.notEqual(at, -1, `no zod schema found for ${field}`);
  const open = source.indexOf('.enum([', at);
  const close = source.indexOf('])', open);
  return new Set([...source.slice(open, close).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
}

/** The members of a `const NAME = [ ... ]` array in the form. */
function formOptions(source, name) {
  const at = source.indexOf(`const ${name} = [`);
  assert.notEqual(at, -1, `no ${name} array found in the intake form`);
  const close = source.indexOf('];', at);
  return new Set([...source.slice(at, close).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
}

/** The keys of a nested object literal in a locale catalogue. */
function catalogueKeys(source, name) {
  const at = source.indexOf(`${name}: {`);
  assert.notEqual(at, -1, `no ${name} block found in the catalogue`);
  const close = source.indexOf('},', at);
  return new Set([...source.slice(at, close).matchAll(/^\s{6}([a-z0-9_]+):/gm)].map((m) => m[1]));
}

const GROUPS = [
  {
    label: 'experience_level',
    column: 'experience_level',
    zod: 'experience_level',
    form: 'EXPERIENCE_OPTIONS',
    catalogue: 'experienceOptions',
    // Retained in the database for rows saved before migration 0019, and
    // deliberately not offered by the form. See that migration for why they
    // are kept rather than mapped onto the new ladder.
    legacy: new Set(['never_trained', 'some_experience', 'currently_training']),
  },
  {
    label: 'progress_cadence',
    column: 'progress_cadence',
    zod: 'progress_cadence',
    form: 'CADENCE_OPTIONS',
    catalogue: 'cadenceOptions',
    legacy: new Set(),
  },
  {
    label: 'goal',
    column: 'goal',
    zod: 'goal',
    form: 'GOAL_OPTIONS',
    catalogue: 'goalOptions',
    legacy: new Set(),
  },
];

describe('the four places an option has to exist', () => {
  for (const group of GROUPS) {
    describe(group.label, () => {
      const inDatabase = constraintValues(migration, group.column);
      const inApi = zodEnum(routes, group.zod);
      const inForm = formOptions(intake, group.form);

      test('the database and the API accept exactly the same values', () => {
        assert.deepEqual(
          [...inApi].sort(),
          [...inDatabase].sort(),
          'the zod enum and the CHECK constraint have drifted apart'
        );
      });

      test('every value the form offers is one the database will store', () => {
        for (const value of inForm) {
          assert.ok(inDatabase.has(value), `the form offers "${value}" and the database refuses it`);
        }
      });

      test('the form offers everything current, and nothing legacy', () => {
        const current = new Set([...inDatabase].filter((v) => !group.legacy.has(v)));
        assert.deepEqual([...inForm].sort(), [...current].sort());
      });

      for (const [name, catalogue] of [['en', en], ['es', es]]) {
        test(`${name} has a label for every option the form offers`, () => {
          const labelled = catalogueKeys(catalogue, group.catalogue);
          for (const value of inForm) {
            assert.ok(labelled.has(value), `${name} has no label for "${value}"`);
          }
        });

        test(`${name} carries no label for an option that no longer exists`, () => {
          // A stale label is how a dropdown ends up offering something the
          // database will reject.
          for (const key of catalogueKeys(catalogue, group.catalogue)) {
            assert.ok(inForm.has(key), `${name} still labels "${key}", which the form dropped`);
          }
        });
      }
    });
  }
});

describe('the competition date belongs to the meet goals and only those', () => {
  test('the same two goals in the constraint, the API and the form', () => {
    const inConstraint = new Set(
      [
        ...migration
          .slice(migration.indexOf('competition_date is null or goal in ('))
          .slice(0, 120)
          .matchAll(/'([a-z_]+)'/g),
      ].map((m) => m[1])
    );
    assert.deepEqual([...inConstraint].sort(), ['first_meet', 'meet_prep']);

    for (const [where, source] of [['the API', routes], ['the form', intake]]) {
      const at = source.indexOf('MEET_GOALS = new Set(');
      assert.notEqual(at, -1, `${where} has no MEET_GOALS set`);
      const values = new Set(
        [...source.slice(at, source.indexOf(')', at)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
      );
      assert.deepEqual([...values].sort(), ['first_meet', 'meet_prep'], `${where} disagrees`);
    }
  });

  test('the form clears the date when the goal is not a meet', () => {
    // Otherwise changing the goal after picking a date sends a row that
    // violates the constraint, and the save fails with a Postgres error at
    // the end of a long form.
    assert.match(intake, /MEET_GOALS\.has\(form\.goal\) && form\.competition_date/);
  });
});

describe('the goals that are deliberately absent', () => {
  test('nothing is offered that the coach is forbidden to deliver', () => {
    // Weight-class cuts and hypertrophy are both real goals and both absent on
    // purpose - the prompt's hard limits forbid the first and none of the
    // progression logic serves the second. Listing a goal the product then
    // refuses to program for is a lie told in a dropdown.
    const offered = formOptions(intake, 'GOAL_OPTIONS');
    for (const forbidden of ['weight_class', 'cut_weight', 'build_muscle', 'hypertrophy', 'lose_fat']) {
      assert.ok(!offered.has(forbidden), `the form offers "${forbidden}", which cannot be programmed`);
    }
  });

  test('and the migration records why, so the next person does not just add them', () => {
    assert.match(migration, /weight class/i);
    assert.match(migration, /hypertrophy|building muscle/i);
  });
});

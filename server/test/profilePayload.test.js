import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY, FIELD_LABELS, MEET_GOALS, toPayload } from '../../web/src/lib/profileForm.js';
import { ProfileUpdate } from '../src/lib/profileSchema.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { readRaw, readSource } from './helpers/source.js';

/**
 * ── THE BUG THIS FILE EXISTS FOR ────────────────────────────────────────────
 *
 * "When I tried logging in on my iPhone's web browser, it doesn't allow me to
 * move forward from my training profile. It says invalid profile data and is
 * not telling me what is required to continue."
 *
 * Not an iPhone bug. Nobody could save a profile.
 *
 * The GLP-1 question is rendered only when the goal is body composition, so
 * for every other athlete `form.glp1_status` stayed at its initial `''`. The
 * payload builder sent that through as `?? ''`, and the schema is
 * `z.enum([...]).nullish()` - four values, null, or absent. An empty string is
 * none of them, so the write was rejected, and the 400 said "Invalid profile
 * data." with no field named even though `fieldErrors` was sitting in the
 * response body naming it.
 *
 * ── WHY profileRoundTrip.test.js DID NOT CATCH IT ───────────────────────────
 *
 * That file was written for the previous instance of this exact bug - the
 * leaderboard spreading a profile read into a profile write - and every
 * assertion in it matches source TEXT: that no caller spreads a profile, that
 * the route mentions unrecognized_keys, that a comment exists. All still true,
 * all still passing, and none of them run the payload builder or the schema.
 *
 * This file runs one against the other. It is the only test in the repository
 * that imports both halves of a contract the product depends on, which is why
 * both halves were moved into plain modules to make it possible.
 */

/** A form filled in the way a person actually fills it in. */
const REALISTIC = {
  ...EMPTY,
  experience_level: 'six_to_24_months',
  progress_cadence: 'every_week',
  units: 'lb',
  bodyweight: '198',
  current_squat: '365',
  current_bench: '225',
  current_deadlift: '455',
  goal: 'general_strength',
  equipment_available: 'Full commercial gym',
  days_per_week: '4',
  date_of_birth: '1994-03-11',
};

/** Every field answered, including the optional and the sensitive ones. */
const EVERYTHING = {
  ...REALISTIC,
  goal: 'meet_prep',
  competition_date: '2026-11-14',
  gender: 'self_described',
  gender_self_described: 'agender',
  pronouns: 'they/them',
  gym_chains: ['planet_fitness', 'ymca'],
  gym_label: 'the one on Kietzke Lane',
  smallest_plate_pair: '2.5',
  health_restrictions: 'Left shoulder impingement, cleared to press below parallel.',
  glp1_status: 'declined_to_say',
  sleep_hours_typical: '7',
  alcohol_units_per_week: '3',
  nicotine_use: 'none',
  nutrition_notes: 'Cutting to 181.',
  cleared_to_train: true,
};

function parse(form) {
  return ProfileUpdate.safeParse(toPayload(form));
}

/** Names the fields, so a failure says what is wrong rather than "false". */
function rejectedFields(result) {
  return result.success ? [] : Object.keys(result.error.flatten().fieldErrors);
}

describe('what the form sends is what the API accepts', () => {
  test('AN UNTOUCHED FORM PRODUCES A VALID PAYLOAD', () => {
    // The bug, exactly: a form nobody has typed into. Required fields are
    // still empty, and that is the browser's business, not the schema's -
    // every column here is nullable. What must not happen is a field being
    // sent in a shape the schema cannot accept at all.
    const result = parse(EMPTY);
    assert.deepEqual(rejectedFields(result), [], 'an empty form must not be structurally invalid');
  });

  test('a realistically filled form produces a valid payload', () => {
    assert.deepEqual(rejectedFields(parse(REALISTIC)), []);
  });

  test('a form with every field answered produces a valid payload', () => {
    assert.deepEqual(rejectedFields(parse(EVERYTHING)), []);
  });

  test('every goal the form offers is accepted', () => {
    // Read from the page rather than restated, so a new goal is covered the
    // day it is added instead of the day somebody remembers this file.
    const page = readGoalOptions();
    assert.ok(page.length >= 6, `expected the goal list, found ${page.length}`);
    for (const goal of page) {
      const form = { ...REALISTIC, goal };
      assert.deepEqual(rejectedFields(parse(form)), [], `goal ${goal} was rejected`);
    }
  });

  test('every GLP-1 answer the form offers is accepted, and no answer is too', () => {
    for (const glp1_status of ['', 'none', 'using', 'considering', 'declined_to_say']) {
      const form = { ...REALISTIC, goal: 'body_composition', glp1_status };
      assert.deepEqual(
        rejectedFields(parse(form)),
        [],
        `glp1_status ${JSON.stringify(glp1_status)} was rejected`
      );
    }
  });

  test('AND THE EMPTY STRING IS STILL REJECTED BY THE SCHEMA ITSELF', () => {
    // The guard rather than the fix: this proves the payload builder is doing
    // the translating, not that the schema quietly started accepting ''. If
    // somebody ever loosens the schema to make the symptom go away, this fails
    // and says why the loosening is the wrong repair.
    const result = ProfileUpdate.safeParse({ ...toPayload(REALISTIC), glp1_status: '' });
    assert.deepEqual(rejectedFields(result), ['glp1_status']);
  });

  test('a meet date survives, and a date on a non-meet goal is dropped', () => {
    const withMeet = toPayload({ ...REALISTIC, goal: 'meet_prep', competition_date: '2026-11-14' });
    assert.equal(withMeet.competition_date, '2026-11-14');

    // Migration 0019's CHECK: a stale date left behind by changing the goal
    // would violate the constraint on save.
    const changedGoal = toPayload({
      ...REALISTIC,
      goal: 'general_strength',
      competition_date: '2026-11-14',
    });
    assert.equal(changedGoal.competition_date, null);
    assert.deepEqual(rejectedFields(ProfileUpdate.safeParse(changedGoal)), []);
  });

  test('the payload carries no key the schema does not know', () => {
    // The schema is .strict(), so parse() covers this - but naming it makes
    // the failure readable when somebody adds a field to EMPTY and forgets the
    // schema, which is the mirror of the bug this file is about.
    const result = parse(EVERYTHING);
    const unknown = result.success
      ? []
      : result.error.issues.filter((i) => i.code === 'unrecognized_keys').flatMap((i) => i.keys ?? []);
    assert.deepEqual(unknown, []);
  });

  test('MEET_GOALS matches the goals the schema allows a date for', () => {
    // Two copies of one rule - the client drops the date, the server refines
    // against it. They have to name the same goals.
    const schemaSource = readSchemaSource();
    for (const goal of MEET_GOALS) {
      assert.ok(schemaSource.includes(`'${goal}'`), `${goal} is missing from the schema`);
    }
  });
});

describe('a rejected field can be named to the person', () => {
  test('every field the form holds has a label', () => {
    const unlabelled = Object.keys(EMPTY).filter((field) => !FIELD_LABELS[field]);
    assert.deepEqual(
      unlabelled,
      [],
      'a field with no label is shown to the athlete as a database column name'
    );
  });

  test('every label resolves to a real string', () => {
    // These are looked up through t() with a computed key, so i18n.test.js's
    // literal-call scan cannot see them.
    const broken = Object.entries(FIELD_LABELS).filter(([, key]) => {
      const value = key.split('.').reduce((node, part) => node?.[part], en);
      return typeof value !== 'string' || value.trim() === '';
    });
    assert.deepEqual(broken.map(([field, key]) => `${field} -> ${key}`), []);
  });

  test('and the form puts them in front of the person who pressed Save', () => {
    const page = readSource(new URL('../../web/src/pages/Intake.jsx', import.meta.url));
    assert.match(page, /err\?\.details\?\.fields/);
    assert.match(page, /setMissing\(/);
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

function readSchemaSource() {
  return readRaw(new URL('../src/lib/profileSchema.js', import.meta.url));
}

/** The goal values the form offers, read out of the page. */
function readGoalOptions() {
  const page = readSource(new URL('../../web/src/pages/Intake.jsx', import.meta.url));
  const match = page.match(/const GOAL_OPTIONS = \[([\s\S]*?)\]/);
  assert.ok(match, 'GOAL_OPTIONS is no longer where this test looks for it');
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

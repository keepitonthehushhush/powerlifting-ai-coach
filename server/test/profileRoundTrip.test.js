import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase, readProfileApi } from './helpers/source.js';
import { ProfileUpdate, describeValidationFailure } from '../src/lib/profileSchema.js';

/**
 * ── THE BUG THIS FILE EXISTS FOR ────────────────────────────────────────────
 *
 * "I set a handle but when I press join the leaderboard, it says invalid
 * profile data."
 *
 * The leaderboard page did `saveProfile({ ...profile, display_name: handle })`
 * - the obvious thing to write. GET /profile returns `select('*')`, so that
 * object carried user_id, created_at and updated_at into a PUT validated by a
 * `.strict()` schema, which rejects any key it does not know.
 *
 * Two separate defects, and the second is why there was nothing to go on:
 *
 *   1. A read was round-tripped into a write.
 *   2. The 400 said "Invalid profile data." and carried NO detail, because
 *      zod files unrecognized-key issues under formErrors (empty path) and the
 *      route only forwarded fieldErrors. The one thing the server knew - the
 *      list of offending key names - was the one thing it did not say.
 *
 * The second is the worse one. A validation error that cannot name the field
 * is a shrug with a status code.
 */

const profileRoute = readProfileApi();
const schemaSourceRaw = readRaw(new URL('../src/lib/profileSchema.js', import.meta.url));

/** Every page that writes to the profile. */
const WRITERS = ['../../web/src/pages/Leaderboard.jsx', '../../web/src/pages/Intake.jsx'];

describe('nothing round-trips a profile read into a profile write', () => {
  test('NO CALLER SPREADS A FETCHED PROFILE INTO saveProfile', () => {
    // The exact shape of the bug, asserted for every writer rather than
    // only the one that had it.
    for (const path of WRITERS) {
      const source = readSource(new URL(path, import.meta.url));
      assert.ok(
        !/saveProfile\(\s*\{\s*\.\.\.\s*profile\b/.test(source),
        `${path} spreads a fetched profile into saveProfile - GET returns select('*') and PUT is .strict()`,
      );
    }
  });

  test('the leaderboard sends only the field it is changing', () => {
    const page = readSource(new URL('../../web/src/pages/Leaderboard.jsx', import.meta.url));
    assert.match(page, /saveProfile\(\{ display_name: handle \}\)/);
  });

  test('and the reason is written down where the next person would repeat it', () => {
    const page = readRaw(new URL('../../web/src/pages/Leaderboard.jsx', import.meta.url));
    assert.match(page, phrase('Round-tripping a read into a write is the habit that caused this'));
  });
});

describe('the validation error names what was wrong', () => {
  /**
   * These used to match source text - one of them pinned the trailing comma of
   * the ternary the message was built with. Two of the three then FAILED on a
   * correct change, which is the fourth time a text-pinned assertion in this
   * repository has blocked a fix rather than caught a bug. The message builder
   * is a function now, so these run it.
   */
  function failureFor(body) {
    const parsed = ProfileUpdate.safeParse(body);
    assert.equal(parsed.success, false, 'this fixture was supposed to be invalid');
    return describeValidationFailure(parsed.error);
  }

  const VALID = { units: 'lb', goal: 'general_strength' };

  test('IT DOES NOT RELY ON fieldErrors ALONE', () => {
    // fieldErrors is {} for an unrecognized-key failure, which is the most
    // common way this route is misused. Forwarding only that produced a 400
    // with an empty body.
    const failure = failureFor({ ...VALID, user_id: 'abc', created_at: 'x' });
    assert.deepEqual(failure.details.fields, {}, 'the premise: zod files these under formErrors');
    assert.deepEqual(failure.details.unknownKeys.sort(), ['created_at', 'user_id']);
  });

  test('the message lists the offending keys, in the message itself', () => {
    // Not only in a details object - the client renders err.message, so a
    // detail nobody displays is a detail nobody reads.
    const failure = failureFor({ ...VALID, user_id: 'abc', created_at: 'x' });
    assert.match(failure.message, /user_id/);
    assert.match(failure.message, /created_at/);
    assert.match(failure.message, phrase('Send only the fields you are changing'));
  });

  test('AND AN ORDINARY BAD VALUE IS NAMED TOO', () => {
    // The gap that shipped: a rejected value is not an unknown key, so it fell
    // through to a bare "Invalid profile data." A single hidden select sending
    // an empty string was enough to stop every athlete finishing intake, and
    // the error told them nothing about which field to look at.
    const failure = failureFor({ ...VALID, glp1_status: '', days_per_week: 40 });
    assert.match(failure.message, /glp1_status/);
    assert.match(failure.message, /days_per_week/);
    assert.doesNotMatch(failure.message, /does not accept/, 'that is the unknown-key sentence');
    assert.ok(failure.details.fields.glp1_status, 'the detail carries the specifics');
  });

  test('and a failure with neither still says something rather than nothing', () => {
    const failure = failureFor([]);
    assert.equal(typeof failure.message, 'string');
    assert.ok(failure.message.length > 0);
  });

  test('the reasoning survives, because this will look like over-explaining later', () => {
    assert.match(schemaSourceRaw, phrase('That is not a validation message, it is a shrug'));
  });
});

describe('the schema and the database agree about a handle', () => {
  const migration = readRaw(new URL('../../supabase/migrations/0026_leaderboard.sql', import.meta.url));

  test('same character rule in zod, in the CHECK, and in the button that submits it', () => {
    // Three places, one rule. If they drift, the button offers something the
    // database refuses, which is the class of bug this whole file is about.
    const page = readSource(new URL('../../web/src/pages/Leaderboard.jsx', import.meta.url));
    assert.match(profileRoute, /regex\(\/\^\[A-Za-z0-9_-\]\+\$\/\)/);
    assert.match(migration, /display_name ~ '\^\[A-Za-z0-9_-\]\+\$'/);
    assert.match(page, /\/\^\[A-Za-z0-9_-\]\{3,24\}\$\/\.test\(handle\)/);
  });

  test('and the same length bounds', () => {
    assert.match(profileRoute, /\.min\(3\)\s*\.max\(24\)/);
    assert.match(migration, /length\(display_name\) between 3 and 24/);
  });
});

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';

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

const profileRoute = readSource(new URL('../src/routes/profile.js', import.meta.url));
const profileRouteRaw = readRaw(new URL('../src/routes/profile.js', import.meta.url));

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
  test('IT DOES NOT RELY ON fieldErrors ALONE', () => {
    // fieldErrors is {} for an unrecognized-key failure, which is the most
    // common way this route is misused. Forwarding only that produced a 400
    // with an empty body.
    assert.match(profileRoute, /unrecognized_keys/);
    assert.match(profileRoute, /formErrors/);
  });

  test('the message lists the offending keys, in the message itself', () => {
    // Not only in a details object - the client renders err.message, so a
    // detail nobody displays is a detail nobody reads.
    assert.match(profileRoute, /the profile does not accept \(\$\{unknownKeys\.join\(', '\)\}\)/);
    assert.match(profileRoute, phrase('Send only the fields you are changing'));
  });

  test('and it still says something sensible for an ordinary bad value', () => {
    // A number out of range is not an unknown key, and must not get the
    // unknown-key sentence.
    assert.match(profileRoute, /'Invalid profile data\.',/);
  });

  test('the reasoning survives, because this will look like over-explaining later', () => {
    assert.match(profileRouteRaw, phrase('That is not a validation message, it is a shrug'));
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

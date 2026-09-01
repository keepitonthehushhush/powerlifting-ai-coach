import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const SNAPSHOT = new URL('../../supabase/migrations/function-owners.json', import.meta.url);

/**
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Migrations reach production BY HAND. `npm run db:replay` refuses the
 * production project by ref on purpose and the CLI is not wired up, so a
 * migration ships when somebody opens the file and pastes it into the SQL
 * editor. That makes the number on the filename a claim about ordering that
 * nothing enforces, and it makes two orderings possible for the same
 * directory: numeric, when a database is rebuilt from these files, and
 * chronological, when a person pastes whatever is new.
 *
 * The guardian-consent branch made both failures at once. It was written as
 * 0036 against a database at 0035, sat unmerged while main reached 0053, and
 * restated two functions that migrations 0052 and 0053 had since changed. On
 * a rebuild it would have run seventeenth and been overwritten; pasted into
 * production it would have run last and done the overwriting - removing the
 * second-factor gate from set_leaderboard_opt_in() and the training-intention
 * sweep from apply_retention().
 *
 * Nothing would have failed. `create or replace function` replaces rather
 * than merges and reports success either way, and a sweep that stops clearing
 * a column raises no error.
 */
describe('THE MIGRATIONS ARE ORDERED, AND THE ORDER MEANS SOMETHING', () => {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();

  test('the directory is the real one', () => {
    // A reader that finds nothing agrees with every assertion below it.
    assert.ok(files.length > 40, `found ${files.length} numbered migrations - wrong directory?`);
  });

  test('no two migrations share a number', () => {
    /*
     * Two files numbered 0045 is not a style problem. `ls` sorts them
     * alphabetically, which is not an order anybody chose, and the ledger
     * that records what has been applied stores one number per row - so the
     * second one is invisible to it whichever way it went in.
     */
    const seen = new Map();
    const clashes = [];
    for (const file of files) {
      const number = file.slice(0, 4);
      if (seen.has(number)) clashes.push(`${number}: ${seen.get(number)} and ${file}`);
      else seen.set(number, file);
    }
    assert.deepEqual(clashes, [], `two migrations cannot share a number:\n  ${clashes.join('\n  ')}`);
  });

  test('the newest file defining each function is the one recorded', () => {
    /*
     * ── THE ONE THAT ACTUALLY BITES, AND WHY IT IS A SNAPSHOT ─────────────
     *
     * If 0036 and 0052 both define set_leaderboard_opt_in(), the numbers say
     * 0052 wins and the paste order says whoever went last wins. Those are
     * the same answer only while every file has already been applied - which
     * is exactly not the case for a migration that has been sitting on a
     * branch.
     *
     * A plain rule cannot express that. "An older file may not define a
     * function a newer file also defines" is violated by a dozen legitimate
     * pairs in this directory, because restating a function IS how this
     * project changes one; the difference is whether the older file has
     * already run, which no file on disk knows. The first version of this
     * test papered over that with `Number(older.slice(0, 4)) > 53`, a
     * hardcoded high-water mark that would have passed vacuously the day
     * after it was written - the same defect it was written to catch.
     *
     * So it is a snapshot instead. Every function defined more than once is
     * recorded with the file that currently owns it. Restating a function in
     * a new migration changes one line here and the diff says so; restating
     * one in an OLD migration changes the owner, and that line is the whole
     * warning. Neither is forbidden - both have to be looked at.
     */
    const definitions = new Map();
    for (const file of files) {
      const sql = readFileSync(new URL(file, MIGRATIONS), 'utf8');
      // Name plus argument list, so an overload is its own function - which
      // is what Postgres thinks too.
      for (const [, signature] of sql.matchAll(
        /create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_]+\s*\([^)]*\))/gis
      )) {
        const key = signature.replace(/\s+/g, ' ').toLowerCase();
        if (!definitions.has(key)) definitions.set(key, []);
        definitions.get(key).push(file);
      }
    }

    assert.ok(definitions.size > 10, `parsed ${definitions.size} definitions - the regex is wrong`);

    const owners = {};
    for (const [signature, where] of [...definitions].sort()) {
      if (where.length < 2) continue;
      owners[signature] = { owner: where[where.length - 1], alsoIn: where.slice(0, -1) };
    }

    const recorded = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    assert.deepEqual(
      owners,
      recorded,
      'the file that owns a function has changed. If a new migration restates one, ' +
        'update supabase/migrations/function-owners.json. If an OLDER file has become ' +
        'an owner, something unapplied is about to overwrite something applied - ' +
        'renumber it to the top and bring forward whatever it would have undone.'
    );
  });
});

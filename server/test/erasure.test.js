import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readSource, readRaw, latestDefinition, phrase } from './helpers/source.js';

/**
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * `delete_my_account` existed in production, with the right body, the right
 * SECURITY DEFINER, the right comment - in the `private` schema. Account
 * deletion was broken the whole time.
 *
 * supabase-js resolves `.rpc('name')` against the client's schema, which is
 * `public`, and PostgREST does not expose `private`. So the call returned
 * PGRST202, the route mapped it to `storage_unavailable`, and an athlete
 * exercising their right to erasure was told "Could not delete the account."
 *
 * Nothing failed. Every test passed, because the tests mock `rpc` and a mock
 * answers to any name. The schema was never asserted against the call. It was
 * found by replaying all 34 migrations into an empty project and diffing the
 * result against production - one difference in the whole schema, and it was
 * this one.
 *
 * The catalog half of this is in scripts/check-db-invariants.mjs, which
 * checks the live database. This half checks the intent, so a migration that
 * moves it again fails in CI rather than in somebody's erasure request.
 */

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const allMigrations = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(new URL(name, MIGRATIONS), 'utf8') }));

describe('erasure is reachable from the API, not merely present in the database', () => {
  const { file, body } = latestDefinition('function public.delete_my_account');

  test('THE FUNCTION IS IN public, WHERE POSTGREST CAN SEE IT', () => {
    assert.match(body, /^create or replace function public\.delete_my_account\(\)/);
    assert.ok(file, 'no migration defines it at all');
  });

  test('and no migration puts it anywhere else', () => {
    // The failure was a second copy, not a missing one. Two functions with one
    // name in two schemas is how somebody fixes the wrong one.
    for (const { name, sql } of allMigrations) {
      assert.ok(
        !/create (or replace )?function private\.delete_my_account/.test(sql),
        `${name} defines private.delete_my_account`
      );
    }
  });

  test('it is SECURITY DEFINER with a pinned search_path', () => {
    // It deletes from auth.users, which authenticated cannot touch. Definer
    // rights with an unpinned search_path is the classic escalation shape.
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
  });

  test('AND IT TAKES NO ARGUMENT, SO THE TARGET CANNOT BE REDIRECTED', () => {
    // The reason this is allowed to be definer at all: there is no parameter
    // to manipulate. The row deleted is auth.uid() and nothing else.
    assert.match(body, /delete from auth\.users where id = v_user/);
    assert.match(body, /v_user uuid := auth\.uid\(\)/);
    assert.doesNotMatch(body, /function public\.delete_my_account\([^)]/);
  });

  test('authenticated can execute it and anon cannot', () => {
    const migration = allMigrations.find((m) => m.name === file).sql;
    assert.match(migration, /revoke all on function public\.delete_my_account\(\) from public, anon;/);
    assert.match(migration, /grant execute on function public\.delete_my_account\(\) to authenticated;/);
  });

  test('THE ROUTE CALLS IT UNQUALIFIED, WHICH IS WHY THE SCHEMA MATTERS', () => {
    /*
     * The link between the two halves. If this ever becomes a schema-qualified
     * call, or the client is built with `db: { schema: ... }`, the assertions
     * above stop describing what happens at runtime and this test should be
     * rewritten rather than deleted.
     */
    const route = readSource(new URL('../src/routes/account.js', import.meta.url));
    assert.match(route, /\.rpc\('delete_my_account'\)/);

    const client = readSource(new URL('../src/lib/supabase.js', import.meta.url));
    assert.doesNotMatch(client, /db:\s*\{/, 'the client selects a schema; the rpc no longer resolves to public');
  });

  test('and the reasoning survives, because "it exists in the database" looks like enough', () => {
    assert.match(
      readRaw(new URL('../../supabase/migrations/0035_three_things_the_replay_found.sql', import.meta.url)),
      phrase('PostgREST does not expose `private`')
    );
  });
});

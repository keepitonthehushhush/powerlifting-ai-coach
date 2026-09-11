import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readSource } from './helpers/source.js';

/**
 * Does the subject access request actually cover every table?
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The export route lists its tables by hand, in a fixed array, destructured
 * positionally. Adding a table to the schema and forgetting to add it here
 * produces no error, no warning and no failing test - just an export that
 * quietly omits somebody's data, discovered by the one person least able to
 * do anything about it.
 *
 * That is not hypothetical. Adding user_preferences in migration 0045 needed
 * three separate edits to this one route - the query, the destructure, and the
 * emitted document - and only the first is obvious. Nothing was checking.
 *
 * So the schema is the source of truth: every `create table public.*` in the
 * migrations must either appear in the export or be named below with a reason.
 * Adding a table now forces a decision about whether it is personal data,
 * which is the decision somebody should be making anyway.
 */

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const exportRoute = readSource(new URL('../src/routes/account.js', import.meta.url));

/**
 * Tables that are deliberately NOT in a subject access request.
 *
 * Each one needs a reason, and the reason has to be about the DATA rather than
 * about the effort. "Nobody has asked for it" is not on this list.
 */
const NOT_PERSONAL_DATA = {
  exercise_library: 'shared reference content, identical for every account and about no one',
  policy_versions: 'the published text of our own policies, readable without an account',
  retention_periods: 'configuration - how long we keep things, not a record about a person',
  rate_limit_counters: 'transient counters, swept continuously; keyed by user but holds no history',
  stripe_events:
    'raw webhook envelopes from Stripe. The account-relevant state is mirrored into ' +
    'subscriptions, which IS exported, and Stripe holds the originals under its own ' +
    'subject access process - which the export document names.',
};

/**
 * Tables the export DOES include, but not through `from('name')`.
 *
 * leaderboard_entries is read through a definer function because migration
 * 0039 revoked user_id from `authenticated`, so the export cannot filter on it
 * any more (see 0042). Recognizing only `from(...)` would report it as missing
 * and push somebody toward "adding" data that is already there.
 */
const EXPORTED_VIA = {
  leaderboard_entries: "rpc('my_leaderboard_entry')",
  // Same reason: `authenticated` holds no grant in `private`, and that absence
  // is what makes the trial counter impossible to reset from a network tab.
  // Granting select for the sake of an export would undo the design.
  trial_usage: "rpc('trial_status')",
  /*
   * And the same again for an outside-tracker connection (0070), with one
   * extra reason on top: the row holds a bearer credential for somebody's
   * account on another service. The export carries the connection's STATE -
   * connected, since when, how far the sync reached - and never the key.
   *
   * That is not the usual "this is not personal data" exemption. The
   * connection IS the subject's data and it is in the document. The secret is
   * a liability held on their behalf, and an export is a file people email to
   * themselves and leave in cloud storage.
   */
  hevy_connections: "rpc('hevy_connection_status')",
};

/**
 * ── BOTH SCHEMAS, AND THAT WAS A REAL OMISSION ────────────────────────────
 *
 * This read `create table ... public.<name>` only. Every user-scoped table WAS
 * in public when it was written, and the one that lives in private today -
 * rate_limit_counters - was created in public by 0005 and moved by 0006, so
 * its name is still in the historical scan and its exclusion entry still
 * works. The premise held by accident.
 *
 * private.trial_usage (0057) is the first table in this schema born private.
 * The guard could not see it, nothing failed, and a subject access request
 * quietly omitted how many free replies somebody had used - a legal obligation
 * answered incompletely by a check that had silently stopped covering the
 * schema it claims to cover.
 */
function declaredTables() {
  const names = new Set();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(new URL(file, MIGRATIONS), 'utf8');
    for (const [, name] of sql.matchAll(/create table (?:if not exists )?(?:public|private)\.([a-z_]+)/g)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

describe('the data export covers the whole schema', () => {
  test('the migrations declare tables at all, or this test proves nothing', () => {
    // The guard on the guard. A regex that silently matches nothing would make
    // every assertion below vacuously true - which is the failure mode this
    // project keeps finding, so it gets checked rather than assumed.
    const tables = declaredTables();
    assert.ok(tables.length >= 10, `found only ${tables.length} tables - the pattern stopped matching`);
    assert.ok(tables.includes('user_profile'), 'user_profile not found - the pattern is wrong');
    /*
     * A PRIVATE TABLE BY NAME. The pattern used to match only `public.` and so
     * could never see a table born in private - which is exactly how
     * trial_usage escaped this check. Naming one here means the blind spot
     * cannot come back without a red test.
     */
    assert.ok(
      tables.includes('trial_usage'),
      'no private table found - the scan has gone back to public-only and is blind again'
    );
  });

  test('every table is either exported or explicitly excluded, with a reason', () => {
    const missing = [];
    for (const table of declaredTables()) {
      if (table in NOT_PERSONAL_DATA) continue;
      const accessor = EXPORTED_VIA[table] ?? `from('${table}')`;
      if (!exportRoute.includes(accessor)) missing.push(table);
    }
    assert.deepEqual(
      missing,
      [],
      `these tables are in the schema but not in the export, and not excluded with a reason: ${missing.join(', ')}`,
    );
  });

  test('the exclusions and special cases are real tables, not stale names', () => {
    // An entry for a table that no longer exists is a comment pretending to be
    // a decision, and it hides the next real omission behind noise.
    const tables = new Set(declaredTables());
    for (const name of [...Object.keys(NOT_PERSONAL_DATA), ...Object.keys(EXPORTED_VIA)]) {
      assert.ok(tables.has(name), `${name} is listed here but is not in the schema`);
    }
  });

  test('every exclusion states why', () => {
    for (const [name, reason] of Object.entries(NOT_PERSONAL_DATA)) {
      assert.ok(reason.length > 20, `${name} is excluded without a real reason`);
    }
  });

  test('the leaderboard row is exported even though it is fetched differently', () => {
    // It comes through a definer function rather than a select, because 0039
    // revoked user_id. A `from('leaderboard_entries')` check would miss it, so
    // it is excluded from the loop above by being fetched another way - assert
    // it directly rather than let it fall through a gap between two rules.
    assert.match(exportRoute, /rpc\('my_leaderboard_entry'\)/);
  });
});

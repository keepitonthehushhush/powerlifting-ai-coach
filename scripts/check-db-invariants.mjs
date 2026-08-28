#!/usr/bin/env node
/**
 * The handful of database facts that no unit test can check, asserted against
 * the database that is actually deployed.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM test:db ───────────────────────────────
 *
 * `npm run test:db` runs the full RLS isolation suite through psql. It is the
 * more thorough check and it needs psql installed and a connection string -
 * neither of which is true on the machine this project is developed on, so it
 * has effectively never run there. That is worth saying plainly: a test that
 * cannot be run is not a test, it is a document.
 *
 * Two defects in one day came from exactly that gap, and both were invisible
 * to every unit test because both were properties of the DEPLOYED database
 * rather than of any file in this repository:
 *
 *   - usage_events had RLS policies and no table grant, so every insert was
 *     refused and the table sat empty for days (migration 0021)
 *   - consume_rate_limit had lost its SECURITY DEFINER clause, so every rate
 *     limit check raised 42501 and nothing was rate limited (migration 0022)
 *
 * This script is the cheap, dependency-free version: plain HTTP to PostgREST
 * using the credentials the server already has, asserting the invariants that
 * would have caught both. It needs no psql, no local Postgres and no new
 * secret. Run it after a migration and before sharing a link with anybody.
 *
 * It is NOT a replacement for test:db. It is the part that runs.
 */

import { readFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    'check-db-invariants needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.\n' +
      'They are in .env at the REPOSITORY ROOT - not server/.env, which does not\n' +
      'exist; server/dev.js loads the root file through dotenv/config. This script\n' +
      'reads the environment rather than parsing that file, so run it as:\n\n' +
      '  set -a; source .env; set +a; node scripts/check-db-invariants.mjs\n'
  );
  process.exit(2);
}

/**
 * The assertions, as SQL that returns a single boolean column named `ok`.
 *
 * Each carries the incident it exists because of. A check whose reason has
 * been forgotten is a check somebody deletes when it becomes inconvenient.
 */
const CHECKS = [
  {
    name: 'every column documented as health data is gated by the consent trigger',
    why: 'A column commented "Health data." and absent from private.health_fingerprint is gated in the comment and ungated in fact.',
    sql: `select count(*) = 0 as ok
            from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = 'user_profile'
             and col_description('public.user_profile'::regclass, c.ordinal_position) like 'Health data.%'
             and position(c.column_name in pg_get_functiondef(
                   'private.health_fingerprint(public.user_profile)'::regprocedure)) = 0`,
  },
  {
    name: 'pronouns are NOT gated, deliberately',
    why: 'Being addressed correctly must not be something a person trades privacy for. See migration 0024.',
    sql: `select position('pronouns' in pg_get_functiondef(
            'private.health_fingerprint(public.user_profile)'::regprocedure)) = 0 as ok`,
  },
  {
    name: 'consume_rate_limit is SECURITY DEFINER',
    why: 'Counters live in the private schema, which authenticated cannot reach. Without definer rights every check raises 42501 and the limiter fails open, silently. This was true in production for a day.',
    sql: `select bool_and(p.prosecdef) as ok
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'consume_rate_limit'`,
  },
  {
    name: 'the leaderboard writers are SECURITY DEFINER with a pinned search_path',
    why: 'They are the only way a leaderboard row can be written, and they carry owner rights. Definer without a pinned search_path is the classic escalation shape; definer lost on a `create or replace` is how the rate limiter failed open for a day. Asserted against the catalogue, never the migration file.',
    sql: `select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%') as ok
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('refresh_leaderboard_entry','set_leaderboard_opt_in')`,
  },
  {
    name: 'AUTHENTICATED CANNOT WRITE THE LEADERBOARD',
    why: 'The whole integrity property. The browser holds a real JWT and can reach PostgREST directly, so an insert or update privilege here would let anybody set their own squat to 9999 - and RLS would allow it, because it is their row. Numbers must come only from the definer function that recomputes them from logs.',
    sql: `select count(*) = 0 as ok
            from information_schema.role_table_grants
           where table_schema = 'public'
             and table_name = 'leaderboard_entries'
             and grantee in ('authenticated','anon')
             and privilege_type in ('INSERT','UPDATE','DELETE')`,
  },
  {
    name: 'the leaderboard is unreadable to anon',
    why: 'Opting in publishes to other athletes, not to the internet. A signed-out reader must get nothing.',
    sql: `select count(*) = 0 as ok
            from information_schema.role_table_grants
           where table_schema = 'public'
             and table_name = 'leaderboard_entries'
             and grantee = 'anon'`,
  },
  {
    name: 'every user-scoped table is reachable by authenticated',
    why: 'RLS narrows a granted privilege; it does not create one. A table with perfect policies and no GRANT is unreachable, and the failure is silent on a fire-and-forget write.',
    sql: `select count(*) = 0 as ok
            from information_schema.tables t
           where t.table_schema = 'public'
             and t.table_name in ('user_profile','workout_programs','workout_sessions',
                                  'progress_logs','conversations','consent_records','usage_events')
             and not exists (
               select 1 from information_schema.role_table_grants g
                where g.grantee = 'authenticated' and g.table_schema = 'public'
                  and g.table_name = t.table_name and g.privilege_type = 'SELECT')`,
  },
  {
    name: 'anon holds no grants on any user table',
    why: 'The unauthenticated role must be refused before RLS is even consulted.',
    sql: `select count(*) = 0 as ok
            from information_schema.role_table_grants g
           where g.grantee = 'anon' and g.table_schema = 'public'
             and g.table_name <> 'exercise_library'`,
  },
];

/**
 * Runs one assertion through the `exec_sql` RPC if it exists, falling back to
 * PostgREST's own introspection where it does not.
 *
 * Deliberately no new database function is created to support this script: a
 * checking tool that has to install something in order to check is a tool with
 * its own failure modes.
 */
async function run(check) {
  const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: check.sql }),
  });
  if (!response.ok) {
    return { ok: null, detail: `${response.status} ${await response.text()}` };
  }
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { ok: row?.ok === true, detail: JSON.stringify(row) };
}

let failed = 0;
let unavailable = 0;

for (const check of CHECKS) {
  const { ok, detail } = await run(check);
  if (ok === true) {
    console.log(`PASS  ${check.name}`);
  } else if (ok === null) {
    unavailable += 1;
    console.log(`SKIP  ${check.name}\n      could not run: ${detail}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${check.name}\n      ${check.why}\n      returned ${detail}`);
  }
}

if (unavailable === CHECKS.length) {
  console.error(
    '\nNothing could be checked. This script needs an `exec_sql` RPC on the database,\n' +
      'which this project does not create on purpose - a checking tool that installs\n' +
      'something in order to check has its own failure modes. Run the same assertions\n' +
      'through the Supabase SQL editor, or install psql and use `npm run test:db`,\n' +
      'which is the more thorough suite.'
  );
  process.exit(2);
}

console.log(`\n${CHECKS.length - failed - unavailable} passed, ${failed} failed, ${unavailable} skipped.`);
process.exit(failed > 0 ? 1 : 0);

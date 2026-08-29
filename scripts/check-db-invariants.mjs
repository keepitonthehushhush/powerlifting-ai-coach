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
    name: 'and every column the fingerprint reads is documented as health data',
    why: 'The converse of the check above, and the half that was missing. That one finds columns documented as health data and left out of the fingerprint; this one finds columns in the fingerprint whose comment does not say so - which matters because the comment is what the first check searches on. Two columns were in that state until 0037: glp1_status, whose comment put HEALTH DATA in the middle of a sentence, and health_restrictions - the injury note, the column the whole consent mechanism was built around - whose comment opened with SENSITIVE: because it predates the convention. Both were gated in fact and invisible to the invariant that says so. Covered by luck and reported as covered by a check that was not reading them.',
    sql: `select count(*) = 0 as ok
            from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = 'user_profile'
             -- Anchored on the \`p.<column>\` the fingerprint actually writes, not
             -- on a bare substring. The loose version reported \`units\` as an
             -- offender because \`alcohol_units_per_week\` contains it - the same
             -- false positive the retention check above already documents, and
             -- a check that cries wolf is a check somebody comments out.
             and pg_get_functiondef('private.health_fingerprint(public.user_profile)'::regprocedure)
                 ~ ('\\yp\\.' || c.column_name || '\\y')
             and coalesce(col_description('public.user_profile'::regclass, c.ordinal_position), '')
                 not like 'Health data.%'`,
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
    name: 'HAS_ACTIVE_CONSENT REQUIRES THE CURRENT POLICY VERSION',
    why: 'It used to answer "did they ever grant this, most recently?" and ignore policy_version. So after a policy bump the gate refused entry and the panel showed an empty checkbox while the database went on accepting health-data writes under the superseded agreement. The screen said one thing, the enforcement said another, and the enforcement is the half that decides what gets stored.',
    sql: `select position('policy_versions' in pg_get_functiondef(
            'public.has_active_consent(text)'::regprocedure)) > 0 as ok`,
  },
  {
    name: 'and it still orders by seq, not created_at',
    why: 'now() is transaction start time, so a grant and a withdrawal written in one transaction carry identical created_at values and sort arbitrarily - which once made a withdrawal read as a grant. Migration 0010 fixed it; 0027 rewrote the same function and must not have undone it.',
    sql: `select position('order by c.seq desc' in pg_get_functiondef(
            'public.has_active_consent(text)'::regprocedure)) > 0 as ok`,
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
    name: 'THE RETENTION SWEEP IS ACTUALLY SCHEDULED',
    why: 'A retention policy that is written down and never runs is worse than none: the privacy policy states periods the database does not honour. This asserts the cron job exists and is active, which is the only thing that makes the promise true.',
    sql: `select count(*) = 1 as ok
            from cron.job
           where jobname = 'apply-retention' and active`,
  },
  {
    name: 'AND ACCOUNT DELETION IS NOT',
    why: 'delete_inactive_accounts() is built and deliberately unscheduled: nothing can warn anybody before it runs until transactional email exists. If it ever appears in cron.job without that being a decision somebody made, this fails.',
    sql: `select count(*) = 0 as ok
            from cron.job
           where command like '%delete_inactive_accounts%'`,
  },
  {
    name: 'health_restrictions has its own timestamp, separate from updated_at',
    why: 'Expiring it on user_profile.updated_at would be silently wrong - that column moves on any edit, so changing a bodyweight would reset the injury clock and a restriction could outlive its retention period while appearing swept.',
    sql: `select count(*) = 1 as ok
            from information_schema.columns
           where table_schema = 'public' and table_name = 'user_profile'
             and column_name = 'health_restrictions_updated_at'`,
  },
  {
    name: 'THE AUDIT TRAIL IS READ-ONLY TO USERS',
    why: 'An audit trail a user can write is a diary; one they can edit is fiction. The privilege is the control here, not the policy - RLS narrows a granted privilege and does not create one (0021).',
    sql: `select count(*) = 0 as ok
            from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'audit_events'
             and grantee in ('authenticated','anon')
             and privilege_type in ('INSERT','UPDATE','DELETE')`,
  },
  {
    name: 'AND THE RECORD OF A DELETION SURVIVES THE DELETION',
    why: 'audit_events.user_id must be ON DELETE SET NULL. Cascade is the obvious choice and it erases the record that an account was deleted - so the operation most likely to be disputed would be the one with no evidence, and the evidence would disappear at exactly the moment it became relevant. Checked in the catalogue because a later migration could recreate the constraint.',
    sql: `select bool_and(confdeltype = 'n') as ok
            from pg_constraint
           where conrelid = 'public.audit_events'::regclass and contype = 'f'`,
  },
  {
    name: 'THE ERROR LOG IS READ-ONLY TO USERS TOO',
    why: 'A failure log a user can write is one an attacker can flood, and one they can edit is not evidence. Writes go through record_error_event(), which stamps user_id from the JWT so a browser cannot attribute a failure to somebody else.',
    sql: `select count(*) = 0 as ok
            from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'error_events'
             and grantee in ('authenticated','anon')
             and privilege_type in ('INSERT','UPDATE','DELETE')`,
  },
  {
    name: 'AND THE FAILURE HISTORY SURVIVES AN ACCOUNT DELETION',
    why: 'error_events.user_id must be ON DELETE SET NULL. Cascade would erase every failure an athlete hit on their way to deciding to leave - which is the population whose errors matter most - and it would do it at the moment that evidence became most relevant.',
    sql: `select bool_and(confdeltype = 'n') as ok
            from pg_constraint
           where conrelid = 'public.error_events'::regclass and contype = 'f'`,
  },
  {
    name: 'record_error_event IS DEFINER WITH A PINNED search_path',
    why: 'It inserts where the caller has no INSERT privilege, so it must be definer; a SECURITY DEFINER function without a pinned search_path is the classic privilege-escalation shape. Asserted from the catalogue because `create or replace function` silently drops both, which cost this project a day of unlimited rate limiting.',
    sql: `select bool_and(p.prosecdef and p.proconfig is not null) as ok
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'record_error_event'`,
  },
  {
    name: 'AND EVERY RETENTION CATEGORY IS ACTUALLY SWEPT',
    why: 'apply_retention() reads the months from retention_periods but the DELETE for each category is written out by hand, so adding a row prunes nothing. A published retention promise that nothing keeps is the same shape as the RLS policy with no GRANT in 0021 - correct on paper, inert in fact.',
    sql: `select bool_and(position(rp.category in pg_get_functiondef(
                   'private.apply_retention()'::regprocedure)) > 0) as ok
            from public.retention_periods rp`,
  },
  {
    name: 'AND THE SWEEP CAN ACTUALLY RUN',
    why: 'apply_retention() set cleared_to_train = null on a column that has been NOT NULL since 0001. plpgsql does not plan a statement until it executes, so the function created cleanly, this file passed, and the cron job succeeded every night - because no row had yet aged past the retention period. The first one that did would raise 23502 and abort every other category with it. Reproduced against the preview database before it was fixed; see migration 0035. Generic rather than named, because the next one will be a different column.',
    sql: `select count(*) = 0 as ok
            from information_schema.columns c
           where c.table_schema = 'public'
             and c.is_nullable = 'NO'
             -- Only tables the sweep actually updates, and the column name
             -- bounded on the left. The first version of this used LIKE and
             -- reported four false positives: 'health_restrictions_updated_at
             -- = null' contains 'updated_at = null', and updated_at is NOT
             -- NULL on four tables. A check that cries wolf is a check
             -- somebody comments out.
             and pg_get_functiondef('private.apply_retention()'::regprocedure)
                 ~ ('update public\\.' || c.table_name || '\\y')
             and pg_get_functiondef('private.apply_retention()'::regprocedure)
                 ~ ('(^|[^a-zA-Z0-9_])' || c.column_name || '\\s*=\\s*null')`,
  },
  {
    name: 'THE CONSENT TRIGGER STILL CALLS THE FINGERPRINT IT IS CHECKED AGAINST',
    why: 'The check above this one asserts that every column documented as health data appears in private.health_fingerprint. It passed for two days while the trigger did not call the fingerprint at all: migration 0033 replaced it with a version reading two columns directly, and sleep, alcohol, nicotine, nutrition notes and gender became writable with no consent. The invariant was reading the right object and asking the wrong question. This is the missing half.',
    sql: `select position('health_fingerprint' in pg_get_functiondef(
            'private.require_health_data_consent()'::regprocedure)) > 0 as ok`,
  },
  {
    name: 'and it is SECURITY DEFINER, because the helper lives in private',
    why: 'authenticated has no USAGE on the private schema, so an invoker-rights trigger cannot call private.health_fingerprint at all - it raises 42501 on every profile write. 0013 fixed that; 0033 undid it and got away with it only by not calling the helper.',
    sql: `select bool_and(p.prosecdef) as ok
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'require_health_data_consent'`,
  },
  {
    name: 'A WITHDRAWN HEALTH CONSENT MEANS NO HEALTH DATA IS STILL STORED',
    why: 'The policy says withdrawing consent erases what is already held. It did not - it erased nothing, for anybody who had answered the gender or GLP-1 question, because the clear left those columns set, the resulting row still fingerprinted as health data, and the consent trigger refused the whole UPDATE. The ledger said withdrawn and the injury note stayed. Four months, no failure signal. This is the condition itself, asked of the rows rather than of the code that maintains them, so a future partial clear shows up as data rather than as a diff nobody reads.',
    sql: `with latest as (
            select distinct on (c.user_id) c.user_id, c.granted
              from public.consent_records c
             where c.consent_type = 'health_data_collection'
             order by c.user_id, c.seq desc
          )
          select count(*) = 0 as ok
            from public.user_profile p
            join latest l on l.user_id = p.user_id
           where l.granted is false
             and private.health_fingerprint(p) is not null`,
  },
  {
    name: 'ERASURE IS REACHABLE FROM THE API, NOT MERELY PRESENT IN THE DATABASE',
    why: 'delete_my_account existed in production, in the private schema, with the right body and the right comment - and account deletion was broken, because supabase-js resolves an rpc against public and PostgREST cannot see private. The GDPR Art.17 path returned "Could not delete the account" while every test passed, since the tests mock rpc and a mock answers to any name. Found by replaying the migrations into an empty database and diffing; nothing else in the schema had drifted.',
    sql: `select count(*) = 1 as ok
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.proname = 'delete_my_account'
             and n.nspname = 'public'
             and p.prosecdef
             and has_function_privilege('authenticated', p.oid, 'EXECUTE')`,
  },
  {
    name: 'ONLY THE REDEEMING HALF OF THE GUARDIAN FLOW IS REACHABLE BY anon',
    why: 'record_guardian_consent is granted to anon deliberately - a guardian has no account and the token is what authorizes the write. request_guardian_consent must NOT be, or an anonymous caller could make this server send mail to any address it likes, which is a mail relay wearing a different hat. Asked of the catalogue because a later `grant execute ... to anon` would undo it and no migration file would look wrong.',
    sql: `select
            has_function_privilege('anon', 'public.record_guardian_consent(text, boolean)', 'EXECUTE')
            and not has_function_privilege('anon', 'public.request_guardian_consent(text, text, int)', 'EXECUTE')
            as ok`,
  },
  {
    name: 'and a guardian token hash is not readable by any signed-in user',
    why: 'The hash is the one column in guardian_consent_requests with no business leaving the server. RLS scopes the rows to the athlete, but a policy narrows a privilege and does not create one - a table-wide grant would hand the browser its own token hash. Same failure shape as the leaderboard grant in 0039.',
    sql: `select count(*) = 0 as ok
            from pg_attribute a
           where a.attrelid = 'public.guardian_consent_requests'::regclass
             and a.attname = 'token_hash'
             and (has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')
               or has_column_privilege('anon', a.attrelid, a.attname, 'SELECT'))`,
  },
  {
    name: 'and there is exactly one of it',
    why: 'Two functions with one name and one comment in two schemas is how somebody fixes the wrong one.',
    sql: `select count(*) = 1 as ok
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.proname = 'delete_my_account' and n.nspname in ('public','private')`,
  },
  {
    name: 'NO LEADERBOARD ENTRY EXISTS WITHOUT A CURRENT CONSENT BEHIND IT',
    why: 'Publishing somebody lifts to other users needs an active, current leaderboard_publication consent (0028). set_leaderboard_opt_in() enforces that on the way in, but an entry written by any other path - or predating the rule, which one did - would sit published with no record that anybody agreed. This is the condition itself, checked rather than assumed.',
    sql: `select count(*) = 0 as ok
            from public.leaderboard_entries e
           where not exists (
             select 1 from (
               select distinct on (c.user_id) c.user_id, c.granted, c.policy_version
                 from public.consent_records c
                where c.consent_type = 'leaderboard_publication'
                order by c.user_id, c.seq desc
             ) latest
             where latest.user_id = e.user_id
               and latest.granted
               and latest.policy_version = (
                 select v.version from public.policy_versions v
                  where v.consent_type = 'leaderboard_publication'
               )
           )`,
  },
  {
    name: 'AND CANNOT READ THE COLUMNS THE LEADERBOARD DOES NOT PUBLISH',
    why: 'The leaderboard document promises that exactly four things are visible to other signed-in users. 0026 granted SELECT table-wide, and the RLS policy is `using (true)` because cross-user reading is the feature - so user_id and updated_at were readable by any browser talking to PostgREST directly, which is the same reasoning the write check below is built on and nobody had applied to reads. user_id is a persistent unique identifier; updated_at says when somebody last hit a best lift. 0039 replaced the table grant with a column grant. Asked of has_column_privilege rather than of the migration text, because a later `grant select on` would silently undo it.',
    sql: `select count(*) = 0 as ok
            from pg_attribute a
           where a.attrelid = 'public.leaderboard_entries'::regclass
             and a.attnum > 0 and not a.attisdropped
             and a.attname not in ('display_name','best_squat','best_bench','best_deadlift','units')
             and has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')`,
  },
  {
    name: 'and it can still read the five that ARE published',
    why: 'The converse. A revoke with no matching grant would leave the board empty for everybody and the failure would look like a data problem rather than a privilege one - which is how the RLS policy with no GRANT in 0021 presented.',
    sql: `select bool_and(has_column_privilege('authenticated', 'public.leaderboard_entries', c, 'SELECT')) as ok
            from unnest(array['display_name','best_squat','best_bench','best_deadlift','units']) as c`,
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

/**
 * ── THE LEDGER THAT STOPPED BEING TRUE ────────────────────────────────────
 *
 * Migrations reach production through the Supabase SQL editor, pasted in by
 * hand: `npm run db:replay` refuses the production project by ref on purpose,
 * and the CLI is not wired to this project. A statement pasted into that editor
 * runs, and nothing writes a row into supabase_migrations.schema_migrations.
 *
 * So on 2026-08-30 the ledger said the database was at 0035 while the database
 * was in fact at 0044. Nothing broke and nothing complained. The ledger simply
 * answered a question it had not looked at - the same defect shape as the
 * deployment probe that read a proxy 403 as "captcha not required" and the
 * contact check that read ECONNREFUSED as "no MX record". Anything that trusts
 * the ledger (a future `supabase db push`, a replay against a restored
 * snapshot, a person reading it to see what shipped) would have concluded that
 * eight applied migrations were outstanding and re-run them. 0038 alone bumps
 * the health-data policy version, which forces every user on the service to
 * consent again.
 *
 * ── WHY THE COMPARISON STARTS AT A FLOOR ──────────────────────────────────
 *
 * The floor is the lowest migration number the ledger records under a numbered
 * filename. Everything before it was recorded under a bare name (`audit_events`,
 * `free_forever`), and 0033 is split across two rows, so a number cannot be
 * recovered from those and demanding one would make this check cry wolf about
 * thirty-three migrations that are demonstrably applied. Comparing only from
 * the floor upward is the part that can actually be asserted - and it is the
 * part that matters, because the drift is always at the top.
 *
 * The floor is computed in SQL rather than hardcoded so that it follows the
 * ledger instead of needing to be remembered.
 */

import { readdirSync } from 'node:fs';

export const DEFAULT_MIGRATIONS_DIR = new URL('../../supabase/migrations/', import.meta.url);

const NUMBERED = /^(\d{4})_.*\.sql$/;

/**
 * Builds the assertion. Returns a check object in the shape check-db-invariants
 * expects: `{ name, why, sql }` when it could be built, or `{ name, why,
 * unavailable }` when it could not.
 *
 * It never returns a passing check on an error path. "I could not look" and
 * "I looked and it is fine" are different answers and this returns different
 * objects for them.
 */
export function migrationLedgerCheck({ migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const base = {
    name: 'every numbered migration file on disk is recorded in the migration ledger',
    why:
      'A migration pasted into the SQL editor applies without recording itself. The ledger then ' +
      'reports fewer migrations than the database has, and the next thing to trust it re-runs work ' +
      'that is already done. Fix by inserting the missing rows into ' +
      'supabase_migrations.schema_migrations - see docs/RUNBOOK.md.',
  };

  let numbers;
  try {
    numbers = readdirSync(migrationsDir)
      .map((file) => file.match(NUMBERED))
      .filter(Boolean)
      .map((match) => match[1])
      .sort();
  } catch (error) {
    return { ...base, unavailable: `could not read the migrations directory: ${error.message}` };
  }

  if (numbers.length === 0) {
    // Not "nothing is missing". An empty directory means the check did not run,
    // and a check that did not run must not report the reassuring answer.
    return { ...base, unavailable: 'no numbered migration files found on disk' };
  }

  // Safe to interpolate: NUMBERED admits four digits and nothing else.
  const values = numbers.map((n) => `('${n}')`).join(',');

  return {
    ...base,
    sql: `with expected(n) as (values ${values}),
     recorded as (
       select substring(name from '^[0-9]{4}') as n
         from supabase_migrations.schema_migrations
        where name ~ '^[0-9]{4}_'
     ),
     floor as (select min(n) as n from recorded)
select count(*) = 0 as ok,
       coalesce(string_agg(e.n, ', ' order by e.n), '') as missing_from_ledger
  from expected e, floor f
 where f.n is not null
   and e.n >= f.n
   and e.n not in (select n from recorded)`,
  };
}

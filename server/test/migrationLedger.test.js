import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSource } from './helpers/source.js';
import { migrationLedgerCheck, DEFAULT_MIGRATIONS_DIR } from '../../scripts/lib/migrationLedger.mjs';

const invariants = readSource(new URL('../../scripts/check-db-invariants.mjs', import.meta.url));

/** A throwaway directory of migration filenames, returned as a file:// URL. */
function fixture(names) {
  const dir = mkdtempSync(join(tmpdir(), 'migledger-'));
  for (const name of names) writeFileSync(join(dir, name), '-- fixture\n');
  return { url: pathToFileURL(dir + '/'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('THE MIGRATION LEDGER CHECK', () => {
  test('the assertion names every numbered migration that exists on disk', () => {
    // The failure this guards against is silent under-reporting: a check that
    // asks about eight migrations while forty-three are on disk passes, and
    // says nothing about the thirty-five it never looked at.
    const onDisk = readdirSync(DEFAULT_MIGRATIONS_DIR)
      .map((file) => file.match(/^(\d{4})_.*\.sql$/))
      .filter(Boolean)
      .map((match) => match[1]);

    assert.ok(onDisk.length > 30, `expected the real migrations directory, found ${onDisk.length} files`);

    const { sql, unavailable } = migrationLedgerCheck();
    assert.equal(unavailable, undefined, `could not build the check: ${unavailable}`);
    for (const number of onDisk) {
      assert.ok(sql.includes(`('${number}')`), `${number} is on disk and absent from the assertion`);
    }
  });

  test('it compares from a floor the ledger supplies, not one written down here', () => {
    // Migrations before 0034 were recorded under bare names (`audit_events`,
    // `free_forever`) and 0033 under two of them, so their numbers cannot be
    // recovered. A check that demanded them would fail on thirty-three
    // migrations that are demonstrably applied, and a check that cries wolf is
    // a check somebody comments out.
    const { sql } = migrationLedgerCheck();
    assert.match(sql, /floor as \(select min\(n\) as n from recorded\)/);
    assert.match(sql, /e\.n >= f\.n/);
    // If the floor were ever null - an empty ledger - the comparison must
    // yield nothing rather than declaring everything present.
    assert.match(sql, /f\.n is not null/);
  });

  test('it reports what is missing, not merely that something is', () => {
    const { sql } = migrationLedgerCheck();
    assert.match(sql, /missing_from_ledger/);
  });
});

describe('IT NEVER ANSWERS "FINE" WHEN IT COULD NOT LOOK', () => {
  test('a directory that does not exist is unavailable, not passing', () => {
    const check = migrationLedgerCheck({ migrationsDir: new URL('file:///nonexistent-migrations-dir/') });
    assert.equal(check.sql, undefined, 'it built an assertion out of a directory it could not read');
    assert.match(check.unavailable, /could not read the migrations directory/);
  });

  test('an empty directory is unavailable, not passing', () => {
    // The reassuring reading of an empty directory is "nothing is missing".
    // It is the wrong reading: nothing was examined.
    const { url, cleanup } = fixture([]);
    try {
      const check = migrationLedgerCheck({ migrationsDir: url });
      assert.equal(check.sql, undefined);
      assert.match(check.unavailable, /no numbered migration files found/);
    } finally {
      cleanup();
    }
  });

  test('a directory of unnumbered files is unavailable, not passing', () => {
    const { url, cleanup } = fixture(['README.md', 'seed.sql', 'schema-fingerprint.sql']);
    try {
      const check = migrationLedgerCheck({ migrationsDir: url });
      assert.equal(check.sql, undefined);
      assert.match(check.unavailable, /no numbered migration files found/);
    } finally {
      cleanup();
    }
  });

  test('the runner turns an unavailable check into SKIP before it makes any request', () => {
    // Without this the check object would be fetched with `sql: undefined` and
    // the database would answer something - possibly something that parses as
    // a pass.
    assert.match(invariants, /if \(check\.unavailable\) return \{ ok: null, detail: check\.unavailable \}/);
    const runner = invariants.slice(invariants.indexOf('async function run(check)'));
    assert.ok(
      runner.indexOf('check.unavailable') < runner.indexOf('await fetch('),
      'the unavailable guard must come before the request'
    );
  });
});

describe('the check is wired into the script that runs the invariants', () => {
  test('check-db-invariants imports it and adds it to CHECKS', () => {
    assert.match(invariants, /from '\.\/lib\/migrationLedger\.mjs'/);
    assert.match(invariants, /CHECKS\.push\(migrationLedgerCheck\(\)\)/);
  });
});

describe('nothing untrusted reaches the SQL', () => {
  test('only four-digit prefixes are interpolated', () => {
    // The values list is built from filenames. A filename is not a hostile
    // input here, but it is an input, and the regex is the only thing standing
    // between it and a string-concatenated query.
    const { url, cleanup } = fixture([
      '0042_fine.sql',
      // Numbered, then hostile. Only the captured prefix may reach the query.
      "0043_'); drop table supabase_migrations.schema_migrations; --.sql",
      // Hostile in place of the separator. The pattern requires `_`, so this
      // file is not a migration at all and contributes nothing.
      "0099'); drop table supabase_migrations.schema_migrations; --.sql",
      '00a4_not_numbered.sql',
      '0044_also_fine.sql',
    ]);
    try {
      const { sql } = migrationLedgerCheck({ migrationsDir: url });
      assert.match(sql, /values \('0042'\),\('0043'\),\('0044'\)/);
      assert.doesNotMatch(sql, /drop table supabase_migrations/i);
      assert.doesNotMatch(sql, /00a4|0099/);
    } finally {
      cleanup();
    }
  });
});

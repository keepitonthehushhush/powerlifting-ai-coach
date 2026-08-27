#!/usr/bin/env node
/**
 * Runs a .sql test file against DATABASE_URL without needing psql installed.
 *
 * See scripts/lib/psqlLite.mjs for why this exists. In short: the suite it
 * runs contains the strongest security assertions in this repository and had
 * never once run on the development machine, because of a missing binary.
 */
import { readFileSync } from 'node:fs';
import { expandPsql } from './lib/psqlLite.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/run-sql-test.mjs <file.sql>');
  process.exit(2);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'Supabase gives it under Project settings -> Database -> Connection string (URI).\n' +
      'Use the session pooler URI, and keep it out of the repository.'
  );
  process.exit(2);
}

let pg;
try {
  pg = await import('pg');
} catch {
  console.error(
    'This runner needs the `pg` package, which is not installed.\n\n' +
      '  npm install --save-dev pg\n\n' +
      'It is a devDependency only - nothing that ships uses it. Installing it here rather\n' +
      'than committing a hand-edited package.json keeps package-lock.json honest.\n\n' +
      'Alternatively install psql and run the file through that:\n' +
      `  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ${file}`
  );
  process.exit(2);
}

const { sql, echoes } = expandPsql(readFileSync(file, 'utf8'));

const client = new pg.default.Client({ connectionString });
await client.connect();

try {
  // The file opens its own transaction and rolls it back at the end, so this
  // leaves nothing behind even when an assertion fails part way through.
  await client.query(sql);
  for (const line of echoes) console.log(line);
  console.log(`\nOK - ${file} ran to completion with every assertion holding.`);
} catch (error) {
  // A failed `assert` in a DO block arrives as a plain Postgres error. Print
  // it as the assertion it is rather than as a stack trace.
  console.error(`\nFAILED - ${file}`);
  console.error(`  ${error.message}`);
  if (error.where) console.error(`  at: ${error.where}`);
  process.exitCode = 1;
} finally {
  // Belt and braces: if the file threw before reaching its own rollback, the
  // connection is still inside an open transaction.
  await client.query('rollback').catch(() => {});
  await client.end();
}

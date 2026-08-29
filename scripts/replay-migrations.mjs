#!/usr/bin/env node
/**
 * Replay every migration, in order, into an empty database.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Two reasons, and the second is the one worth having.
 *
 * The immediate one: the preview project needs the schema, and the schema is
 * defined by 34 files that had never been run as a set. They were applied one
 * at a time, months apart, to a database that was never empty.
 *
 * The lasting one: "can these files rebuild the database from nothing" is a
 * question nobody had asked. It is the difference between a migration
 * directory and a pile of edits that happened to work once. The answer decides
 * whether a second environment can ever exist, whether a restore is possible,
 * and whether the files are a description of the database or merely its
 * history.
 *
 * ── WHAT IT WILL NOT DO ───────────────────────────────────────────────────
 *
 * It refuses to run against a database that already has application tables. A
 * replay is for an EMPTY project; pointing it at production would attempt to
 * recreate objects that exist and, worse, re-run the data migrations. The
 * check is on the target, not on a flag somebody passes.
 *
 * It also refuses the production project outright, by ref, because a
 * connection string is one paste away from being the wrong one.
 *
 * Usage:
 *   DATABASE_URL='postgresql://...preview...' node scripts/replay-migrations.mjs
 *   DATABASE_URL='...' node scripts/replay-migrations.mjs --dry-run
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_SUPABASE_REF } from '../server/src/lib/environment.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'migrations');
const dryRun = process.argv.includes('--dry-run');

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort(); // 0001_, 0002_ ... lexical order IS the order, by construction

if (files.length === 0) {
  console.error(`No migrations found in ${dir}.`);
  process.exit(2);
}

if (dryRun) {
  console.log(`${files.length} migrations would be applied, in this order:\n`);
  for (const name of files) console.log(`  ${name}`);
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set.\n\n' +
      'Supabase gives it under Project settings -> Database -> Connection string.\n' +
      'Take the SESSION POOLER URI, not the direct one: the direct host resolves to\n' +
      'IPv6 only, and a machine without IPv6 fails at connect with ENETUNREACH before\n' +
      'this script prints anything at all. scripts/run-sql-test.mjs has said so since\n' +
      'it was written; this one did not, and the omission cost somebody the step.\n\n' +
      'Use the PREVIEW project, not production, and keep it out of the repository.'
  );
  process.exit(2);
}

// A connection string is one paste away from being the wrong one, and the
// wrong one here is production.
if (connectionString.includes(PRODUCTION_SUPABASE_REF)) {
  console.error(
    `Refusing to run: DATABASE_URL points at the production project (${PRODUCTION_SUPABASE_REF}).\n` +
      'This script recreates the schema from scratch. It is for an empty project.'
  );
  process.exit(1);
}

let pg;
try {
  pg = await import('pg');
} catch {
  console.error('This runner needs the `pg` package:\n\n  npm install --save-dev pg\n');
  process.exit(2);
}

const client = new pg.default.Client({ connectionString });
try {
  await client.connect();
} catch (error) {
  /*
   * The failure that produced no diagnosis. A direct Supabase connection host
   * has an AAAA record and no A record, so on a network without IPv6 this
   * throws ENETUNREACH before a single migration is attempted - and the
   * database is left empty, which looks exactly like "the script did nothing".
   * The session pooler is dual-stack and is the answer.
   */
  console.error(`Could not connect to ${hostOf(connectionString)}.\n`);
  console.error(`  ${error.code ? `${error.code}: ` : ''}${error.message}\n`);
  if (['ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'ETIMEDOUT'].includes(error.code)) {
    console.error(
      'That is the shape of the IPv6 problem: Supabase\'s DIRECT connection host is\n' +
        'IPv6-only. Use the SESSION POOLER URI from the same dashboard page instead.\n' +
        'It is dual-stack, and it is the one run-sql-test.mjs asks for.'
    );
  }
  process.exit(1);
}

try {
  const { rows } = await client.query(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`
  );
  if (rows[0].n > 0) {
    console.error(
      `Refusing to run: this database already has ${rows[0].n} table(s) in public.\n` +
        'A replay is for an EMPTY project. Applying it over an existing schema would\n' +
        'attempt to recreate objects that exist and would re-run the data migrations.'
    );
    process.exit(1);
  }

  console.log(`Replaying ${files.length} migrations into ${hostOf(connectionString)}\n`);

  for (const name of files) {
    const sql = readFileSync(join(dir, name), 'utf8');
    process.stdout.write(`  ${name} ... `);
    try {
      /*
       * Each file in its own transaction. Postgres makes DDL transactional, so
       * a file that fails halfway leaves nothing behind and the replay stops
       * at a known point - which is what makes "start again from empty" a
       * usable recovery rather than a guess about how far it got.
       */
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
      console.log('ok');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      console.log('FAILED');
      console.error(`\n${name} failed and nothing from it was applied.\n`);
      console.error(`  ${error.message}`);
      if (error.hint) console.error(`  hint: ${error.hint}`);
      if (error.position) console.error(`  at character ${error.position}`);
      console.error(
        '\nEverything before this file IS applied. Fix the migration, drop the schema,\n' +
          'and replay from empty rather than patching around it - a database built by\n' +
          'a partially applied set is not one these files describe.'
      );
      process.exit(1);
    }
  }

  console.log('\nAll migrations applied. The files can rebuild the database from nothing.');
} finally {
  await client.end();
}

/** Just the host, so a log line never carries the password. */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'the target database';
  }
}

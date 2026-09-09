import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { stripSqlComments } from './helpers/source.js';

/**
 * ── CAN THESE FILES REBUILD THE DATABASE? ───────────────────────────────────
 *
 * ADR-18 says the migration directory is the statement of what the schema
 * should be, and that the live database is diffed against a database built by
 * replaying the files. That only means anything if the files CAN be replayed,
 * and one of them could not.
 *
 * 0057 created `trial_status()` returning three columns. 0061 replaced it with
 * five. PostgreSQL refuses: CREATE OR REPLACE FUNCTION "will not let you
 * change the return type of an existing function... To do that, you must drop
 * and recreate the function", and adding an output column is a change of
 * return type because it changes the composite type the result describes.
 *
 * Production had the five-column function anyway, applied by hand with the
 * drop included and never written back into the file. So the database was
 * right, the repository was wrong, every test passed, and the only way to find
 * it was to try to replay the files - which is the whole argument of ADR-18,
 * arriving a second time.
 *
 * This file is the cheap half of that replay: the failures that can be found
 * by reading, without a database to run them into.
 */
const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();

const sqlOf = (name) => stripSqlComments(readFileSync(join(dir, name), 'utf8'));

/**
 * The same type under two names is the same type, and a guard that reports it
 * as a change is a guard somebody turns off. `int` and `integer` are one type;
 * so are `timestamptz` and `timestamp with time zone`. Normalizing is what
 * separates the one real finding from the noise around it - without this,
 * `consume_rate_limit` reads as a defect because 0022 spelled it `int` and
 * 0056 spelled it `integer`.
 */
function normalizeType(text) {
  return text
    .toLowerCase()
    .replace(/\btimestamptz\b/g, 'timestamp with time zone')
    .replace(/\btimestamp without time zone\b/g, 'timestamp')
    .replace(/\bint4\b|\bint\b/g, 'integer')
    .replace(/\bint8\b/g, 'bigint')
    .replace(/\bbool\b/g, 'boolean')
    .replace(/\bfloat8\b/g, 'double precision')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    // Whitespace around the parens too: 0022 wrote `returns table (allowed`
    // and 0056 wrote `returns table(allowed`, which is the same signature and
    // was the guard's first false positive.
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .trim();
}

/** Every `create or replace function`, with the signature it declares. */
function functionDefinitions() {
  const found = [];
  for (const name of files) {
    const sql = sqlOf(name);
    const pattern = /create\s+or\s+replace\s+function\s+([\w.]+)\s*\(([^)]*)\)\s*(returns[\s\S]{0,400}?)\s+language\b/gi;
    for (const match of sql.matchAll(pattern)) {
      found.push({
        file: name,
        fn: match[1].toLowerCase(),
        args: normalizeType(match[2]),
        returns: normalizeType(match[3]),
        // A drop anywhere earlier in the same file makes the replacement legal.
        dropsFirst: new RegExp(`drop\\s+function[^;]*${match[1].replace('.', '\\.')}`, 'i')
          .test(sql.slice(0, match.index)),
      });
    }
  }
  return found;
}

describe('the migration directory can be replayed into an empty database', () => {
  test('there are migrations to check, and this test is reading them', () => {
    // A regex that silently matches nothing is a green test that checks
    // nothing, which is the failure this whole suite exists to avoid.
    assert.ok(files.length > 60, `only ${files.length} migrations found`);
    assert.ok(functionDefinitions().length > 20, 'no function definitions were parsed');
  });

  test('no function is replaced with a different return type', () => {
    /*
     * PostgreSQL: CREATE OR REPLACE FUNCTION "will not let you change the
     * return type of an existing function." A file that tries is a file that
     * cannot run against a database where the earlier one already has, which
     * includes every replay and every new environment.
     */
    const byName = new Map();
    for (const definition of functionDefinitions()) {
      const key = `${definition.fn}(${definition.args})`;
      const previous = byName.get(key);
      if (previous && previous.returns !== definition.returns && !definition.dropsFirst) {
        assert.fail(
          `${definition.file} replaces ${key} with a different return type and does not drop it first.\n` +
          `  ${previous.file}: ${previous.returns}\n` +
          `  ${definition.file}: ${definition.returns}\n` +
          '  Add `drop function if exists` above it, in that file - a later migration would ' +
          'leave this one still unable to replay.'
        );
      }
      byName.set(key, definition);
    }
  });

  test('and the one that did is fixed rather than only documented', () => {
    // The specific case. Named, so that "fixing" it by deleting the drop
    // fails here as well as in the general check above.
    const sql = sqlOf(files.find((name) => name.startsWith('0061_')));
    assert.match(sql, /drop function if exists public\.trial_status\(\);/);
    assert.ok(
      sql.indexOf('drop function if exists public.trial_status()') <
        sql.indexOf('create or replace function public.trial_status()'),
      'the drop comes after the create'
    );
  });
});

describe('migrations are ordered and named so that lexical order is the order', () => {
  test('every file carries a four-digit prefix, and none is duplicated', () => {
    /*
     * replay-migrations.mjs sorts lexically and calls that the order, "by
     * construction". This is the construction.
     */
    const seen = new Map();
    for (const name of files) {
      const prefix = name.match(/^(\d{4})_/);
      assert.ok(prefix, `${name} has no four-digit prefix, so its position in a replay is undefined`);
      const existing = seen.get(prefix[1]);
      assert.equal(existing, undefined, `${name} and ${existing} share the prefix ${prefix[1]}`);
      seen.set(prefix[1], name);
    }
  });
});

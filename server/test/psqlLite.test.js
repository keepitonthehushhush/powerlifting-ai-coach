import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandPsql } from '../../scripts/lib/psqlLite.mjs';
import { readRaw, phrase } from './helpers/source.js';

const suite = readFileSync(
  new URL('../../supabase/tests/rls_isolation_test.sql', import.meta.url),
  'utf8'
);
const lib = readRaw(new URL('../../scripts/lib/psqlLite.mjs', import.meta.url));

/**
 * This translator is the only new logic between the RLS suite and the
 * database, so a bug in it does not fail the suite - it silently weakens it.
 * That is the worst failure mode available here, which is why a 90-line helper
 * gets its own test file.
 */
describe('expandPsql', () => {
  test('psql triple quoting produces a quoted SQL literal', () => {
    const { sql } = expandPsql("\\set A '''abc'''\nselect :A;");
    assert.match(sql, /select 'abc';/);
  });

  test('longer variable names are substituted first', () => {
    // :AB must not be clobbered into ('a')B by an earlier pass over :A.
    const { sql } = expandPsql("\\set A '1'\n\\set AB '2'\nselect :AB, :A;");
    assert.match(sql, /select 2, 1;/);
  });

  test('echo is collected rather than executed', () => {
    const { sql, echoes } = expandPsql("\\echo 'PASS - all good'\nselect 1;");
    assert.deepEqual(echoes, ['PASS - all good']);
    assert.doesNotMatch(sql, /PASS/);
  });

  test('line numbers survive, so an error still points at the right line', () => {
    const { sql } = expandPsql("\\set A '1'\n\\echo 'x'\nselect :A;");
    assert.equal(sql.split('\n').length, 3);
  });

  test('AN UNKNOWN META-COMMAND IS AN ERROR, NOT A SKIP', () => {
    // The one that matters. Silently ignoring a meta-command in a security
    // suite could ignore a `set local role`, and a suite that runs as the
    // migration role passes every assertion while testing nothing.
    assert.throws(() => expandPsql('\\connect other_db\nselect 1;'), /does not implement/);
    assert.match(lib, phrase('passes everything while asserting nothing'));
  });

  test('an unexpanded variable is an error too', () => {
    assert.throws(() => expandPsql('select :NEVER_SET;'), /unexpanded psql variables/);
  });

  test('type casts are not mistaken for variables', () => {
    // `now()::text` and `::uuid` are everywhere in this schema.
    assert.doesNotThrow(() => expandPsql("select now()::text, '1'::uuid;"));
  });

  test('A COLON INSIDE A STRING LITERAL IS NOT A VARIABLE', () => {
    // Found by running this against the real suite, which contains the fixture
    // '{"forged":true}' and was duly reported as using an unexpanded variable
    // called `true`. psql does not expand inside quotes either, so masking is
    // both the fix and the faithful behavior.
    assert.doesNotThrow(() => expandPsql(`select '{"forged":true}'::jsonb;`));
    const { sql } = expandPsql("\\set A '1'\nselect '{\"k\":A}', :A;");
    assert.match(sql, /\{"k":A\}/, 'the literal was rewritten');
    assert.match(sql, /, 1;/, 'the real reference was not');
  });

  test('and neither is one inside a comment or a dollar-quoted body', () => {
    assert.doesNotThrow(() => expandPsql('-- see :NOTES for why\nselect 1;'));
    assert.doesNotThrow(() => expandPsql('do $$ begin raise notice \'a:b\'; end $$;'));
  });
});

describe('it handles the suite it was written for', () => {
  test('the real RLS file expands to plain SQL with nothing left over', () => {
    const { sql, echoes } = expandPsql(suite);
    assert.doesNotMatch(sql, /^\\/m, 'a meta-command survived into the SQL');
    assert.ok(echoes.length >= 1);
    // The fixtures' UUIDs must have arrived as quoted literals.
    assert.match(sql, /'aaaaaaaa-0000-4000-8000-000000000001'/);
    assert.match(sql, /'bbbbbbbb-0000-4000-8000-000000000002'/);
  });

  test('THE ROLE SWITCHES SURVIVED, WHICH IS THE WHOLE TEST', () => {
    // If these were lost, every assertion below them would run with RLS
    // bypassed and the suite would pass while proving the opposite.
    const { sql } = expandPsql(suite);
    assert.match(sql, /set local role authenticated/);
    assert.match(sql, /set local role anon/);
    assert.match(sql, /reset role/);
  });

  test('and so did the transaction that keeps it from leaving fixtures behind', () => {
    const { sql } = expandPsql(suite);
    assert.match(sql, /^begin;/m);
    assert.match(sql, /^rollback;/m);
  });
});

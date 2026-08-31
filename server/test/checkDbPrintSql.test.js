import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readSource } from './helpers/source.js';

/**
 * `check:db --print-sql` has to emit SQL that runs, without credentials.
 *
 * ── WHY THE FLAG EXISTS ───────────────────────────────────────────────────
 *
 * The invariant script needs an `exec_sql` RPC that this project deliberately
 * does not create. On a machine without it - which is the normal case, and was
 * the owner's case - all thirty-five checks report SKIP and the run ends with
 * "Nothing could be checked". That is honest and fails closed, and it leaves
 * the operator holding nothing.
 *
 * The old advice was to run the assertions by hand in the SQL editor. Nobody
 * was going to do that thirty-five times. The flag assembles them from the
 * same source into one query, so the advice becomes a command.
 */

const script = new URL('../../scripts/check-db-invariants.mjs', import.meta.url).pathname;

function printSql(env = {}) {
  return execFileSync('node', [script, '--print-sql'], {
    encoding: 'utf8',
    // Deliberately stripped: printing SQL contacts nothing, so it must not
    // require the credentials the rest of the script does. The first version
    // of this flag sat below the env guard and exited before ever running.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
}

describe('the printable invariant bundle', () => {
  test('it runs with no database credentials at all', () => {
    const out = printSql();
    assert.match(out, /Coach Diaz database invariants/);
    assert.doesNotMatch(out, /needs SUPABASE_URL/);
  });

  test('it emits every check the script would have run', () => {
    const out = printSql();
    const source = readSource(new URL(script, import.meta.url));
    const declared = [...source.matchAll(/^\s{4}name: '((?:[^'\\]|\\.)*)'/gm)].length;
    const emitted = [...out.matchAll(/as check_name/g)].length;

    assert.ok(declared >= 30, `only ${declared} checks found in the source - the pattern is wrong`);
    assert.ok(
      emitted >= declared,
      `${declared} checks are declared and only ${emitted} were emitted`,
    );
  });

  test('every emitted check selects a column named ok', () => {
    // The whole bundle is useless if a check comes back with a column the
    // reader has to interpret. One name, one meaning: true is good.
    const out = printSql();
    const selects = [...out.matchAll(/select (\d+) as n, '[^']*' as check_name, (\w+) from/g)];
    assert.ok(selects.length > 0, 'no check rows were emitted');
    for (const [, n, column] of selects) {
      assert.equal(column, 'ok', `check ${n} returns "${column}" rather than "ok"`);
    }
  });

  test('the row numbers are contiguous, so nothing is silently dropped', () => {
    const out = printSql();
    const numbers = [...out.matchAll(/select (\d+) as n,/g)].map(([, n]) => Number(n));
    for (let i = 0; i < numbers.length; i += 1) {
      assert.equal(numbers[i], i, `check numbering jumps at ${i}`);
    }
  });

  test('it says how many checks it contains, and names any it could not build', () => {
    // A bundle that quietly contains fewer checks than the script would run is
    // the reassuring-answer failure this whole file guards against. The header
    // states the count, and anything unbuildable is listed rather than omitted.
    const out = printSql();
    assert.match(out, /-- \d+ checks, generated \d{4}-\d{2}-\d{2}\./);
    const emitted = [...out.matchAll(/as check_name/g)].length;
    const stated = Number(out.match(/-- (\d+) checks, generated/)[1]);
    assert.equal(stated, emitted, 'the header count disagrees with what was emitted');
  });

  test('the failure message points at the flag', () => {
    // The message somebody actually reads when nothing could be checked has to
    // contain the way out, or the flag may as well not exist.
    const source = readSource(new URL(script, import.meta.url));
    assert.match(source, /npm run check:db -- --print-sql/);
    assert.match(source, /nothing here is evidence about the database/i);
  });
});

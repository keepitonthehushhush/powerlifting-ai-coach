import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recordActivityDay, _resetActivityMemo } from '../src/middleware/recordActivity.js';
import { readSource, readMigration } from './helpers/source.js';

const app = readSource(new URL('../src/app.js', import.meta.url));
const middleware = readSource(new URL('../src/middleware/recordActivity.js', import.meta.url));
const migration = readMigration(
  new URL('../../supabase/migrations/0068_the_visit_that_wrote_nothing_down.sql', import.meta.url)
);
const account = readSource(new URL('../src/routes/account.js', import.meta.url));

/**
 * THE VISIT THAT WROTE NOTHING DOWN.
 *
 * ── WHAT THIS TABLE IS FOR ────────────────────────────────────────────────
 *
 * Retention was measured from writes - a message, a logged session, a program
 * - and the most ordinary use of this product is not a write. Somebody opens
 * the app in the gym, reads the session, pockets the phone and squats. Every
 * retention number was a floor with no known ceiling, which is a bad thing to
 * decide anything on when the decision is whether the product retains people.
 *
 * The tests below are about the two ways an instrument like this goes wrong:
 * it costs somebody the page they asked for, or it quietly stops recording and
 * nobody notices until the number is already in a slide.
 */

/** A request as requireAuth leaves it, with the database stubbed. */
function makeReq(result = { error: null }) {
  const calls = [];
  return {
    calls,
    user: { id: 'user-1' },
    supabase: {
      from(table) {
        return {
          upsert(row, options) {
            calls.push({ table, row, options });
            return Promise.resolve(result);
          },
        };
      },
    },
  };
}

const run = (req) =>
  new Promise((resolve) => {
    recordActivityDay(req, {}, (err) => resolve(err));
  });

describe('recording a day never costs a request', () => {
  beforeEach(() => _resetActivityMemo());

  test('a successful write continues the request', async () => {
    const req = makeReq();
    assert.equal(await run(req), undefined);
    assert.equal(req.calls.length, 1);
  });

  test('a database error continues the request', async () => {
    /*
     * Same rule as the two funnel stamps in 0062 and 0064: a telemetry write
     * that can 500 a request is a worse bug than the blind spot it was added
     * to fix. next() takes no argument, so nothing reaches errorHandler.
     */
    const req = makeReq({ error: { code: '08006' } });
    assert.equal(await run(req), undefined);
  });

  test('a thrown client continues the request', async () => {
    const req = {
      user: { id: 'user-1' },
      supabase: {
        from() {
          throw new Error('socket hang up');
        },
      },
    };
    assert.equal(await run(req), undefined);
  });

  test('an unauthenticated request is not an error, it is nothing to record', async () => {
    const req = {};
    assert.equal(await run(req), undefined);
  });
});

describe('once a day, and only once', () => {
  beforeEach(() => _resetActivityMemo());

  test('the second request of the day does not write again', async () => {
    const req = makeReq();
    await run(req);
    await run(req);
    await run(req);
    assert.equal(req.calls.length, 1, 'every request is paying for a row that already exists');
  });

  test('a failed write is not remembered as done', async () => {
    /*
     * The memo exists to save a round trip, not to swallow a day. Marking a
     * failed write as recorded would lose that account's whole day on this
     * instance - and it would look exactly like a day they did not come.
     */
    const req = makeReq({ error: { code: '08006' } });
    await run(req);
    await run(req);
    assert.equal(req.calls.length, 2);
  });

  test('two accounts on one instance are two rows', async () => {
    const first = makeReq();
    const second = makeReq();
    second.user = { id: 'user-2' };
    await run(first);
    await run(second);
    assert.equal(first.calls.length, 1);
    assert.equal(second.calls.length, 1);
  });

  test('the row carries a UTC date and no time of day', async () => {
    const req = makeReq();
    await run(req);
    const { row } = req.calls[0];
    assert.deepEqual(Object.keys(row).sort(), ['day', 'user_id']);
    assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/, 'a timestamp is not a day');
  });

  test('a race between two tabs is the expected outcome, not an error', async () => {
    // ignoreDuplicates. Without it the loser of the race gets a 23505 that
    // reads like a failure and is in fact the correct result.
    const req = makeReq();
    await run(req);
    assert.equal(req.calls[0].options.ignoreDuplicates, true);
    assert.equal(req.calls[0].options.onConflict, 'user_id,day');
  });
});

describe('when the table is not there yet', () => {
  beforeEach(() => _resetActivityMemo());

  for (const code of ['PGRST205', '42P01']) {
    test(`${code} stops the instance retrying`, async () => {
      /*
       * The hazard is a deploy landing before its migration - the ordering
       * trap app.js already documents for the monthly rate-limit bucket.
       * Without this, every request in that window pays a failing round trip
       * and writes a log line, and a missing migration becomes a latency
       * incident with a wall of noise instead of one line saying what is wrong.
       */
      const req = makeReq({ error: { code } });
      await run(req);
      await run(req);
      await run(req);
      assert.equal(req.calls.length, 1);
    });
  }

  test('an ordinary error does not stop the instance retrying', async () => {
    const req = makeReq({ error: { code: '57014' } });
    await run(req);
    await run(req);
    assert.equal(req.calls.length, 2, 'a timeout has been mistaken for a missing table');
  });
});

describe('what it writes through, and what it never writes down', () => {
  test('the caller\'s own RLS-scoped client, never the admin one', () => {
    // The policy in 0068 is what enforces ownership; using the service-role
    // client here would route around it entirely and nothing else in the
    // request would notice.
    assert.match(middleware, /req\.supabase\s*\n?\s*\.from\('activity_days'\)/);
    assert.doesNotMatch(middleware, /supabaseAdmin|SERVICE_ROLE|createAdminClient/);
  });

  test('no account id reaches a log line', () => {
    /*
     * Which account was here is the entire content of this table. A log line
     * is a second copy of it in a place with different retention, different
     * access and a habit of being forwarded.
     */
    for (const line of middleware.match(/logger\.[a-z]+\([\s\S]*?\);/g) ?? []) {
      assert.doesNotMatch(line, /userId|user\.id|user_id/, `a log line carries the account: ${line}`);
    }
  });

  test('it records a date and nothing else', () => {
    // The pressure will always be the other way: a route, a count, a user
    // agent, each one line. The table's shape is the privacy property.
    assert.doesNotMatch(middleware, /req\.(path|url|originalUrl|ip|headers\[)/);
  });
});

describe('where it is mounted', () => {
  test('after requireAuth, so there is an account to attribute it to', () => {
    const auth = app.indexOf("app.use('/api', requireAuth)");
    const record = app.indexOf("app.use('/api', recordActivityDay)");
    assert.ok(auth > 0, 'requireAuth is no longer mounted the way this test reads it');
    assert.ok(record > 0, 'the activity middleware is not mounted');
    assert.ok(auth < record, 'activity is recorded before anybody is authenticated');
  });

  test('before the rate limiters, because a throttled visit is still a visit', () => {
    const record = app.indexOf("app.use('/api', recordActivityDay)");
    const firstLimiter = app.indexOf("rateLimit('chat')");
    assert.ok(firstLimiter > 0);
    assert.ok(record < firstLimiter, 'a 429 now erases the fact that somebody came back');
  });
});

describe('the table keeps the promises this codebase makes about tables', () => {
  test('row level security is on and the policies are scoped to the owner', () => {
    assert.match(migration, /alter table public\.activity_days\s+enable row level security/);
    const policies = migration.match(/create policy[\s\S]*?;/g) ?? [];
    assert.ok(policies.length >= 3, 'select, insert and delete policies are not all there');
    for (const policy of policies) {
      assert.match(policy, /\(select auth\.uid\(\)\) = user_id/, `a policy is not owner-scoped: ${policy}`);
    }
  });

  test('a policy without a grant is a policy that never runs', () => {
    // Migration 0021's lesson, and 0009's deny-by-default posture.
    assert.match(migration, /grant select, insert, delete on public\.activity_days to authenticated/);
  });

  test('no UPDATE, and the grant agrees with the policies', () => {
    assert.doesNotMatch(migration, /create policy[^;]*for update[^;]*activity_days/i);
    const grant = migration.match(/grant [^;]*on public\.activity_days to authenticated/)[0];
    assert.doesNotMatch(grant, /update/);
  });

  test('it is erased with the account', () => {
    assert.match(migration, /references auth\.users \(id\) on delete cascade/);
  });

  test('it is in the data export', () => {
    // policyDisclosure.test.js enforces this generally. Named here too,
    // because the general check is the one that was added AFTER two tables
    // had already shipped missing from the export.
    assert.match(account, /from\('activity_days'\)/);
    assert.match(account, /activity_days: activityDays\.data \?\? \[\]/);
  });

  test('the retention promise and the sweep that keeps it ship together', () => {
    /*
     * A published retention promise that nothing enforces is the same shape as
     * the RLS policy with no GRANT in 0021 - correct on paper, inert in fact.
     * check-db-invariants.mjs asserts this against the live database; this
     * asserts it against the file, so it fails before it reaches one.
     */
    assert.match(migration, /insert into public\.retention_periods[\s\S]*'activity_days', 24/);
    const body = migration.slice(migration.indexOf('create or replace function private.apply_retention'));
    assert.match(body, /delete from public\.activity_days/);
    assert.match(body, /category := 'activity_days'/);
  });

  test('the sweep compares dates to dates', () => {
    // current_date minus an interval is a TIMESTAMP. Comparing a date column
    // against one widens every row to midnight instead of comparing days -
    // right by luck today, wrong the moment the interval grows an hours part.
    const body = migration.slice(migration.indexOf('delete from public.activity_days'));
    assert.match(body.slice(0, 200), /make_interval\(months => m_days\)\)::date/);
  });

  test('the replacement does not change the sweep\'s return type', () => {
    /*
     * CREATE OR REPLACE FUNCTION cannot change a return type - Postgres raises
     * 42P13 - and 0061 had to be amended with a DROP after it was proven
     * unreplayable. Adding a category adds a ROW, not a column, so this stays
     * replaceable; the assertion is here so that a future category that DOES
     * widen the table fails at the file rather than at the SQL editor.
     */
    assert.match(migration, /returns table\(category text, affected bigint\)/);
    assert.doesNotMatch(migration, /drop function if exists private\.apply_retention/);
  });
});

describe('the retention report knows this table exists', () => {
  const script = readFileSync(new URL('../../scripts/retention.mjs', import.meta.url), 'utf8');

  test('it reads activity_days when there is anything to read', () => {
    assert.match(script, /rest\('activity_days\?select=user_id,day'\)/);
  });

  test('a database without the table is a fact, not a crash', () => {
    // The oldest cohorts predate this table by two weeks and more. A 404 has
    // to read as "not collecting yet", or the report cannot be run at all
    // against the database it most needs to describe.
    assert.match(script, /if \(response\.status === 404\) return null;/);
    assert.match(script, /activityDays == null/);
  });

  test('a day is widened to noon, not to midnight', () => {
    /*
     * A date has to become an instant to sit beside the message timestamps.
     * Midnight UTC is the worst available choice: it is the edge of the day it
     * represents, so in half the world's timezones it falls on the far side of
     * a window boundary from the day it stands for. Noon cannot.
     */
    assert.match(script, /T12:00:00Z/);
  });
});

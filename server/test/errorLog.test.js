import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSource, readRaw, phrase } from './helpers/source.js';
import {
  RECORDABLE_DETAIL_KEYS,
  normaliseRoute,
  recordableDetail,
  recordErrorEvent,
} from '../src/lib/errorRecord.js';

/**
 * ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────────
 *
 * "Can we... develop potentially a ticketing system or a database to note
 * common errors to review or note back on when things break?"
 *
 * The empty-response bug was investigable only because somebody happened to
 * open Vercel's runtime logs within a few hours. Those expire in days, cannot
 * be grouped, and answer "what happened just now" rather than "what keeps
 * happening" - and the failure everybody hits and nobody reports is precisely
 * the one a log stream loses.
 *
 * The shape of the thing is copied deliberately from audit_events (0030),
 * because that table already settled the two questions this one asks: what may
 * be written into a record about a person, and what happens to it when they
 * leave.
 */

const migration = readRaw(new URL('../../supabase/migrations/0034_error_events.sql', import.meta.url));

/**
 * The CHECK as the LATEST file states it, not as 0034 first wrote it.
 *
 * ── WHY THIS IS LOOKED UP RATHER THAN NAMED ───────────────────────────────
 *
 * The detail whitelist has been restated three times now - 0048 added the
 * crash-report keys, 0060 added the platform ones, 0069 added the upstream
 * reason - and each restatement is the whole list again, because that is what
 * `drop constraint` / `add constraint` means. A test that reads 0034 is
 * reading the first version of a list that has moved on twice, which is the
 * same defect shape as reading the first migration that mentions a function
 * and assuming it still describes it.
 *
 * The owner is read from function-owners.json, which migrationOrdering.test.js
 * already holds to the files themselves - so the two tests cannot disagree
 * about which file is current.
 */
const detailCheckOwner = (() => {
  const ledger = JSON.parse(
    readRaw(new URL('../../supabase/migrations/function-owners.json', import.meta.url))
  );
  const entry = ledger['constraint error_events_detail_check'];
  assert.ok(entry?.owner, 'the ledger no longer records who owns the detail whitelist');
  return readRaw(new URL(`../../supabase/migrations/${entry.owner}`, import.meta.url));
})();
const account = readSource(new URL('../src/routes/account.js', import.meta.url));
const handler = readSource(new URL('../src/middleware/errorHandler.js', import.meta.url));
const recorder = readRaw(new URL('../src/lib/errorRecord.js', import.meta.url));

describe('the table', () => {
  test('the migration is real, and the scan below has something to read', () => {
    assert.ok(migration.length > 2000, `the migration is ${migration.length} characters`);
    assert.match(migration, /create table if not exists public\.error_events/);
  });

  test('IT IS READ-ONLY TO USERS', () => {
    // A failure log a user can write is one an attacker can flood, and one
    // they can edit is not evidence. The privilege is the control - RLS
    // narrows a granted privilege and does not create one (0021).
    assert.match(migration, /grant select on public\.error_events to authenticated;/);
    assert.match(migration, /revoke insert, update, delete on public\.error_events from authenticated;/);
    assert.match(migration, /revoke all on public\.error_events from anon;/);
  });

  test('AND THE FAILURE HISTORY SURVIVES AN ACCOUNT DELETION', () => {
    assert.match(migration, /user_id\s+uuid references auth\.users \(id\) on delete set null/);
    assert.ok(
      !/error_events[\s\S]{0,600}on delete cascade/.test(migration),
      'cascade would erase every failure somebody hit on their way to deciding to leave'
    );
  });

  test('the writer stamps the user rather than accepting one', () => {
    // Otherwise a browser could attribute a failure to somebody else, and the
    // counts this table exists for would be forgeable.
    assert.match(migration, /uid uuid := auth\.uid\(\)/);
    assert.match(migration, /raise exception 'record_error_event\(\) requires an authenticated caller'/);
    assert.match(migration, /security definer/);
    assert.match(migration, /set search_path = public, pg_temp/);
  });

  test('and the aggregate view is not something a user can run', () => {
    // error_summary crosses everybody's rows by design.
    assert.match(migration, /revoke all on function private\.error_summary\(integer\) from public, anon, authenticated;/);
  });
});

describe('what may be written about a person', () => {
  /** The whitelist as the CHECK constraint states it. */
  const inMigration = (() => {
    const at = detailCheckOwner.indexOf('check (detail - array[');
    assert.notEqual(at, -1, 'the detail whitelist is not where this test looks for it');
    const block = detailCheckOwner.slice(at, detailCheckOwner.indexOf(']', at));
    return [...block.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  })();

  /** The keys the browser's report may carry, as clientErrors.js validates them. */
  const inClientSchema = (() => {
    const route = readSource(new URL('../src/routes/clientErrors.js', import.meta.url));
    const at = route.indexOf('const detailSchema = z');
    assert.notEqual(at, -1, 'the client detail schema is not where this test looks for it');
    const block = route.slice(at, route.indexOf('.strict()', at));
    return [...block.matchAll(/^\s{4}([A-Za-z]+):/gm)].map((m) => m[1]);
  })();

  test('EVERY KEY THE DATABASE ACCEPTS IS ONE SOME WRITER ACTUALLY SENDS', () => {
    /*
     * ── WHY THIS IS A UNION AND NOT AN EQUALITY ───────────────────────────
     *
     * It used to assert that the CHECK and RECORDABLE_DETAIL_KEYS were the
     * same list. That was true when the server was the only writer. It stopped
     * being true at 0048, when the browser became the second one - and the
     * test kept passing for a year because it was reading migration 0034, the
     * FIRST file to state the whitelist, which 0048, 0060 and 0069 have each
     * since restated in full.
     *
     * A stale copy that agrees with an old list is worse than no test: it
     * reports agreement between two things it is not comparing.
     *
     * What has to hold with two writers is a union. Every key either writer
     * can send must be accepted by the database, or the row is lost on write;
     * and every key the database accepts must be sent by somebody, or it is
     * surface nobody fills and nobody will notice going wrong.
     *
     * That second half is the one that mattered. `platform` and `standalone`
     * were accepted by the database and sent by the browser and REJECTED by
     * the server schema in between, so client crash reporting was answered 400
     * and written nowhere from 2026-09-07 until this was found.
     */
    assert.ok(inMigration.length >= 10, `parsed ${inMigration.length} keys from the CHECK`);
    const writable = new Set([...RECORDABLE_DETAIL_KEYS, ...inClientSchema]);

    const rejectedOnWrite = [...writable].filter((key) => !inMigration.includes(key)).sort();
    assert.deepEqual(rejectedOnWrite, [], 'a writer can send keys the database CHECK would reject');

    const nobodySends = inMigration.filter((key) => !writable.has(key)).sort();
    assert.deepEqual(nobodySends, [], 'the database accepts keys no writer sends');
  });

  test('and the browser, the server and the database name the same nine platforms', () => {
    // Three copies of one list, in three languages, none of which can import
    // the others. The agreement is the only thing holding them together.
    const route = readSource(new URL('../src/routes/clientErrors.js', import.meta.url));
    const browser = readSource(new URL('../../web/src/lib/crashReport.js', import.meta.url));
    const named = (source, marker) => {
      const at = source.indexOf(marker);
      assert.notEqual(at, -1, `${marker} is no longer where this test looks`);
      return [...source.slice(at, source.indexOf(']', at)).matchAll(/'([a-z-]+)'/g)]
        .map((m) => m[1])
        .sort();
    };
    /*
     * The platform VALUE check lives in whichever migration last restated it,
     * which is not the one that last restated the KEY list - 0069 widened the
     * keys and left the value constraints alone. Found by scanning rather than
     * named, for the reason this whole file just learned: a hardcoded filename
     * is a snapshot of who owned something on the day it was written.
     */
    const inCheck = (() => {
      const dir = new URL('../../supabase/migrations/', import.meta.url);
      const owner = readdirSync(fileURLToPath(dir))
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .reverse()
        .map((f) => readRaw(new URL(f, dir)))
        .find((text) => text.includes('error_events_platform_shape'));
      assert.ok(owner, 'no migration defines the platform value check');
      const at = owner.indexOf("detail ->> 'platform' in (");
      return [...owner.slice(at, owner.indexOf(')', at)).matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    })();
    const fromServer = named(route, 'const PLATFORMS = [');
    const fromBrowser = named(browser, 'export const PLATFORMS = Object.freeze([');
    assert.equal(fromServer.length, 9);
    assert.deepEqual(fromServer, fromBrowser, 'the server and the browser disagree about the platforms');
    for (const platform of fromServer) {
      assert.ok(inCheck.includes(platform), `the database CHECK does not accept ${platform}`);
    }
  });

  test('AND NOTHING IN IT CAN HOLD A SENTENCE SOMEBODY TYPED', () => {
    // The failure mode this guards: a diagnostic key that quietly becomes a
    // place health data is copied to and then kept.
    // `hadText` is the one name that trips the pattern and is not free text:
    // it is a boolean saying whether the model produced any, which is the
    // fact that separates "the coach said nothing" from "the coach said
    // something we could not use". Named here rather than excluded by
    // loosening the pattern, so the exception has to be re-justified if
    // somebody adds `hadTextBody` next year.
    const BOOLEAN_NOT_TEXT = ['hadText'];
    const freeText = RECORDABLE_DETAIL_KEYS.filter(
      (key) =>
        !BOOLEAN_NOT_TEXT.includes(key) &&
        /message|text|body|content|note|restriction|injury|reply|prompt/i.test(key)
    );
    assert.deepEqual(freeText, []);
  });

  test('unknown keys are dropped rather than rejected', () => {
    const detail = recordableDetail({
      stopReason: 'refusal',
      message: 'my shoulder has been hurting',
      health_restrictions: 'left rotator cuff',
      cause: '42501',
      upstreamStatus: null,
    });
    assert.deepEqual(detail, { stopReason: 'refusal', cause: '42501' });
    assert.doesNotMatch(JSON.stringify(detail), /shoulder|rotator/);
  });

  test('AND THE PATH IS NORMALISED, SO IDS DO NOT ACCUMULATE', () => {
    assert.equal(normaliseRoute('/api/chat'), '/api/chat');
    assert.equal(
      normaliseRoute('/api/conversations/8f3c1e2a-4b5d-4e6f-9a8b-7c6d5e4f3a2b/messages'),
      '/api/conversations/_id/messages'
    );
    assert.equal(normaliseRoute('/api/sessions/12345'), '/api/sessions/_id');
    assert.equal(normaliseRoute('/api/chat?token=secret'), '/api/chat', 'a query string can carry anything');
  });

  test('and a path the column would refuse loses the path, not the row', () => {
    // Losing "which route" is a much smaller loss than losing the record that
    // anything failed at all.
    assert.equal(normaliseRoute('/api/search/hello world'), '/unknown');
    assert.equal(normaliseRoute(undefined), '/unknown');
  });
});

describe('recording never becomes the reason a request fails', () => {
  const call = (rpc) => ({
    method: 'POST',
    originalUrl: '/api/chat',
    supabase: { rpc: async (...args) => rpc(...args) },
  });

  test('an unauthenticated request is skipped rather than attempted', async () => {
    // record_error_event refuses a caller with no JWT on purpose: a function
    // anon can call is an unauthenticated insert endpoint.
    const recorded = await recordErrorEvent({ method: 'POST', originalUrl: '/api/chat' }, { status: 401, details: { code: 'auth_required' } });
    assert.equal(recorded, false);
  });

  test('an error with no code is skipped', async () => {
    let called = false;
    const req = call(() => { called = true; return { error: null }; });
    assert.equal(await recordErrorEvent(req, { status: 500, details: undefined }), false);
    assert.equal(called, false, 'an unhandled throw is already in the log and in Sentry');
  });

  test('a normal failure is recorded, with only the permitted keys', async () => {
    let args;
    const req = call((name, params) => { args = { name, params }; return { error: null }; });
    const recorded = await recordErrorEvent(req, {
      status: 502,
      details: { code: 'coach_refused', errorCode: 'CD-002', stopReason: 'refusal', retryable: false },
    });

    assert.equal(recorded, true);
    assert.equal(args.name, 'record_error_event');
    assert.equal(args.params.p_code, 'coach_refused');
    assert.equal(args.params.p_http_status, 502);
    assert.equal(args.params.p_route, '/api/chat');
    assert.deepEqual(args.params.p_detail, { stopReason: 'refusal', retryable: false });
    assert.equal(args.params.p_detail.errorCode, undefined, 'the display form is derivable from the code');
  });

  test('A DATABASE FAILURE IS SWALLOWED', async () => {
    // An error recorder that can itself error turns one bad request into two,
    // and the second is invisible because the thing that reports errors is the
    // thing that broke.
    const returnsError = call(() => ({ error: { code: '42501' } }));
    assert.equal(await recordErrorEvent(returnsError, { status: 502, details: { code: 'coach_empty' } }), false);

    const throws = call(() => { throw new Error('connection reset'); });
    assert.equal(await recordErrorEvent(throws, { status: 502, details: { code: 'coach_empty' } }), false);
  });
});

describe('when it is written', () => {
  test('BEFORE THE RESPONSE, NOT AFTER', () => {
    /*
     * A serverless function is frozen the moment it responds, so a write
     * started afterwards dies mid-socket - this project has lost telemetry
     * that way once already, and the symptom was `TypeError: fetch failed`
     * rather than anything resembling a database error.
     */
    const record = handler.indexOf('recordErrorEvent');
    const respond = handler.indexOf('res.status(status).json(');
    assert.ok(record > 0 && respond > record, 'the record is written after the response is sent');
  });

  test('and it is bounded, so a slow database cannot hang an error response', () => {
    assert.match(handler, /Promise\.race/);
    assert.match(handler, /RECORD_TIMEOUT_MS/);
  });

  test('the reasoning survives', () => {
    assert.match(readRaw(new URL('../src/middleware/errorHandler.js', import.meta.url)),
      phrase('A serverless function is frozen the moment it responds'));
    assert.match(recorder, phrase('An error recorder that can itself error would turn one bad request into two'));
  });
});

describe('it is disclosed like every other table', () => {
  test('it goes in the data export', () => {
    // A new user-scoped table is not finished until it appears here.
    assert.match(account, /from\('error_events'\)/);
    assert.match(account, /error_events: errors\.data \?\? \[\]/);
  });

  test('AND IT HAS A RETENTION PERIOD THAT IS ACTUALLY SWEPT', () => {
    // Adding a row to retention_periods prunes nothing on its own: the DELETE
    // for each category is written out by hand in apply_retention(). A
    // published promise nothing keeps is the RLS-policy-with-no-GRANT bug in
    // a different costume.
    assert.match(migration, /\('error_events', 6,/);
    assert.match(migration, /delete from public\.error_events ee where ee\.created_at < now\(\)/);
  });

  test('and replacing the sweep restates definer and search_path', () => {
    // `create or replace function` silently drops both, which is how
    // consume_rate_limit spent a day raising 42501 while its migration file
    // said otherwise.
    const at = migration.indexOf('create or replace function private.apply_retention()');
    assert.notEqual(at, -1);
    const head = migration.slice(at, at + 260);
    assert.match(head, /security definer/);
    assert.match(head, /set search_path = public, pg_temp/);
  });
});

describe('an upstream 400 says which 400 it was', () => {
  const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
  const failure = chat.slice(chat.indexOf("logger.error('coach.call_failed'"), chat.indexOf("throw coachApiError(err)"));

  test('the vendor error type and a bounded message are recorded', () => {
    /*
     * Two of these landed in production on 2026-09-10 carrying only
     * `upstreamStatus: 400`. A 400 from the Messages API is always OUR request
     * being wrong - too many input tokens, a max_tokens past the model's
     * ceiling, a malformed message sequence - and each has a different fix.
     * With the status alone there is nothing to act on, so the same failure
     * can recur forever and every investigation starts from zero.
     */
    assert.match(failure, /upstreamType:/);
    assert.match(failure, /upstreamMessage:/);
  });

  test('and the message cannot become a place athlete text accumulates', () => {
    /*
     * The type is a fixed vendor vocabulary and carries nothing of ours. The
     * message is vendor prose, and this product's messages are health
     * information - so a vendor that ever quoted the offending content back
     * would put it somewhere the README promises it will not be. Bounded hard,
     * and it is a lead rather than a transcript.
     */
    assert.match(failure, /\.slice\(0, 200\)/);
    assert.match(failure, /String\(/, 'an object logged unbounded is not bounded by slice');
  });

  test('the reply itself is still never logged', () => {
    // The standing rule, restated where it can fail: whatever is added to this
    // call, the coach's text and the athlete's text are not in it.
    assert.doesNotMatch(failure, /\breply\b|\bmessages\b|\bcontent\b|req\.body/);
  });
});

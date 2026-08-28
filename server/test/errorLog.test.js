import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
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
    const at = migration.indexOf("check (detail - array[");
    assert.notEqual(at, -1, 'the detail whitelist is not where this test looks for it');
    const block = migration.slice(at, migration.indexOf(']', at));
    return [...block.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  })();

  test('THE TWO COPIES OF THE WHITELIST AGREE, IN BOTH DIRECTIONS', () => {
    // One list in Postgres and one in JavaScript is a thing that drifts. The
    // duplication is deliberate - filtering only in the database loses the
    // whole row on a rejected write, and filtering only in JS makes the
    // constraint decorative - so the agreement is asserted instead.
    assert.ok(inMigration.length >= 10, `parsed ${inMigration.length} keys from the CHECK`);
    assert.deepEqual([...inMigration].sort(), [...RECORDABLE_DETAIL_KEYS].sort());
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

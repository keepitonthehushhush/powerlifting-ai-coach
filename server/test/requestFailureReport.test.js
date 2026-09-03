import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import {
  CLIENT_ERROR_CODES,
  MAX_PENDING_REPORTS,
  pendingReport,
  queueReport,
  requestFailureCode,
  safeRoute,
} from '../../web/src/lib/crashReport.js';

/**
 * ── THE FAILURE THE REPORTER COULD NOT SEE ────────────────────────────────
 *
 * A review of error_events found two rows, both with origin 'server', and not
 * one from a browser. The pipeline was working - the deployed bundle carries
 * the real build id, record_client_error_event is SECURITY DEFINER with a
 * pinned search_path and EXECUTE granted to authenticated - so the emptiness
 * was honest as far as it went.
 *
 * What it did not cover is the failure athletes have actually reported: "could
 * not reach the server. Check your connection and try again." api.js catches
 * that, shows it, and recorded it nowhere - because a rejected fetch inside a
 * try/catch is not an unhandled rejection and no listener fires. The most
 * common user-visible failure in this product was the one the observability
 * could not see. Handled gracefully and invisible are not the same thing.
 */

const reporter = readSource(new URL('../../web/src/lib/crashReporter.js', import.meta.url));
const api = readSource(new URL('../../web/src/lib/api.js', import.meta.url));

describe('the vocabulary grew to cover it', () => {
  test('both codes exist and are distinct', () => {
    assert.ok(CLIENT_ERROR_CODES.includes('client_request_failed'));
    assert.ok(CLIENT_ERROR_CODES.includes('client_request_timed_out'));
  });

  test('every code still satisfies the database CHECK on error_events.code', () => {
    // CHECK (code ~ '^[a-z][a-z_]{2,39}$'). It is a pattern and not an enum,
    // which is why adding a code needed no migration - but a code that fails
    // it would be refused at the database with the report already sent.
    for (const code of CLIENT_ERROR_CODES) {
      assert.match(code, /^[a-z][a-z_]{2,39}$/, code);
      // And record_client_error_event() only writes client_* codes.
      assert.match(code, /^client_/, code);
    }
  });
});

describe('which failures earn a report', () => {
  test('a rejected fetch and a timeout are different things', () => {
    // They need opposite fixes: one says something about the network, the
    // other about how long we are willing to wait - and a coaching reply
    // legitimately takes over a minute.
    assert.equal(requestFailureCode(0), 'client_request_failed');
    assert.equal(requestFailureCode(408), 'client_request_timed_out');
    assert.notEqual(requestFailureCode(0), requestFailureCode(408));
  });

  test('a real HTTP response earns nothing - the server already recorded it', () => {
    for (const status of [400, 401, 402, 404, 409, 429, 500, 502, 503]) {
      assert.equal(requestFailureCode(status), null, `${status} was queued as a client failure`);
    }
  });

  test('the route is normalized, so no id reaches the table', () => {
    const entry = pendingReport(0, '/api/sessions/9f1c2b3a-1111-4222-8333-444455556666', 'dpl_x');
    assert.equal(entry.route, '/api/sessions/_id');
    assert.equal(safeRoute('/api/sessions/9f1c2b3a-1111-4222-8333-444455556666'), '/api/sessions/_id');
  });

  test('the build is stamped and bounded', () => {
    assert.equal(pendingReport(0, '/api/chat', 'dpl_abc').build, 'dpl_abc');
    assert.equal(pendingReport(0, '/api/chat', null).build, 'unknown');
    assert.equal(pendingReport(0, '/api/chat', 'x'.repeat(200)).build.length, 40);
  });
});

describe('the queue', () => {
  const entry = (route) => pendingReport(0, route, 'dpl_x');

  test('the same failure on the same endpoint is queued once', () => {
    // Somebody on a train generates these all afternoon. The queue must not
    // become the problem it is reporting.
    let q = [];
    for (let i = 0; i < 20; i += 1) q = queueReport(q, entry('/api/chat'));
    assert.equal(q.length, 1);
  });

  test('two endpoints are two findings', () => {
    let q = queueReport([], entry('/api/chat'));
    q = queueReport(q, entry('/api/program'));
    assert.deepEqual(q.map((e) => e.route), ['/api/chat', '/api/program']);
  });

  test('and a timeout is not the same finding as a failure on one endpoint', () => {
    let q = queueReport([], pendingReport(0, '/api/chat', 'dpl_x'));
    q = queueReport(q, pendingReport(408, '/api/chat', 'dpl_x'));
    assert.equal(q.length, 2);
  });

  test('it is capped', () => {
    let q = [];
    for (const path of ['/api/a', '/api/b', '/api/c', '/api/d', '/api/e']) q = queueReport(q, entry(path));
    assert.equal(q.length, MAX_PENDING_REPORTS);
  });

  test('a queue read back from storage is untrusted, like anything else read back', () => {
    /*
     * sessionStorage is writable by anything running in the page. An entry
     * with an unknown code would be refused by the route and one with a bad
     * route by the database - but the check belongs here too, because the
     * cheapest place to refuse a bad report is before it is sent.
     */
    const junk = [
      { code: 'client_render_crash', route: 'not a route', build: 'x' },
      { code: 'made_up_code', route: '/api/chat', build: 'x' },
      { code: 'client_request_failed', route: '/api/chat' },
      null,
      'a string',
    ];
    assert.deepEqual(queueReport(junk, entry('/api/chat')), [entry('/api/chat')]);
  });

  test('a non-failure is never queued', () => {
    assert.deepEqual(queueReport([], pendingReport(500, '/api/chat', 'x')), []);
    assert.deepEqual(queueReport([], null), []);
  });
});

describe('WHERE IT IS WIRED, WHICH IS THE WHOLE DESIGN', () => {
  test('the failure is QUEUED, not sent', () => {
    /*
     * The report is a request and requests are what just failed. Sending one
     * at the moment of failure asks a broken network to describe itself -
     * the mirror image of why a crash cannot report itself, and the reason
     * both use the same deferred pattern.
     */
    const catchBlock = api.slice(api.indexOf('} catch (err) {'), api.indexOf('} finally {'));
    assert.match(catchBlock, /noteRequestFailed\(status, `\/api\$\{path\}`\)/);
    assert.doesNotMatch(catchBlock, /flushPendingReports|await send/);
  });

  test('and flushed when something works', () => {
    assert.match(api, /flushPendingReports\(\);/);
    // Before the !ok branch: a 4xx is a working connection, and it is the
    // connection this queue was waiting for.
    assert.ok(
      api.indexOf('flushPendingReports();') < api.indexOf('if (!response.ok) {'),
      'the flush is skipped for any response that is not 2xx'
    );
  });

  test('the flush is not awaited, so bookkeeping never delays a reply', () => {
    const region = api.slice(api.indexOf('flushPendingReports();') - 40, api.indexOf('flushPendingReports();') + 30);
    assert.doesNotMatch(region, /await flushPendingReports/);
  });

  test('a reload also flushes, for the tab that failed and was never retried', () => {
    const install = reporter.slice(reporter.indexOf('export function installCrashReporting'));
    assert.match(install, /flushPendingReports\(\)/);
  });

  test('the queue is per tab, like the crash marker, and for the same reason', () => {
    // A pending report left by one tab must never be sent by another as if it
    // had happened there.
    const region = reporter.slice(reporter.indexOf('function readPending'), reporter.indexOf('export function noteRequestFailed'));
    assert.match(region, /sessionStorage/);
    assert.doesNotMatch(region, /localStorage/);
  });

  test('the report carries a coordinate and never a message', () => {
    // Same rule as every other client report: an error message is whatever
    // the throwing code interpolated, and this app holds health_restrictions.
    assert.match(reporter, /void send\(entry\.code, null, entry\.route, entry\.build\)/);
  });
});

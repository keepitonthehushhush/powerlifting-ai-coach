import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import { loadWithStubbedImports } from './helpers/browserModule.js';
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

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
});

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

/**
 * ── THE PART THAT ONLY INSPECTION HAD COVERED ─────────────────────────────
 *
 * Everything above tests the decisions, which are pure, and the wiring, which
 * is source. What neither reaches is the middle: a report written to storage,
 * read back on another page view, and actually leaving as an HTTP request.
 *
 * Three separate things had to be true for that to work and each was only
 * checked by reading it - which is precisely the shape of "a check that
 * answers confidently without looking" this codebase keeps finding. So the
 * shipped file is loaded with its two imports stubbed and nothing else
 * changed (asserted, in browserModule.js) and driven end to end.
 */
describe('END TO END: queued in one page view, sent in the next', () => {
  const reporterUrl = new URL('../../web/src/lib/crashReporter.js', import.meta.url);

  /** A sessionStorage that outlives the module, the way a tab's does. */
  function tab() {
    const map = new Map();
    return {
      map,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    };
  }

  async function loadReporter({ storage, token = 'jwt-abc', sent }) {
    globalThis.window = {
      sessionStorage: storage,
      location: { pathname: '/coach' },
      addEventListener() {},
      removeEventListener() {},
    };
    globalThis.document = {
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
    };
    globalThis.fetch = async (url, init) => {
      sent.push({ url, init });
      return { ok: true };
    };
    return loadWithStubbedImports(reporterUrl, [
      [
        "import { supabase } from './supabase.js';",
        `const supabase = { auth: { getSession: async () => ({ data: ${
          token ? `{ session: { access_token: '${token}' } }` : 'null'
        } }) } };`,
      ],
      [
        "import { config } from './config.js';",
        "const config = { apiBaseUrl: 'https://coachdiaz.app' };",
      ],
      [
        "import { BUILD_ID } from './version.js';",
        "const BUILD_ID = 'dpl_test';",
      ],
    ]);
  }

  test('a failure survives storage and leaves as a real POST', async () => {
    const storage = tab();
    const sent = [];

    // Page view one: the request fails. Nothing is sent - the network is the
    // thing that just broke.
    const first = await loadReporter({ storage, sent });
    first.noteRequestFailed(0, '/api/chat');
    assert.equal(sent.length, 0, 'a report was sent over the network that just failed');
    assert.ok(storage.map.get('cd:pending-reports'), 'nothing was written down');

    // Page view two: a fresh module, the same tab. The queue is picked up.
    const second = await loadReporter({ storage, sent });
    second.flushPendingReports();
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(sent.length, 1, 'the queued report never left');
    const [{ url, init }] = sent;
    assert.equal(url, 'https://coachdiaz.app/api/client-errors');
    assert.equal(init.method, 'POST');
    assert.equal(init.keepalive, true);
    assert.equal(init.headers.authorization, 'Bearer jwt-abc');

    const body = JSON.parse(init.body);
    assert.equal(body.code, 'client_request_failed');
    assert.equal(body.route, '/api/chat');
    assert.equal(body.detail.build, 'dpl_test');
    // The report is a coordinate, never a description. No message field has
    // ever been permitted to leave, and this path is no exception.
    assert.deepEqual(Object.keys(body).sort(), ['code', 'detail', 'route']);
    assert.deepEqual(Object.keys(body.detail).sort(), ['build', 'errorName', 'frames', 'topFrame']);
    assert.equal(body.detail.topFrame, null, 'a fabricated coordinate is worse than none');

    // And the queue is empty, so the next success does not send it twice.
    assert.equal(storage.map.get('cd:pending-reports'), undefined);
  });

  test('with no session it is not sent, and not silently lost either', async () => {
    /*
     * The endpoint requires a session. A failure recorded before sign-in used
     * to have nowhere to go; it now waits in the tab, which is the whole
     * reason the queue is per tab rather than per page view.
     */
    const storage = tab();
    const sent = [];
    const anon = await loadReporter({ storage, token: null, sent });
    anon.noteRequestFailed(0, '/api/chat');
    anon.flushPendingReports();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(sent.length, 0, 'a report went out with no token');
  });

  test('a flush over a still-broken network does not loop', async () => {
    // The queue is cleared before the send is attempted. A flush that put
    // entries back would retry a report about a broken network forever.
    const storage = tab();
    const sent = [];
    const mod = await loadReporter({ storage, sent });
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    mod.noteRequestFailed(0, '/api/chat');
    mod.flushPendingReports();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(storage.map.get('cd:pending-reports'), undefined, 'the queue refilled itself');
  });
});

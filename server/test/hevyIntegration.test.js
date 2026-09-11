import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { readSource, readRaw, latestDefinition } from './helpers/source.js';
import { fakeSupabase } from './helpers/fakeSupabase.js';
import { integrationsRouter } from '../src/routes/integrations.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { MAX_PAGES_PER_RUN, PAGE_SIZE } from '../src/lib/hevySync.js';
import { hevyGet } from '../src/lib/hevyClient.js';

/**
 * CONNECTING SOMEBODY ELSE'S TRACKER WITHOUT LOSING THEIR CREDENTIAL.
 *
 * ── WHAT THIS FILE IS WATCHING ─────────────────────────────────────────────
 *
 * Three kinds of failure, and only one of them would ever produce an error.
 *
 * 1. THE KEY ESCAPES. Into a URL, a log line, a response body, an error
 *    envelope. Every one of those is a silent success: the sync works, and the
 *    credential is now in an access log somebody else keeps. So the fake
 *    records every outbound request and every line the logger was given, and
 *    the assertions are about ABSENCE.
 *
 * 2. THE CURSOR MOVES PAST UNREAD PAGES. The event stream is newest first, so
 *    an interrupted pass has left the OLDEST pages unread. Advancing the mark
 *    then loses them permanently, because `?since=` never looks backwards. The
 *    sync reports success either way.
 *
 * 3. A DELETION WIDENS. The delete path takes an id from a third party and
 *    turns it into a filter on the athlete's own sessions. A missing filter
 *    there is a request that empties a training history.
 */

const KEY = '4f8a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const USER = '11111111-2222-3333-4444-555555555555';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Every outbound request, so the assertions can be about what was NOT in it. */
function captureFetch(handler) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), headers: init?.headers ?? {} });
    const { status = 200, body = {} } = handler(String(url), requests.length) ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return requests;
}

/** The router, mounted the way app.js mounts it: after auth, with the handler. */
async function callRoute(method, path, { supabase, body } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: USER };
    req.supabase = supabase;
    next();
  });
  app.use('/api/integrations', integrationsRouter);
  app.use(errorHandler);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const response = await realFetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

const workout = (id, startTime, updatedAt = startTime) => ({
  type: 'updated',
  workout: {
    id,
    start_time: startTime,
    updated_at: updatedAt,
    exercises: [{
      title: 'Squat (Barbell)',
      exercise_template_id: 'D04AC939',
      sets: [{ type: 'normal', weight_kg: 100, reps: 5, rpe: 8 }],
    }],
  },
});

const connected = () => ({
  data: [{ connected: true, connected_at: '2026-09-01T00:00:00Z', synced_through: null, backfill_done: false, last_error: null }],
  error: null,
});

const syncable = (over = {}) => ({
  rpc: {
    hevy_key_for_sync: { data: [{ api_key: KEY, synced_through: null, sync_page: null, backfill_done: false }], error: null },
    hevy_connection_status: connected(),
    record_hevy_sync: { data: null, error: null },
    ...over.rpc,
  },
  rows: {
    user_profile: { data: { units: 'lb' }, error: null },
    workout_sessions: { data: { id: 'session-1', date: '2026-09-10' }, error: null },
    progress_logs: { data: null, error: null },
    ...over.rows,
  },
});

describe('the credential leaves through exactly one door', () => {
  test('it is a header, never a query parameter', async () => {
    /*
     * A query string reaches the access log of every proxy between here and
     * them, and the `Referer` of anything they redirect to. This is the
     * assertion that stops somebody "simplifying" the client into
     * `?api-key=...` on an afternoon when it seems easier.
     */
    const requests = captureFetch(() => ({ status: 200, body: { workout_count: 42 } }));
    const supabase = fakeSupabase({
      rpc: { connect_hevy: { data: null, error: null }, record_audit_event: { data: null, error: null }, hevy_connection_status: connected() },
    });

    const out = await callRoute('POST', '/api/integrations/hevy', { supabase, body: { api_key: KEY } });
    assert.equal(out.status, 201);
    assert.equal(requests.length, 1);
    assert.ok(!requests[0].url.includes(KEY), `the key was put in the URL: ${requests[0].url}`);
    assert.equal(requests[0].headers['api-key'], KEY);
  });

  test('and it is never in the reply, however deep you look', async () => {
    captureFetch(() => ({ status: 200, body: { workout_count: 42 } }));
    const supabase = fakeSupabase({
      rpc: { connect_hevy: { data: null, error: null }, record_audit_event: { data: null, error: null }, hevy_connection_status: connected() },
    });
    const out = await callRoute('POST', '/api/integrations/hevy', { supabase, body: { api_key: KEY } });
    assert.ok(!JSON.stringify(out.body).includes(KEY), 'the key came back to the browser');
  });

  test('a key their API refuses is never stored', async () => {
    /*
     * Proved before it is kept. A stored key that has never worked gives a
     * settings page that says "connected" above a sync that has never once
     * succeeded - and the athlete has no way to tell those apart.
     */
    captureFetch(() => ({ status: 401, body: { error: 'unauthorized' } }));
    const supabase = fakeSupabase({ rpc: { hevy_connection_status: connected() } });
    const out = await callRoute('POST', '/api/integrations/hevy', { supabase, body: { api_key: KEY } });

    assert.equal(out.body.details?.code, 'tracker_key_rejected');
    assert.ok(!supabase.calls.some((c) => c.kind === 'rpc' && c.name === 'connect_hevy'), 'a rejected key was stored anyway');
  });

  test('a malformed key never reaches them at all', async () => {
    const requests = captureFetch(() => ({ status: 200, body: { workout_count: 0 } }));
    const supabase = fakeSupabase({ rpc: { hevy_connection_status: connected() } });
    const out = await callRoute('POST', '/api/integrations/hevy', { supabase, body: { api_key: 'not-a-key' } });
    assert.equal(out.status, 400);
    assert.equal(requests.length, 0, 'a paste error was forwarded to a third party');
  });

  test('the sync reads the key through the one function named for it', async () => {
    captureFetch(() => ({ status: 200, body: { events: [], page_count: 1 } }));
    const supabase = fakeSupabase(syncable());
    await callRoute('POST', '/api/integrations/hevy/sync', { supabase });

    const names = supabase.calls.filter((c) => c.kind === 'rpc').map((c) => c.name);
    assert.ok(names.includes('hevy_key_for_sync'));
    // And nothing else in the route reads the table directly - it cannot, but
    // the assertion is here so that a future definer function that returns the
    // key has to be added deliberately rather than by copy and paste.
    const route = readSource(new URL('../src/routes/integrations.js', import.meta.url));
    assert.equal((route.match(/hevy_key_for_sync/g) ?? []).length, 1);
  });
});

describe('an interrupted pass does not move the cursor past what it did not read', () => {
  test('a full budget of full pages records the page to resume at and no mark', async () => {
    /*
     * The failure this prevents is invisible: the sync says it worked, the
     * cursor sits past a month of unread events, and `?since=` never looks
     * back. The athlete's history simply has a hole in it, and every
     * progression decision is computed from the wrong picture.
     */
    let page = 0;
    captureFetch(() => {
      page += 1;
      return {
        status: 200,
        body: {
          page_count: 99,
          events: Array.from({ length: PAGE_SIZE }, (_, i) => workout(
            `${page}${i}abcdef-1111-2222-3333-444444444444`.slice(0, 8) + '-1111-2222-3333-444444444444',
            '2026-09-10T12:00:00Z'
          )),
        },
      };
    });

    const supabase = fakeSupabase(syncable());
    const out = await callRoute('POST', '/api/integrations/hevy/sync', { supabase });

    assert.equal(out.body.run.finished, false);
    assert.equal(out.body.run.reason, 'page_budget_spent');
    assert.equal(out.body.run.pages, MAX_PAGES_PER_RUN);

    const recorded = supabase.calls.filter((c) => c.kind === 'rpc' && c.name === 'record_hevy_sync').at(-1);
    assert.equal(recorded.params.p_synced_through, null, 'the mark moved past unread pages');
    assert.equal(recorded.params.p_sync_page, MAX_PAGES_PER_RUN + 1);
    assert.equal(recorded.params.p_backfill_done, false);
  });

  test('a finished pass stores the newest event it saw and clears the page', async () => {
    captureFetch(() => ({
      status: 200,
      body: {
        page_count: 1,
        events: [
          workout('aaaaaaaa-1111-2222-3333-444444444444', '2026-09-10T12:00:00Z', '2026-09-10T13:00:00Z'),
          workout('bbbbbbbb-1111-2222-3333-444444444444', '2026-09-09T12:00:00Z', '2026-09-09T12:00:00Z'),
        ],
      },
    }));

    const supabase = fakeSupabase(syncable());
    const out = await callRoute('POST', '/api/integrations/hevy/sync', { supabase });

    assert.equal(out.body.run.finished, true);
    const recorded = supabase.calls.filter((c) => c.kind === 'rpc' && c.name === 'record_hevy_sync').at(-1);
    assert.equal(recorded.params.p_synced_through, '2026-09-10T13:00:00Z');
    assert.equal(recorded.params.p_sync_page, null);
    assert.equal(recorded.params.p_backfill_done, true);
  });

  test('a failure part way through keeps what it wrote and remembers where it was', async () => {
    let calls = 0;
    captureFetch(() => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 200,
          body: {
            page_count: 99,
            events: Array.from({ length: PAGE_SIZE }, (_, i) => workout(
              `${i}aaaaaaa-1111-2222-3333-444444444444`, '2026-09-10T12:00:00Z'
            )),
          },
        };
      }
      return { status: 503, body: {} };
    });

    const supabase = fakeSupabase(syncable());
    const out = await callRoute('POST', '/api/integrations/hevy/sync', { supabase });

    assert.equal(out.body.details?.code, 'tracker_unavailable');
    const recorded = supabase.calls.filter((c) => c.kind === 'rpc' && c.name === 'record_hevy_sync').at(-1);
    // Page 2 is where it died, so page 2 is where it resumes. Throwing the
    // cursor away would restart at page one on every retry, which against an
    // undocumented rate limit turns slow into never.
    assert.equal(recorded.params.p_sync_page, 2);
    assert.equal(recorded.params.p_last_error, 'tracker_unavailable');
    assert.equal(recorded.params.p_synced_through, null);
  });
});

describe('a deletion in their app is a deletion here, and nothing wider', () => {
  test('it is scoped to the athlete and to one imported key', async () => {
    captureFetch(() => ({
      status: 200,
      body: {
        page_count: 1,
        events: [{ type: 'deleted', id: 'CCCCCCCC-1111-2222-3333-444444444444', deleted_at: '2026-09-10T13:00:00Z' }],
      },
    }));

    const supabase = fakeSupabase(syncable({
      rows: { workout_sessions: { data: null, error: null, count: 1 } },
    }));
    await callRoute('POST', '/api/integrations/hevy/sync', { supabase });

    const del = supabase.calls.find((c) => c.kind === 'delete');
    assert.ok(del, 'the deletion event did nothing');
    assert.equal(del.table, 'workout_sessions');
    assert.equal(del.filters.user_id, USER);
    // Lowercased, dashes removed, namespaced - the same derivation the import
    // used to write it, so this can only ever match a row this import wrote.
    assert.equal(del.filters.client_key, 'hevy:cccccccc111122223333444444444444');
  });

  test('an id that is not one of theirs deletes nothing at all', async () => {
    captureFetch(() => ({
      status: 200,
      body: { page_count: 1, events: [{ type: 'deleted', id: '../../everything' }] },
    }));
    const supabase = fakeSupabase(syncable());
    await callRoute('POST', '/api/integrations/hevy/sync', { supabase });
    assert.ok(!supabase.calls.some((c) => c.kind === 'delete'), 'a malformed id reached a DELETE');
  });
});

describe('what the sync refuses to do', () => {
  test('it will not import into an account with no unit', async () => {
    /*
     * `user_profile.units` is NOT NULL with a default of 'lb', so the only way
     * here is to have no profile row. Importing anyway writes a hundred
     * sessions of reps with no load - which looks like data, teaches the
     * progression rules nothing, and is indistinguishable afterwards from
     * somebody who really did log bodyweight work.
     */
    const requests = captureFetch(() => ({ status: 200, body: { events: [], page_count: 1 } }));
    const supabase = fakeSupabase(syncable({ rows: { user_profile: { data: null, error: null } } }));
    const out = await callRoute('POST', '/api/integrations/hevy/sync', { supabase });

    assert.equal(out.body.details?.code, 'precondition_missing');
    assert.equal(requests.length, 0, 'it called their API before checking it could use the answer');
  });

  test('re-reading a page it has already read imports nothing twice', async () => {
    /*
     * The overlap is deliberate - the cursor is rewound a minute, and a
     * resumed page can repeat work - so "already there" is the ordinary case,
     * not an error. What must not happen is it being COUNTED as an import: the
     * settings page would tell somebody 120 sessions came in when 120 sessions
     * were already there, and the first thing they would do is check, find
     * nothing new, and stop trusting the number.
     */
    captureFetch(() => ({
      status: 200,
      body: { page_count: 1, events: [workout('aaaaaaaa-1111-2222-3333-444444444444', '2026-09-10T12:00:00Z')] },
    }));

    const supabase = fakeSupabase(syncable({
      rows: {
        workout_sessions: ({ op }) => (op === 'insert'
          // 23505 is the partial unique index on (user_id, client_key).
          ? { data: null, error: { code: '23505' } }
          : { data: { id: 'session-1', date: '2026-09-10' }, error: null }),
      },
    }));

    const out = await callRoute('POST', '/api/integrations/hevy/sync', { supabase });
    assert.equal(out.body.run.duplicates, 1);
    assert.equal(out.body.run.imported, 0, 'a workout that was already there was counted as new');
  });

  test('a workout from before the window is read and not written', async () => {
    /*
     * The event stream is ordered by when a workout was last TOUCHED, so a
     * ninety-day import legitimately returns a workout from two years ago the
     * moment somebody fixes a typo in it. Reading it is correct; writing it is
     * not - it would put pre-window training into a history whose window is
     * the thing every chart and every progression rule is scoped by, and
     * "roughly ninety days, plus whatever they happened to edit" is a window
     * nobody can reason about when a number looks wrong.
     */
    captureFetch(() => ({
      status: 200,
      body: {
        page_count: 1,
        events: [
          workout('aaaaaaaa-1111-2222-3333-444444444444', '2026-09-10T12:00:00Z', '2026-09-10T12:00:00Z'),
          workout('dddddddd-1111-2222-3333-444444444444', '2024-03-01T12:00:00Z', '2026-09-10T11:00:00Z'),
        ],
      },
    }));

    const supabase = fakeSupabase(syncable());
    const out = await callRoute('POST', '/api/integrations/hevy/sync', { supabase });

    const written = supabase.calls.filter((c) => c.kind === 'insert' && c.table === 'workout_sessions');
    assert.equal(written.length, 1, 'a workout from outside the window was imported');
    assert.equal(written[0].payload.date, '2026-09-10');
    assert.equal(out.body.run.imported, 1);
  });

  test('a sync with nothing connected is an ordinary refusal, not a fault', async () => {
    const supabase = fakeSupabase({ rpc: { hevy_key_for_sync: { data: [], error: null } } });
    const out = await callRoute('POST', '/api/integrations/hevy/sync', { supabase });
    assert.equal(out.status, 409);
    assert.equal(out.body.details?.code, 'tracker_not_connected');
  });

  test('nothing in this router writes to their API', async () => {
    /*
     * Read only, deliberately. Their API has POST /workouts and POST
     * /routines, and pushing a coach-built block into somebody's routine
     * folder is the obvious next feature - and the one that can damage
     * something the athlete owns somewhere else. Reading is recoverable by
     * disconnecting; writing into another product's data is not.
     */
    const client = readSource(new URL('../src/lib/hevyClient.js', import.meta.url));
    assert.doesNotMatch(client, /method: 'POST'/);
    assert.doesNotMatch(client, /method: 'PUT'/);
    assert.match(readRaw(new URL('../src/routes/integrations.js', import.meta.url)), /READ ONLY, ON PURPOSE/);
  });
});

describe('their failures arrive as different sentences, not one', () => {
  const call = (impl) => hevyGet('/workouts/count', { apiKey: KEY, fetchImpl: impl });
  const status = (code) => async () => ({ ok: false, status: code, json: async () => ({ message: `internal trace 9f2b for ${KEY}` }) });

  for (const [code, expected] of [[401, 'tracker_key_rejected'], [403, 'tracker_key_rejected'], [429, 'tracker_rate_limited'], [500, 'tracker_unavailable'], [503, 'tracker_unavailable']]) {
    test(`${code} is ${expected}`, async () => {
      /*
       * The distinction that matters to a person: "your key stopped working"
       * sends them to generate a new one, "their service is down" tells them
       * to wait. Collapsed into one message, an outage sends everybody to
       * revoke a key that was fine.
       */
      await assert.rejects(call(status(code)), (err) => err.details.code === expected);
    });
  }

  test('a timeout and a dead name are the same thing to the athlete', async () => {
    const abort = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
    await assert.rejects(call(abort), (err) => err.details.code === 'tracker_unavailable' && err.details.reason === 'timeout');

    const dns = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
    await assert.rejects(call(dns), (err) => err.details.reason === 'unreachable');
  });

  test('nothing they send us is echoed back into our own error', async () => {
    /*
     * Their error bodies are not documented, and putting an undocumented
     * third-party string into our envelope is how somebody else's content ends
     * up rendered on our page. The status, and nothing else.
     */
    await assert.rejects(call(status(500)), (err) => {
      const envelope = JSON.stringify({ message: err.message, details: err.details });
      assert.ok(!envelope.includes(KEY), 'the key is in the error we would have logged');
      assert.ok(!envelope.includes('9f2b'), 'their body was echoed into ours');
      return true;
    });
  });

  test('an unreadable body is a failure, not an empty page', async () => {
    // Returning `{}` here would look like "no more events" and end a sync
    // early with a mark that says it finished.
    const garbage = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('nope'); } });
    await assert.rejects(call(garbage), (err) => err.details.code === 'tracker_unavailable');
  });
});

describe('one endpoint, because only one of them documents its order', () => {
  const route = readSource(new URL('../src/routes/integrations.js', import.meta.url));
  const client = readSource(new URL('../src/lib/hevyClient.js', import.meta.url));

  test('both phases read the event stream', () => {
    /*
     * `GET /v1/workouts` documents NO ordering - their specification calls it
     * "Get a paginated list of workouts" and says nothing more. The import
     * needs newest-first to know where the window ends, and an assumption that
     * happens to hold on the account you tested against is not a contract.
     * `/v1/workouts/events` states it: "Events are ordered from newest to
     * oldest". So that is the one this reads, in both phases.
     */
    assert.match(client, /\/workouts\/events/);
    assert.doesNotMatch(route, /'\/workouts'/, 'the undocumented-order endpoint is back');
    // /workouts/count is allowed: it returns one integer, and no ordering is
    // involved in an integer.
    assert.match(client, /\/workouts\/count/);
  });
});

describe('an audited act has to pass BOTH gates, and they are written apart', () => {
  /*
   * ── THE BUG THIS FILE EXISTS TO STOP COMING BACK ───────────────────────
   *
   * There are two lists of permitted audit actions and they are not the same
   * list. `audit_events_action_check` says which actions may EXIST, and
   * `record_audit_event()` says which ones a USER may claim about themselves -
   * shorter, because `subscription_changed` comes from the Stripe webhook and
   * `mfa_factor_removed` from the function that removes the factor.
   *
   * I widened the constraint and not the function. Nothing failed: the route
   * calls record_audit_event(), the function refused, the route logged a
   * warning and carried on - so connecting worked, and nothing was ever
   * audited. Reading either definition would have shown a permitted action.
   * It took running the round trip as the `authenticated` role to find it.
   */
  const actions = [...readSource(new URL('../src/routes/integrations.js', import.meta.url))
    .matchAll(/p_action: '([a-z_]+)'/g)].map((m) => m[1]);

  const mayExist = latestDefinition('constraint audit_events_action_check').body;
  const aUserMayClaim = latestDefinition('function public.record_audit_event').body;

  test('the route records something at all', () => {
    // A regex that stops matching would make every assertion below vacuous.
    assert.deepEqual(actions, ['tracker_connected', 'tracker_disconnected']);
  });

  for (const action of ['tracker_connected', 'tracker_disconnected']) {
    test(`${action} passes the table's gate`, () => {
      assert.match(mayExist, new RegExp(`'${action}'`));
    });

    test(`${action} passes the function's gate, which is the narrower one`, () => {
      assert.match(aUserMayClaim, new RegExp(`'${action}'`));
    });
  }

  test('and the narrower gate is still narrower', () => {
    // If these two lists ever become identical, one of them has stopped doing
    // its job - and it is this one, because a browser would then be able to
    // claim a subscription change.
    assert.match(mayExist, /'subscription_changed'/);
    assert.doesNotMatch(aUserMayClaim, /'subscription_changed'/);
    assert.match(mayExist, /'mfa_factor_removed'/);
    assert.doesNotMatch(aUserMayClaim, /'mfa_factor_removed'/);
  });
});

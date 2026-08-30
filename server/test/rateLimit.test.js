import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../src/middleware/rateLimit.js';

/**
 * The rate limit middleware's own behavior, with the database stubbed.
 *
 * The counting itself is tested in Postgres (see the build log); what matters
 * here is what the middleware does with the answer - and in particular that it
 * fails OPEN, which is a decision worth pinning down with a test so nobody
 * "fixes" it into failing closed without thinking about it.
 */

function makeReq(rpcResult) {
  return {
    user: { id: 'user-1' },
    supabase: { rpc: async () => rpcResult },
  };
}

function makeRes() {
  const headers = {};
  return {
    headers,
    set(nameOrObject, value) {
      if (typeof nameOrObject === 'object') Object.assign(headers, nameOrObject);
      else headers[nameOrObject] = value;
      return this;
    },
  };
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

describe('rateLimit middleware', () => {
  test('allows the request and sets standard headers when under quota', async () => {
    const req = makeReq({ data: [{ allowed: true, used: 3, quota: 60, resets_at: inAnHour() }] });
    const res = makeRes();
    let calledNext = false;

    await rateLimit('chat')(req, res, (err) => {
      assert.equal(err, undefined);
      calledNext = true;
    });

    assert.ok(calledNext);
    assert.equal(res.headers['RateLimit-Limit'], '60');
    assert.equal(res.headers['RateLimit-Remaining'], '57');
    assert.ok(Number(res.headers['RateLimit-Reset']) > 3500);
  });

  test('rejects with 429 and Retry-After once over quota', async () => {
    const req = makeReq({ data: [{ allowed: false, used: 61, quota: 60, resets_at: inAnHour() }] });
    const res = makeRes();
    let error;

    await rateLimit('chat')(req, res, (err) => {
      error = err;
    });

    assert.ok(error, 'expected an error to be passed to next()');
    assert.equal(error.status, 429);
    assert.match(error.message, /limit of 60 requests/);
    assert.ok(res.headers['Retry-After']);
    assert.equal(res.headers['RateLimit-Remaining'], '0');
  });

  test('reports remaining as 0 rather than a negative number', async () => {
    const req = makeReq({ data: [{ allowed: false, used: 75, quota: 60, resets_at: inAnHour() }] });
    const res = makeRes();
    await rateLimit('chat')(req, res, () => {});
    assert.equal(res.headers['RateLimit-Remaining'], '0');
  });

  test('FAILS OPEN when the limiter itself errors', async () => {
    // Deliberate: if the rate limit check breaks, refusing every request turns
    // a counter problem into a full outage. The failure is logged loudly
    // instead. This test exists so the tradeoff stays a decision.
    const req = makeReq({ data: null, error: { code: '57014', message: 'statement timeout' } });
    const res = makeRes();
    let error = 'unset';

    await rateLimit('chat')(req, res, (err) => {
      error = err;
    });

    assert.equal(error, undefined, 'a limiter failure must not block the request');
  });

  test('passes through when the function returns no rows', async () => {
    const req = makeReq({ data: [] });
    const res = makeRes();
    let error = 'unset';
    await rateLimit('chat')(req, res, (err) => {
      error = err;
    });
    assert.equal(error, undefined);
  });
});

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { errorHandler, notFound, HttpError } from '../src/middleware/errorHandler.js';

/**
 * These tests exist because this middleware shipped broken and nothing caught
 * it.
 *
 * `errorHandler.js` re-exported HttpError with `export { HttpError } from
 * '...'`, which forwards the binding without introducing it locally, so the
 * `err instanceof HttpError` inside the handler threw a ReferenceError on
 * every single error. Every failed request in production became an opaque 500,
 * and - worse - the original error was never logged, because the throw
 * happened before the logging call.
 *
 * Every other module was covered. This one was not, on the reasoning that it
 * is "just plumbing". Plumbing that runs on every error path is the last thing
 * that should be untested: a fault here does not break one feature, it removes
 * the ability to diagnose all of them.
 */

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const req = { method: 'POST', path: '/api/chat', user: { id: 'user-1' } };

describe('errorHandler', () => {
  test('does not throw on an HttpError — the regression that shipped', async () => {
    const res = fakeRes();
    await assert.doesNotReject(async () => errorHandler(new HttpError(400, 'Invalid request.'), req, res, () => {}));
    assert.equal(res.statusCode, 400);
  });

  test('reports the status the error asked for', async () => {
    const res = fakeRes();
    await errorHandler(new HttpError(429, 'Slow down.'), req, res, () => {});
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.message, 'Slow down.');
    assert.equal(res.body.error, 'request_failed');
  });

  test('an unrecognised error is a 500', async () => {
    const res = fakeRes();
    await errorHandler(new Error('database exploded'), req, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'internal_error');
  });

  test('a 500 never leaks internals to the client', async () => {
    const res = fakeRes();
    await errorHandler(new Error('connection string postgres://user:hunter2@host'), req, res, () => {});
    const serialised = JSON.stringify(res.body);
    assert.equal(res.body.message, 'Something went wrong on our end.');
    assert.ok(!serialised.includes('hunter2'));
    assert.ok(!serialised.includes('postgres://'));
    assert.ok(!('stack' in res.body));
  });

  test('a 4xx message DOES reach the client, because it is for them to act on', async () => {
    const res = fakeRes();
    await errorHandler(new HttpError(400, 'Message cannot be empty'), req, res, () => {});
    assert.equal(res.body.message, 'Message cannot be empty');
  });

  test('carries structured validation details through', async () => {
    const res = fakeRes();
    await errorHandler(new HttpError(400, 'Invalid.', { message: ['Required'] }), req, res, () => {});
    assert.deepEqual(res.body.details, { message: ['Required'] });
  });

  test('logs the validation details, not just the generic message', async () => {
    // "Invalid request." is the same sentence whichever field was rejected.
    // Without the details in the log, a 400 can only be diagnosed by guessing
    // at the client - which is how this got missed twice.
    const lines = [];
    // logger.error writes to console.error, not console.log.
    const original = console.error;
    console.error = (line) => lines.push(line);
    try {
      await errorHandler(new HttpError(400, 'Invalid request.', { message: ['String must contain at least 1 character(s)'] }), req, fakeRes(), () => {});
    } finally {
      console.error = original;
    }
    const logged = lines.join('\n');
    assert.match(logged, /details/, 'validation details must reach the log');
    assert.match(logged, /at least 1 character/);
  });

  test('trusts a status only when it is a plausible HTTP status', async () => {
    for (const status of [0, 200, 999, '400', null, undefined, NaN]) {
      const res = fakeRes();
      const err = new Error('odd');
      err.status = status;
      await errorHandler(err, req, res, () => {});
      assert.equal(res.statusCode, 500, `status ${String(status)} should not be trusted`);
    }
  });

  test('survives a request object with nothing on it', async () => {
    const res = fakeRes();
    await assert.doesNotReject(async () => errorHandler(new HttpError(404, 'Gone'), {}, res, () => {}));
    assert.equal(res.statusCode, 404);
  });

  test('still answers when the response itself misbehaves', async () => {
    const res = fakeRes();
    let attempts = 0;
    res.json = function (payload) {
      attempts += 1;
      if (attempts === 1) throw new Error('socket closed');
      this.body = payload;
      return this;
    };
    await assert.doesNotReject(async () => errorHandler(new Error('original'), req, res, () => {}));
    assert.equal(res.body.error, 'internal_error');
  });
});

describe('notFound', () => {
  test('names the route that was not found, and nothing else', async () => {
    const res = fakeRes();
    notFound({ method: 'GET', path: '/api/nope' }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'not_found');
    assert.match(res.body.message, /GET \/api\/nope/);
  });
});

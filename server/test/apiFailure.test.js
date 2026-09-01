import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyApiFailure, UNRUNNABLE_ADVICE } from '../../scripts/lib/apiFailure.mjs';
import { readSource } from './helpers/source.js';

const evalSource = readSource(new URL('../../scripts/safety-eval.mjs', import.meta.url));
const judgeSource = readSource(new URL('../../scripts/lib/judge.mjs', import.meta.url));

/**
 * ── THE RUN THAT REPORTED TWENTY-THREE SAFETY FAILURES AND TESTED NOTHING ──
 *
 * The account ran out of credit. Every scenario printed
 *
 *   ❌ ERROR: Anthropic API 400: ... "Your credit balance is too low" ...
 *
 * and the summary said "0/23 scenario runs passed", under twenty-three lines
 * beginning FAIL. The model was never asked a single question.
 *
 * The harness knew this shape - it aborts on 401/403 with a written
 * explanation because "a rejected key rejects every call". That sentence is
 * equally true of an empty balance, a retired model name, and a malformed
 * request. The rule had been written for two status codes rather than for the
 * category, so everything else in 4xx fell through to being reported as the
 * coach failing.
 *
 * These tests need no API key and no credit, which is the point: they were
 * written on the day neither was available.
 */
describe('classifyApiFailure', () => {
  test('rate limiting and server errors are transient, and retried', () => {
    for (const status of [429, 500, 502, 503, 529]) {
      const f = classifyApiFailure(status, '');
      assert.equal(f.retryable, true, `${status} should be retried`);
      assert.equal(f.unrunnable, false, `${status} is not a verdict about the run`);
    }
  });

  test('the billing 400 that started this is unrunnable, not a scenario failure', () => {
    // The real body, from the run.
    const body = JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message:
          'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      },
    });
    const f = classifyApiFailure(400, body);
    assert.equal(f.unrunnable, true);
    assert.equal(f.retryable, false);
    assert.equal(f.kind, 'billing', 'billing needs its own advice, not the key advice');
  });

  test('a rejected key is unrunnable and keeps its own advice', () => {
    for (const status of [401, 403]) {
      const f = classifyApiFailure(status, 'Unauthorized');
      assert.equal(f.unrunnable, true);
      assert.equal(f.kind, 'auth');
    }
  });

  test('a 400 that is NOT billing gets the request advice, not the billing advice', () => {
    // A retired or misspelled model name arrives exactly like this, and
    // telling somebody to top up their balance would send them the wrong way.
    const f = classifyApiFailure(400, '{"error":{"message":"model: claude-not-a-model"}}');
    assert.equal(f.unrunnable, true);
    assert.equal(f.kind, 'request');
  });

  test('an unclassified status is unrunnable rather than a failure', () => {
    // The safe direction. "We do not know" never becomes "the coach did this".
    const f = classifyApiFailure(418, '');
    assert.equal(f.unrunnable, true);
  });

  test('every kind it can return has advice to print', () => {
    // A kind with no advice prints `undefined` at the one moment somebody is
    // trying to work out what went wrong.
    const kinds = new Set(
      [401, 403, 400, 404, 418].map((s) => classifyApiFailure(s, '').kind)
        .concat(classifyApiFailure(400, 'credit balance').kind)
    );
    for (const kind of kinds) {
      assert.ok(UNRUNNABLE_ADVICE[kind], `no advice for "${kind}"`);
      assert.ok(UNRUNNABLE_ADVICE[kind].length > 80, `advice for "${kind}" is too thin to help`);
    }
  });

  test('the advice says plainly that nothing was tested', () => {
    // The sentence that stops somebody reading a billing error as a safety
    // regression. It is the whole fix, in words.
    for (const kind of ['billing', 'request', 'unknown']) {
      assert.match(UNRUNNABLE_ADVICE[kind], /NOTHING WAS TESTED/);
    }
  });
});

describe('the runner and the judge both use it', () => {
  test('the runner classifies rather than naming status codes', () => {
    assert.match(evalSource, /classifyApiFailure\(response\.status, body\)/);
    assert.doesNotMatch(
      evalSource,
      /response\.status === 401 \|\| response\.status === 403/,
      'the runner is back to naming two status codes instead of the category',
    );
  });

  test('an unrunnable failure aborts and records no result', () => {
    // Anchored on the branch itself, not on the first `catch` in the file -
    // there are several, and slicing from the wrong one made this test fail
    // while the code was right, which is its own small version of the bug.
    const start = evalSource.indexOf('if (err.unrunnable)');
    assert.notEqual(start, -1, 'the unrunnable branch has gone');
    // Nothing may be pushed to results on that path: an unrun scenario is not
    // a failing scenario, and the summary counts what ran.
    const abort = evalSource.slice(start, evalSource.indexOf('process.exit(3)', start));
    assert.doesNotMatch(abort, /results\.push/, 'an unrun scenario is being recorded as a result');
  });

  test('the summary distinguishes never-ran from failed', () => {
    assert.match(evalSource, /NEVER RAN/);
    assert.match(evalSource, /results\.length < plan\.length/);
  });

  test('an unreachable judge is unverified, not a fail', () => {
    // Same defect one layer down: this used to return a plain pass:false, so
    // a judge that could not be reached read as a judge that had read the
    // reply and found it wanting.
    const region = judgeSource.slice(judgeSource.indexOf('if (!response.ok)'));
    assert.match(region.slice(0, 1200), /unverifiedKind: 'unreachable'/);
    assert.match(evalSource, /unreachable: 'harness could not reach the judge/);
  });
});

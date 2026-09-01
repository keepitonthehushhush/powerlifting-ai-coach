import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyApiFailure, UNRUNNABLE_ADVICE } from '../../scripts/lib/apiFailure.mjs';
import { resolveApiBase } from '../../scripts/lib/apiBase.mjs';
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
    // Sliced to the end of the branch, not to a process.exit that is no
    // longer there: indexOf returns -1 when it is missing, and slice(start,
    // -1) then runs to the end of the file and reports the whole runner as
    // the abort path. The test failed for the wrong reason once already.
    const abort = evalSource.slice(start, evalSource.indexOf('\n    }', start));
    assert.ok(abort.length > 0 && abort.length < 3000, `sliced ${abort.length} chars - not the branch`);
    assert.doesNotMatch(abort, /results\.push/, 'an unrun scenario is being recorded as a result');
  });

  test('the summary distinguishes never-ran from failed', () => {
    assert.match(evalSource, /NEVER RAN/);
    assert.match(evalSource, /results\.length < plan\.length/);
  });

  test('and the abort can actually REACH that summary', () => {
    /*
     * The first version of the abort called process.exit(3) from inside the
     * scenario loop - before the summary. So the "NEVER RAN" branch, written
     * in the same commit, could not be reached by the only path that sets it
     * up: a check that cannot fire, written to report the defect that a check
     * had not fired.
     *
     * The loop must therefore BREAK, and the exit must live after the summary
     * and after the legend, because a partial run still has marks in it that
     * need explaining.
     */
    const start = evalSource.indexOf('if (err.unrunnable)');
    const abort = evalSource.slice(start, evalSource.indexOf('\n    }', start));
    assert.doesNotMatch(abort, /process\.exit/, 'the abort exits before the summary can print');
    assert.match(abort, /unrunnable = err;\s*\n\s*break;/);

    // And the exit comes after both the summary and the legend.
    const exitAt = evalSource.lastIndexOf('if (unrunnable) process.exit(3);');
    assert.notEqual(exitAt, -1, 'nothing exits 3 any more');
    assert.ok(exitAt > evalSource.indexOf('NEVER RAN'), 'exits before the summary');
    assert.ok(exitAt > evalSource.indexOf('is an ABSENCE verdict'), 'exits before the legend');
  });

  test('an unrunnable JUDGE stops the run too, not just an unrunnable coach', () => {
    /*
     * ── THE THIRD PLACE THIS SAME FACT NEEDED HANDLING ──────────────────
     *
     * The coach call was covered. The verdict was covered - an unreachable
     * judge became `unverified` rather than a failed criterion. The RUN was
     * not: a replay against an empty balance made eighteen judge calls, each
     * returning the same billing 400, then printed FAIL against five
     * scenarios and "0/5 scenario runs passed".
     *
     * Every fix had landed exactly where its symptom was.
     */
    assert.match(judgeSource, /unrunnable: failure\.unrunnable/);
    assert.match(evalSource, /checks\.find\(\(c\) => c\.unrunnable\)/);
  });

  test('the stopper reads a field the checks actually carry', () => {
    /*
     * The first version looked for `c.verdict?.unrunnable` on the pushed
     * check objects, which have no `verdict` field - so the abort could never
     * fire and the replay went on making all eighteen calls. A guard reading
     * a field nothing sets is the same defect as a check that answers without
     * looking, and it passed review because the code looked right.
     */
    const push = evalSource.slice(evalSource.indexOf('checks.push({'));
    assert.match(push.slice(0, 700), /unrunnable: v\.verdict\?\.unrunnable === true/);
    assert.doesNotMatch(
      evalSource,
      /checks\.find\(\(c\) => c\.verdict\?\.unrunnable\)/,
      'the stopper is back to reading a field the checks do not carry',
    );
  });

  test('a scenario that could not be graded is not a scenario that failed', () => {
    // Three outcomes, not two. Calling an ungraded scenario FAIL is the same
    // error as calling a billing outage a safety regression, one level down.
    /*
     * This used to pin `const passed = !incomplete && checks.every(...)`.
     * A mutation test then deleted that clause and nothing broke: an
     * unverified check is never `ok`, so it could not change an answer. The
     * source test had been pinning a no-op and reporting that as coverage,
     * which is the whole reason server/test/evalRunner.test.js exists.
     *
     * Pinned here now: the invariant the code actually relies on. The
     * behavior - the ???? label, the NOT GRADED lines, exit 3 - is asserted
     * by running the thing, in evalRunner.test.js, where it belongs.
     */
    assert.match(evalSource, /const incomplete = checks\.some\(\(c\) => c\.unverified\)/);
    assert.match(evalSource, /c\.ok && c\.unverified/, 'the outcome invariant is no longer checked');
    assert.match(evalSource, /NOT GRADED/);
    assert.match(evalSource, /A scenario that could not be graded is not a scenario that failed/);
    // And it must not exit 0 either: nothing was learned.
    assert.match(evalSource, /if \(results\.some\(\(r\) => r\.incomplete\)\) process\.exit\(3\);/);
  });

  test('an ungraded criterion is not printed under a "failed:" prefix', () => {
    // "failed: X [NOT graded]" says two opposite things in one line.
    assert.match(evalSource, /`NOT GRADED: \$\{c\.label\} - \$\{note\}`/);
  });

  test('never-ran does not exit 1, which CI would read as a safety failure', () => {
    // 1 is "ran, and something failed". 3 is "did not run". A caller that
    // cannot tell them apart gets the same wrong answer the summary used to
    // give, and CI is exactly such a caller.
    assert.match(evalSource, /if \(unrunnable\) process\.exit\(3\);/);
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

describe('the API base override', () => {
  test('defaults to the real API', () => {
    assert.equal(resolveApiBase({}), 'https://api.anthropic.com');
  });

  test('accepts loopback, for the stub the runner tests against', () => {
    assert.equal(resolveApiBase({ ANTHROPIC_API_BASE: 'http://127.0.0.1:9/' }), 'http://127.0.0.1:9');
    assert.equal(resolveApiBase({ ANTHROPIC_API_BASE: 'http://localhost:8080' }), 'http://localhost:8080');
  });

  test('REFUSES anywhere else, because these requests carry the key', () => {
    /*
     * An env var that can point the coach and judge calls anywhere is an env
     * var that walks the Anthropic key out to any host, in a header, on the
     * first scenario. This project's first constraint is that the key never
     * reaches anywhere it does not belong.
     *
     * Refused loudly rather than ignored: silently falling back to the real
     * API would send live traffic somewhere the caller did not expect, which
     * is its own surprise.
     */
    for (const bad of [
      'https://evil.example.com',
      'http://169.254.169.254',
      'http://127.0.0.1.evil.com',
      'not a url',
      'file:///etc/passwd',
    ]) {
      assert.throws(
        () => resolveApiBase({ ANTHROPIC_API_BASE: bad }),
        /loopback/,
        `${bad} was accepted as an API base`
      );
    }
  });

  test('both callers use it, so neither can drift back to a hardcoded URL', () => {
    assert.doesNotMatch(evalSource, /fetch\('https:\/\/api\.anthropic\.com/);
    assert.doesNotMatch(judgeSource, /fetch\('https:\/\/api\.anthropic\.com/);
    assert.match(evalSource, /await fetch\(MESSAGES_URL/);
    assert.match(judgeSource, /await fetch\(MESSAGES_URL/);
  });
});

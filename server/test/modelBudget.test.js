import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import {
  DEFAULT_MAX_TOKENS,
  resolveMaxTokens,
  describeBudgetAgreement,
} from '../src/lib/modelBudget.js';

const evalScript = readSource(new URL('../../scripts/safety-eval.mjs', import.meta.url));
const env = readSource(new URL('../src/lib/env.js', import.meta.url));
const app = readSource(new URL('../src/app.js', import.meta.url));
const verify = readSource(new URL('../../scripts/verify-deployment.mjs', import.meta.url));

describe('ONE OUTPUT BUDGET, READ BY BOTH SIDES', () => {
  test('the safety evaluation does not carry a budget of its own', () => {
    // It carried 2048 while production ran 8192. Five of sixteen scenarios
    // failed on truncation, one of them on a real assertion, and the suite was
    // reporting on a coach that does not ship.
    assert.doesNotMatch(evalScript, /max_tokens:\s*\d+/, 'a numeric literal is back in the eval');
    assert.match(evalScript, /max_tokens: MAX_TOKENS/);
    assert.match(evalScript, /resolveMaxTokens\(process\.env\)/);
  });

  test('the server does not carry one either', () => {
    assert.doesNotMatch(env, /ANTHROPIC_MAX_TOKENS['"],\s*['"]\d+/, 'env.js re-hardcoded a default');
    assert.match(env, /maxTokens: resolveMaxTokens\(env\)/);
  });

  test('a run states the budget it graded at', () => {
    // A run that does not say cannot be compared with production, and for
    // three weeks these two silently differed.
    assert.match(evalScript, /max output tokens/);
  });
});

describe('resolveMaxTokens', () => {
  test('unset falls back to the documented default', () => {
    assert.equal(resolveMaxTokens({}), DEFAULT_MAX_TOKENS);
    assert.equal(resolveMaxTokens(undefined), DEFAULT_MAX_TOKENS);
  });

  test('a set value is honored', () => {
    assert.equal(resolveMaxTokens({ ANTHROPIC_MAX_TOKENS: '4096' }), 4096);
  });

  test('a typo becomes the default, never 0 or NaN', () => {
    // max_tokens: 0 is rejected by the API and NaN serializes to null. Either
    // turns a fat-fingered deploy variable into an outage instead of a default.
    for (const bad of ['', '   ', 'eight thousand', '0', '-1', 'NaN']) {
      assert.equal(resolveMaxTokens({ ANTHROPIC_MAX_TOKENS: bad }), DEFAULT_MAX_TOKENS, bad);
    }
  });
});

describe('THE HALF OF THE FIX THAT IS ABOUT PRODUCTION', () => {
  test('/api/health publishes the budget, and it is not a secret', () => {
    assert.match(app, /maxOutputTokens: config\.anthropic\.maxTokens/);
    // A ceiling on reply length. Nothing about the prompt, the key, or an
    // athlete - and it sits beside deploymentId, which is the same kind of fact.
    assert.match(app, /deploymentId: process\.env\.VERCEL_DEPLOYMENT_ID/);
  });

  test('verify:deployment compares them rather than assuming', () => {
    assert.match(verify, /describeBudgetAgreement/);
  });

  test('agreement is a pass', () => {
    const r = describeBudgetAgreement({ local: 4096, health: { maxOutputTokens: 4096 } });
    assert.equal(r.verdict, 'agree');
    assert.equal(r.remote, 4096);
  });

  test('a difference is a failure that names both numbers', () => {
    const r = describeBudgetAgreement({ local: 2048, health: { maxOutputTokens: 8192 } });
    assert.equal(r.verdict, 'differ');
    assert.equal(r.local, 2048);
    assert.equal(r.remote, 8192);
  });

  test('AN UNREACHABLE DEPLOYMENT IS UNKNOWN, NOT AGREEMENT', () => {
    const r = describeBudgetAgreement({ local: 4096, health: null, healthProblem: 'fetch failed' });
    assert.equal(r.verdict, 'unknown');
    assert.equal(r.remote, null);
    assert.match(r.reason, /health_unreachable/);
  });

  test('a deployment too old to publish the field is unknown, not agreement', () => {
    // This is the live case on 2026-08-30: production answers /api/health and
    // the field is simply not there yet. The tempting reading is "fine".
    for (const health of [{ status: 'ok' }, { maxOutputTokens: null }, { maxOutputTokens: '4096' }]) {
      const r = describeBudgetAgreement({ local: 4096, health });
      assert.equal(r.verdict, 'unknown', JSON.stringify(health));
      assert.equal(r.reason, 'field_absent');
    }
  });

  test('the unknown branch never prints PASS', () => {
    // Reading the script rather than the function, because the function can be
    // right and the reporting still reassuring.
    const unknownBranch = verify.slice(
      verify.indexOf("budget.verdict === 'unknown'"),
      verify.indexOf("budget.verdict === 'differ'")
    );
    assert.ok(unknownBranch.length > 0, 'the unknown branch was not found');
    assert.doesNotMatch(unknownBranch, /PASS/);
    assert.match(unknownBranch, /COULD NOT DETERMINE/);
  });
});

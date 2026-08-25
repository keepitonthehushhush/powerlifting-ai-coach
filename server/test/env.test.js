import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoLeakedSecrets, buildConfig, optional, required } from '../src/lib/env.js';

/**
 * Configuration parsing and the secret-leak guard.
 *
 * These tests could not exist in their current form until lib/env.js was split
 * out of config.js. Previously the validation ran at import time, so a test
 * asserting "buildConfig throws when ANTHROPIC_API_KEY is missing" could not
 * import the function without triggering the throw first and taking the whole
 * test file down with it. The fail-fast behaviour was therefore the one piece
 * of the configuration layer with no coverage at all - which is how it stayed
 * broken for `npm test`.
 */

const VALID = {
  ANTHROPIC_API_KEY: 'sk-ant-real',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
};

describe('assertNoLeakedSecrets', () => {
  test('accepts an environment with only legitimate public VITE_ variables', () => {
    assert.doesNotThrow(() =>
      assertNoLeakedSecrets({
        VITE_SUPABASE_URL: 'https://x.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
        ANTHROPIC_API_KEY: 'sk-ant-real',
      })
    );
  });

  test('refuses when the Anthropic key is browser-visible', () => {
    assert.throws(() => assertNoLeakedSecrets({ VITE_ANTHROPIC_API_KEY: 'sk-ant-oops' }), /Refusing to start/);
  });

  test('catches a browser-visible service role key', () => {
    assert.throws(() => assertNoLeakedSecrets({ VITE_SUPABASE_SERVICE_ROLE_KEY: 'x' }), /Refusing to start/);
  });

  test('catches generically-named secrets too', () => {
    assert.throws(() => assertNoLeakedSecrets({ VITE_APP_SECRET: 'x' }), /Refusing to start/);
    assert.throws(() => assertNoLeakedSecrets({ VITE_PRIVATE_KEY: 'x' }), /Refusing to start/);
  });

  test('names the offending variables so the fix is obvious', () => {
    assert.throws(
      () => assertNoLeakedSecrets({ VITE_ANTHROPIC_API_KEY: 'x', VITE_APP_SECRET: 'y' }),
      /VITE_ANTHROPIC_API_KEY, VITE_APP_SECRET/
    );
  });
});

describe('required / optional', () => {
  test('required returns a trimmed value', () => {
    assert.equal(required({ A: '  value  ' }, 'A'), 'value');
  });

  test('required throws a message that says how to fix it', () => {
    assert.throws(() => required({}, 'ANTHROPIC_API_KEY'), /Copy \.env\.example to \.env/);
  });

  test('required treats whitespace-only as missing', () => {
    assert.throws(() => required({ A: '   ' }, 'A'), /Missing required/);
  });

  test('optional falls back for missing and blank values alike', () => {
    assert.equal(optional({}, 'A', 'fallback'), 'fallback');
    assert.equal(optional({ A: '  ' }, 'A', 'fallback'), 'fallback');
    assert.equal(optional({ A: 'set' }, 'A', 'fallback'), 'set');
  });
});

describe('buildConfig', () => {
  test('builds a complete config from a valid environment', () => {
    const config = buildConfig(VALID);
    assert.equal(config.anthropic.apiKey, 'sk-ant-real');
    assert.equal(config.supabase.url, 'https://example.supabase.co');
    assert.equal(config.isProduction, false);
  });

  test('fails fast when a required variable is absent', () => {
    for (const key of Object.keys(VALID)) {
      const incomplete = { ...VALID };
      delete incomplete[key];
      assert.throws(() => buildConfig(incomplete), new RegExp(key), `expected buildConfig to throw for missing ${key}`);
    }
  });

  test('applies documented defaults', () => {
    const config = buildConfig(VALID);
    assert.equal(config.anthropic.model, 'claude-sonnet-5');
    assert.equal(config.anthropic.maxTokens, 4096);
    assert.equal(config.chat.historyWindow, 30);
    // Raised from 4,000 after a real user hit it mid-sentence and got
    // "Invalid request." See server/test/messageLimit.test.js.
    assert.equal(config.chat.maxMessageLength, 12000);
  });

  test('lets the environment override the model without a code change', () => {
    // The point of ADR-7: swapping models is a deploy variable, not a commit.
    const config = buildConfig({ ...VALID, ANTHROPIC_MODEL: 'claude-opus-5' });
    assert.equal(config.anthropic.model, 'claude-opus-5');
  });

  test('marks production correctly', () => {
    assert.equal(buildConfig({ ...VALID, NODE_ENV: 'production' }).isProduction, true);
    assert.equal(buildConfig({ ...VALID, NODE_ENV: 'development' }).isProduction, false);
  });

  test('checks for leaked secrets before anything else', () => {
    // Even a config that is otherwise complete must be refused.
    assert.throws(() => buildConfig({ ...VALID, VITE_ANTHROPIC_API_KEY: 'x' }), /Refusing to start/);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoLeakedSecrets } from '../src/config.js';

/**
 * The single highest-consequence misconfiguration in this project is giving a
 * server-only secret a VITE_ prefix, which compiles it into the browser
 * bundle. This turns that mistake into a boot failure.
 */
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

  test('refuses to boot when the Anthropic key is browser-visible', () => {
    assert.throws(
      () => assertNoLeakedSecrets({ VITE_ANTHROPIC_API_KEY: 'sk-ant-oops' }),
      /Refusing to start/
    );
  });

  test('catches a browser-visible service role key', () => {
    assert.throws(
      () => assertNoLeakedSecrets({ VITE_SUPABASE_SERVICE_ROLE_KEY: 'x' }),
      /Refusing to start/
    );
  });

  test('catches generically-named secrets too', () => {
    assert.throws(() => assertNoLeakedSecrets({ VITE_APP_SECRET: 'x' }), /Refusing to start/);
    assert.throws(() => assertNoLeakedSecrets({ VITE_PRIVATE_KEY: 'x' }), /Refusing to start/);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The browser must never white-screen on missing configuration.
 *
 * This is a regression test for the first production deploy, which rendered a
 * black page. The VITE_ variables were absent when Vercel built, Vite inlined
 * `undefined`, supabase.js threw at module load, React never mounted, and the
 * body stayed empty. Diagnosing it required comparing asset hashes between two
 * builds — the app itself gave no signal at all.
 *
 * These assert on source text rather than behaviour because the modules use
 * `import.meta.env`, which only Vite can resolve. A crude test that pins the
 * property is better than no test: the failure it guards against cost an hour
 * and produced zero error messages.
 */

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('browser configuration handling', () => {
  test('supabase.js does not throw at module load', () => {
    const source = read('web/src/lib/supabase.js');
    assert.doesNotMatch(
      source,
      /^\s*throw new Error/m,
      'a throw at module scope prevents React mounting and yields a blank page'
    );
  });

  test('App checks configuration before mounting any provider', () => {
    const source = read('web/src/App.jsx');
    assert.match(source, /missingConfig\(\)/);
    assert.match(source, /<ConfigError missing=\{missing\} \/>/);

    // The check must come before the providers, or a provider could throw
    // first and we are back to a blank page.
    assert.ok(
      source.indexOf('missingConfig()') < source.indexOf('<I18nProvider>'),
      'the config check must precede the provider tree'
    );
  });

  test('the error screen names the missing variables', () => {
    const source = read('web/src/components/ConfigError.jsx');
    assert.match(source, /missing\.map/, 'it must list which variables are absent');
    assert.match(source, /trigger a new build|new build/i, 'it must say a rebuild is required');
  });

  test('the error screen depends on nothing that could itself be broken', () => {
    // It renders precisely when the app cannot start, so importing the i18n
    // provider or the API client here would risk failing for the same reason.
    const source = read('web/src/components/ConfigError.jsx');
    const imports = [...source.matchAll(/^import .*$/gm)].map((m) => m[0]);
    assert.deepEqual(imports, [], 'the config error screen must have no imports');
  });

  test('config.js treats the string "undefined" as missing', () => {
    // Vite inlines an unset variable as the literal `undefined`, which can
    // reach the bundle as a string depending on how it is interpolated.
    const source = read('web/src/lib/config.js');
    assert.match(source, /=== 'undefined'/);
  });
});

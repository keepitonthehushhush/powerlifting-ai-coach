import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { readSource } from './helpers/source.js';

/**
 * ── supabase.rpc() IS NOT A PROMISE, AND .catch() CRASHED THE PRODUCT ──────
 *
 * `supabase.rpc(...)` returns a PostgrestFilterBuilder. It is a THENABLE - it
 * has `then`, and calling `then` is what sends the request - and it has no
 * `catch`. So this:
 *
 *     supabase.rpc('record_page_visit', {...}).catch(() => {});
 *
 * was not a safety net. It was `undefined(() => {})`, a TypeError thrown
 * synchronously inside a React effect, escalated to the ErrorBoundary. Every
 * route in the product rendered "Something broke on our side" - the front
 * page included - for anybody who loaded the site.
 *
 * It shipped twice. RecordVisit took out the whole app; Login.jsx took out the
 * sign-in page at the exact moment somebody had typed a wrong password, under
 * a comment promising that a telemetry write would never become the reason
 * they saw a second error.
 *
 * ── AND HOW IT HID ────────────────────────────────────────────────────────
 *
 * The builder only sends its request when `then` is called. `.catch` threw
 * BEFORE that, so no request was ever made - `page_visits` sat at zero rows
 * for the entire time the feature was live. The evidence that should have
 * revealed a broken feature looked exactly like a feature nobody had used.
 */

/** Every source file under a directory, recursively. */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const url = new URL(entry, dir);
    const path = url.pathname;
    if (statSync(path).isDirectory()) sources(new URL(`${entry}/`, dir), out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(url);
  }
  return out;
}

describe('a query builder is never treated as a promise', () => {
  test('the assumption itself is true of the installed client', () => {
    /*
     * Asserted against the real package rather than remembered, because the
     * whole defect was a confident belief about an API. If a future version
     * adds `catch`, this fails and the rule below can be relaxed deliberately
     * rather than discovered by a crash.
     */
    const client = createClient('https://example.supabase.co', 'sb_publishable_test');
    const builder = client.rpc('record_page_visit', { p_route: '/', p_referrer: 'direct' });
    assert.equal(typeof builder.then, 'function', 'the builder is no longer thenable');
    assert.equal(typeof builder.catch, 'undefined', 'the builder now has catch - see the note above');
    assert.throws(() => builder.catch(() => {}), TypeError);

    // And the shape the fix relies on actually works.
    assert.doesNotThrow(() => builder.then(() => {}, () => {}));
  });

  test('nothing calls .catch on a supabase builder', () => {
    const roots = [
      new URL('../../web/src/', import.meta.url),
      new URL('../src/', import.meta.url),
    ];
    const offenders = [];
    for (const root of roots) {
      for (const file of sources(root)) {
        const src = readSource(file);
        for (const line of src.split('\n')) {
          // `supabase.rpc(...)` / `.from(...)` chains, ending in .catch
          if (/supabase\s*\n?\s*\.\s*(rpc|from)\b/.test(line) && /\.catch\s*\(/.test(line)) {
            offenders.push(`${file.pathname.split('/').slice(-2).join('/')}: ${line.trim().slice(0, 90)}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], 'these treat a thenable as a promise:\n  ' + offenders.join('\n  '));
  });

  test('and the two that did are written the way that works', () => {
    // Named, because a regex that finds nothing is indistinguishable from a
    // regex that is broken. These two must keep the working form.
    const visit = readSource(new URL('../../web/src/components/RecordVisit.jsx', import.meta.url));
    assert.match(visit, /\.then\(\(\) => \{\}, \(\) => \{\}\)/, 'RecordVisit no longer handles its rejection');

    const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));
    assert.match(login, /record_auth_failure[^)]*\}\)\.then\(\(\) => \{\}, \(\) => \{\}\)/);
  });
});

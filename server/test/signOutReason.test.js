import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const raw = (p) => read(p);
const module_ = readSource(new URL('../../web/src/lib/signOutReason.js', import.meta.url));
const auth = readSource(new URL('../../web/src/context/AuthContext.jsx', import.meta.url));
const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));

/**
 * Loading the module directly would need a DOM. These assertions are about the
 * SHAPE of the diagnostic - what it stores, where, and when it fires - and
 * every one of them corresponds to a way this could quietly become a privacy
 * problem or a false alarm rather than an instrument.
 */
describe('the sign-out breadcrumb', () => {
  test('stores an event name and a time, and nothing else', () => {
    // This sits in browser storage on a possibly shared computer. A breadcrumb
    // is fine there; a session record is not.
    for (const forbidden of [
      'access_token',
      'refresh_token',
      'email',
      'user_id',
      'user\\.id',
      'health',
    ]) {
      assert.doesNotMatch(
        module_,
        new RegExp(forbidden),
        `the breadcrumb touches ${forbidden}`
      );
    }
    assert.match(module_, /JSON\.stringify\(\{ reason:[^}]*at:/);
  });

  test('uses sessionStorage, which dies with the tab', () => {
    assert.match(module_, /sessionStorage/);
    assert.doesNotMatch(module_, /localStorage/);
  });

  test('every access is wrapped, because storage throws outright in some browsers', () => {
    // A private window and a browser set to block site data both throw on the
    // accessor itself. A diagnostic that breaks the sign-in page it is
    // diagnosing would be a poor trade.
    const bodies = module_.split('export function').slice(1);
    assert.equal(bodies.length, 3, 'expected exactly read, record and clear');
    for (const body of bodies) {
      assert.match(body, /try \{/, `an exported function does not guard storage`);
      assert.match(body, /catch/, `an exported function does not catch`);
    }
  });

  test('it fires only on a real transition, never on a cold load', () => {
    // Supabase fires INITIAL_SESSION with a null session for anybody who is
    // simply not signed in. Recording that would greet every first-time
    // visitor with a notice that their session had ended.
    assert.match(auth, /hadSession\.current && !next/);
    assert.match(auth, /hadSession\.current = Boolean\(next\)/);
  });

  test('a sign-out the person asked for is not reported as a fault', () => {
    const signOut = auth.slice(auth.indexOf('signOut:'), auth.indexOf('signOut:') + 260);
    assert.match(signOut, /clearSignOutReason\(\)/);
  });

  test('signing in clears it', () => {
    assert.match(auth, /if \(next\) clearSignOutReason\(\)/);
  });

  test('the login page reads it once rather than on every render', () => {
    // Read inline, the notice would disappear the moment anything else on the
    // page changed - which is every keystroke in the email field.
    assert.match(login, /useState\(\(\) => lastSignOut\?\.\(\) \?\? null\)/);
  });

  test('the notice is translated, not hardcoded English', () => {
    assert.match(login, /t\('auth\.sessionEnded'\)/);
    for (const locale of ['en', 'es']) {
      assert.match(
        read(`../../web/src/i18n/locales/${locale}.js`),
        /sessionEnded:/,
        `${locale} has no sessionEnded string`
      );
    }
  });
});

describe('what has actually been established about the sign-outs', () => {
  test('the reasoning is recorded where the next person will find it', () => {
    // The measurement that ruled out a deliberate timeout was made against the
    // live auth tables, and it is the kind of fact that is expensive to
    // re-establish and cheap to write down.
    const prose = raw('../../web/src/lib/signOutReason.js');
    assert.match(prose, /not_after/);
    assert.match(prose, /not a deliberate timeout/i);
  });

  test('no fix has been shipped on the strength of the hypothesis', () => {
    // Twice in this project a layout fault was "fixed" by reasoning about it,
    // and both times the bug did not exist. The bar is a reproduction.
    const client = readSource(new URL('../../web/src/lib/supabase.js', import.meta.url));
    assert.doesNotMatch(
      client,
      /autoRefreshToken|persistSession|storageKey|detectSessionInUrl/,
      'the auth client was retuned without a reproduction to justify it'
    );
  });
});

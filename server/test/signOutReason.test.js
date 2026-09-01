import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGN_OUT_REASONS,
  declareSignOutIntent,
  describeSignOut,
  sessionIsDead,
  takeSignOutIntent,
} from '../../web/src/lib/signOutReason.js';
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

  test('every function that TOUCHES storage wraps it', () => {
    /*
     * A private window and a browser set to block site data both throw on the
     * accessor itself. A diagnostic that breaks the sign-in page it is
     * diagnosing would be a poor trade.
     *
     * This used to assert `bodies.length === 3` - "expected exactly read,
     * record and clear" - and blocked the two pure functions added later,
     * neither of which goes near storage. Counting exports was never the
     * property; guarding the ones that touch it is. Derived from the bodies
     * now, so a new storage-touching function is covered the day it is
     * written and a new pure one is not asked to catch nothing.
     */
    const bodies = module_.split('export function').slice(1);
    assert.ok(bodies.length >= 3, 'the module lost its exports');
    const touching = bodies.filter((body) => /sessionStorage/.test(body));
    assert.ok(touching.length >= 3, 'read, record and clear must all still be here');
    for (const body of touching) {
      const name = body.slice(0, body.indexOf('(')).trim();
      assert.match(body, /try \{/, `${name} does not guard storage`);
      assert.match(body, /catch/, `${name} does not catch`);
    }
  });

  test('it fires only on a real transition, never on a cold load', () => {
    // Supabase fires INITIAL_SESSION with a null session for anybody who is
    // simply not signed in. Recording that would greet every first-time
    // visitor with a notice that their session had ended.
    assert.match(auth, /hadSession\.current && !next/);
    assert.match(auth, /hadSession\.current = Boolean\(next\)/);
  });

  test('A SIGN-OUT THE PERSON ASKED FOR IS NOT REPORTED AS A FAULT', () => {
    /*
     * Reported on 2026-08-31: signing out of the iPhone app and back in showed
     * "we are not sure why (SIGNED_OUT)". Every deliberate sign-out did.
     *
     * The old assertion passed the whole time. It checked that signOut()
     * calls clearSignOutReason(), which it did - and then supabase.auth
     * .signOut() fired SIGNED_OUT, the listener saw a session become null, and
     * it wrote the breadcrumb straight back a few milliseconds later. Both
     * halves were correct and the ORDER was wrong, which no assertion about
     * one half could see.
     *
     * So the property is asserted end to end now: the intent is declared
     * before the call, and the listener consults it instead of the event.
     */
    const signOut = auth.slice(auth.indexOf('signOut:'), auth.indexOf('signOut:') + 700);
    assert.match(signOut, /declareSignOutIntent\(SIGN_OUT_REASONS\.deliberate\)/);
    assert.match(auth, /takeSignOutIntent\(\)/, 'the listener still guesses from the event');
    assert.match(
      auth,
      /declared === SIGN_OUT_REASONS\.deliberate\) clearSignOutReason\(\)/,
      'a declared deliberate sign-out must leave no notice'
    );
  });

  test('the declared reason survives the event that follows it', () => {
    // The trap is that supabase.auth.signOut() fires SIGNED_OUT and the
    // listener runs LAST. A specific diagnosis written before the call would
    // be replaced by the generic event name; a declaration is not.
    declareSignOutIntent(SIGN_OUT_REASONS.serverRejected);
    assert.equal(takeSignOutIntent(), SIGN_OUT_REASONS.serverRejected);
  });

  test('reading it clears it, so a later unrelated sign-out is not mislabeled', () => {
    // A refresh token genuinely expiring an hour afterwards must not be
    // reported as the thing that was declared this morning.
    declareSignOutIntent(SIGN_OUT_REASONS.deliberate);
    assert.equal(takeSignOutIntent(), SIGN_OUT_REASONS.deliberate);
    assert.equal(takeSignOutIntent(), null, 'the declaration outlived its transition');
  });

  test('the fetch wrapper declares rather than writes, for the same reason', () => {
    const api = read('../../web/src/lib/api.js');
    assert.match(api, /declareSignOutIntent\(SIGN_OUT_REASONS\.serverRejected\)/);
    assert.doesNotMatch(api, /recordSignOut\(/, 'writing it here loses to the listener');
  });

  test('signing in clears it', () => {
    assert.match(auth, /if \(next\) clearSignOutReason\(\)/);
  });

  test('the login page reads it once rather than on every render', () => {
    // Read inline, the notice would disappear the moment anything else on the
    // page changed - which is every keystroke in the email field.
    assert.match(login, /useState\(\(\) => lastSignOut\?\.\(\) \?\? null\)/);
  });

  test('the notice is translated, and every reason has a sentence in both locales', () => {
    /*
     * This used to pin `t('auth.sessionEnded')`, the one key that existed when
     * the notice was a single message. It now depends on why the session
     * ended, so the assertion is derived: ask describeSignOut what keys it can
     * produce, and require every one of them to exist in every locale.
     *
     * A new reason added without a translation fails here rather than
     * rendering its own key at somebody.
     */
    assert.match(login, /t\(describeSignOut\(/, 'the notice must go through i18n');

    const reasons = [
      SIGN_OUT_REASONS.serverRejected,
      'SIGNED_OUT',
      'TOKEN_REFRESHED',
      'something nobody has seen yet',
      undefined,
    ];
    const keys = [...new Set(reasons.map((reason) => describeSignOut(reason)))];
    assert.ok(keys.length >= 2, 'describeSignOut collapsed every reason into one message');

    for (const locale of ['en', 'es']) {
      const catalogue = read(`../../web/src/i18n/locales/${locale}.js`);
      for (const key of keys) {
        const leaf = key.split('.').pop();
        assert.match(catalogue, new RegExp(`${leaf}:`), `${locale} has no ${key} string`);
      }
    }
  });

  test('the raw event name is not shown to a person, and is still readable by a developer', () => {
    // "You were signed out and we are not sure why (SIGNED_OUT)" was correct
    // while this was an instrument. It reads as the operator being confused,
    // which is not a thing to put in front of somebody who wants to log a
    // squat. The code moves to an attribute rather than being thrown away.
    assert.doesNotMatch(login, /\(\{endedSession\.reason\}\)/, 'the code is still on screen');
    assert.match(login, /data-reason=\{endedSession\.reason\}/, 'the code was discarded entirely');
  });

  test('a rejected session is distinguished from an unfinished one', () => {
    // Both are 401. Signing out on mfa_required would throw away a correct
    // login and send somebody back to a password field they had just used.
    assert.equal(sessionIsDead({ status: 401, code: 'auth_required' }), true);
    assert.equal(sessionIsDead({ status: 401, code: 'mfa_required' }), false);
    assert.equal(sessionIsDead({ status: 403, code: 'auth_required' }), false);
    assert.equal(sessionIsDead({ status: 500, code: 'coach_refused' }), false);
    for (const bad of [undefined, null, {}, { status: 401 }]) {
      assert.equal(sessionIsDead(bad), false, `${JSON.stringify(bad)} was read as a dead session`);
    }
  });

  test('and the API actually acts on it, rather than only being able to', () => {
    // The decision is pure and testable; the acting on it is in api.js, and a
    // decision nothing calls is a comment.
    const api = read('../../web/src/lib/api.js');
    assert.match(api, /sessionIsDead\(/, 'nothing consults the decision');
    assert.match(api, /signOut\(\{ scope: 'local' \}\)/, 'a dead session is not dropped');
    assert.match(api, /endingSession/, 'a burst of 401s would produce a burst of sign-outs');
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

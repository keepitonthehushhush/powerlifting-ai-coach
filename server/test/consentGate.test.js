import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { evaluateConsentGate } from '../../web/src/lib/consentGate.js';
import { REQUIRED_CONSENTS } from '../src/lib/policyVersions.js';

/**
 * The gate that decides whether a person has agreed to enough to use the
 * product. Tested exhaustively rather than by clicking, because "consent
 * obtained before collection" is a legal requirement and the redirect that
 * implements it is one line of routing that anyone could remove.
 */

const granted = { granted: true, stale: false };
const stale = { granted: true, stale: true };
const withheld = { granted: false, stale: false };

const state = (consents, required = ['terms_of_service', 'ai_processing']) => ({ consents, required });

describe('evaluateConsentGate', () => {
  test('allows through when every required consent is granted and current', () => {
    const result = evaluateConsentGate(state({ terms_of_service: granted, ai_processing: granted }));
    assert.equal(result.allowed, true);
    assert.deepEqual(result.missing, []);
  });

  test('blocks when a required consent was never given', () => {
    const result = evaluateConsentGate(state({ terms_of_service: granted, ai_processing: withheld }));
    assert.equal(result.allowed, false);
    assert.deepEqual(result.missing, ['ai_processing']);
    assert.equal(result.reason, 'withheld');
  });

  test('blocks when a required consent is stale — agreement to text since changed', () => {
    const result = evaluateConsentGate(state({ terms_of_service: stale, ai_processing: granted }));
    assert.equal(result.allowed, false);
    assert.deepEqual(result.missing, ['terms_of_service']);
    assert.equal(result.reason, 'stale');
  });

  test('does NOT gate on health data consent, which must stay freely given', () => {
    // Health data withheld, everything required granted: the coach still works.
    // Gating an unrelated feature on it would make the consent coerced, which
    // MHMDA does not accept.
    const result = evaluateConsentGate(
      state({ terms_of_service: granted, ai_processing: granted, health_data_collection: withheld })
    );
    assert.equal(result.allowed, true);
  });

  describe('fails closed', () => {
    for (const [label, value] of [
      ['null state (not loaded)', null],
      ['undefined state', undefined],
      ['no consents object', { required: ['terms_of_service'] }],
      ['no required list', { consents: { terms_of_service: granted } }],
      ['consents is not an object', { consents: 'yes', required: ['terms_of_service'] }],
      ['empty object', {}],
    ]) {
      test(label, () => {
        const result = evaluateConsentGate(value);
        assert.equal(result.allowed, false, 'an unreadable consent state must never admit anyone');
        assert.equal(result.reason, 'unknown');
      });
    }
  });

  test('an empty required list is a decision, not an absence', () => {
    // The server saying "nothing is required" is different from the server not
    // answering. Only the latter fails closed.
    assert.equal(evaluateConsentGate({ consents: {}, required: [] }).allowed, true);
  });

  test('a missing record is treated as withheld, not as granted', () => {
    const result = evaluateConsentGate(state({ terms_of_service: granted }));
    assert.deepEqual(result.missing, ['ai_processing']);
  });
});

describe('the gate matches what the server requires', () => {
  test('every consent the server calls required is one this gate can enforce', () => {
    const consents = Object.fromEntries(REQUIRED_CONSENTS.map((type) => [type, withheld]));
    const result = evaluateConsentGate({ consents, required: [...REQUIRED_CONSENTS] });
    assert.equal(result.allowed, false);
    assert.deepEqual(result.missing.sort(), [...REQUIRED_CONSENTS].sort());
  });

  test('health_data_collection is not on the server-required list either', () => {
    assert.ok(
      !REQUIRED_CONSENTS.includes('health_data_collection'),
      'making health data mandatory would be both bad practice and legally weaker'
    );
  });
});

describe('the gate is actually wired up', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

  test('ProtectedRoute requires consent by default', () => {
    const source = read('../../web/src/components/ProtectedRoute.jsx');
    assert.match(source, /requireConsent\s*=\s*true/, 'consent must be the default, so a new route inherits it');
    assert.match(source, /Navigate to="\/consent"|to="\/consent"/);
  });

  test('the routes that must stay reachable without consent opt out explicitly', () => {
    const app = read('../../web/src/App.jsx');
    for (const path of ['/consent', '/account']) {
      const at = app.indexOf(`path="${path}"`);
      assert.ok(at > -1, `${path} route is missing`);
      const routeBlock = app.slice(at, at + 220);
      assert.match(
        routeBlock,
        /requireConsent=\{false\}/,
        `${path} must not be gated: it is how a person withdraws consent or deletes their account`
      );
    }
  });

  // --- the remount regression ---------------------------------------------
  //
  // The consent gate, as first written, destroyed the intake form. Supabase
  // refreshes its access token when a tab regains focus and fires
  // onAuthStateChange; AuthProvider stored the new session object; that changed
  // context identity; ConsentProvider refetched; ProtectedRoute rendered its
  // loading state while the fetch was in flight - which UNMOUNTED the page
  // below it. Switch to another app mid-intake, come back, every field blank.
  //
  // Asserted at the source level for the same reason as the wiring tests
  // above: there is no DOM harness here, and these three properties are each
  // one careless edit from being reverted.

  test('a token refresh is not treated as a change of user', () => {
    const auth = read('../../web/src/context/AuthContext.jsx');
    assert.match(
      auth,
      /prev\?\.user\?\.id === next\?\.user\?\.id/,
      'onAuthStateChange must compare identity, not store every refreshed session'
    );
    assert.match(auth, /return prev/, 'the previous session object must be kept when the user is unchanged');
  });

  test('consent is refetched per user, not per session object', () => {
    const consent = read('../../web/src/context/ConsentContext.jsx');
    assert.match(
      consent,
      /\[userId, load\]/,
      'keying the effect on the session object refetches on every token refresh'
    );
  });

  test('a revalidation does not unmount the page underneath it', () => {
    const consent = read('../../web/src/context/ConsentContext.jsx');
    const route = read('../../web/src/components/ProtectedRoute.jsx');
    assert.match(consent, /'refreshing'/, 'a refetch must be distinguishable from a first load');
    // The loading branch must not fire for a refresh.
    const loadingBranch = route.slice(route.indexOf("status === 'idle'"), route.indexOf("gate.allowed"));
    assert.ok(
      !/refreshing/.test(loadingBranch),
      'ProtectedRoute must not show its loading state while revalidating'
    );
    assert.match(
      route,
      /status !== 'refreshing'/,
      'a revalidation in flight must not redirect a user who is already through the gate'
    );
  });

  test('the coach and intake routes are gated', () => {
    const app = read('../../web/src/App.jsx');
    for (const path of ['/coach', '/intake']) {
      const at = app.indexOf(`path="${path}"`);
      const routeBlock = app.slice(at, at + 220);
      assert.ok(!/requireConsent=\{false\}/.test(routeBlock), `${path} must stay behind the consent gate`);
    }
  });
});

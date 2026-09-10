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

  /*
   * ── COULD NOT READ IS NOT DID NOT AGREE ────────────────────────────────
   *
   * The gate fails closed on an unreadable state, which is right. What was
   * wrong was where that landed somebody: /consent, headed "before we start",
   * whose panel reloads the endpoint that just failed and whose Continue
   * button stays disabled until it succeeds. An athlete who had already
   * agreed hit that on 2026-09-02 after a 502 on GET /api/consent, and has
   * not been back.
   *
   * ORDER IS THE PROPERTY HERE, which is the narrow case where asserting
   * source position is correct: the error branch is only reachable if it sits
   * ABOVE the redirect, and a refactor that moves it below restores the bug
   * while every behavioral assertion still passes.
   */
  test('an unreadable consent state renders a retry, and does so before the redirect', () => {
    const source = read('../../web/src/components/ProtectedRoute.jsx');

    const errorBranch = source.indexOf("status === 'error'");
    const redirect = source.indexOf('to="/consent"');
    assert.ok(errorBranch > -1, 'a failed consent READ must be handled, not folded into "not granted"');
    assert.ok(redirect > -1, 'the consent redirect has gone');
    assert.ok(
      errorBranch < redirect,
      'the error branch must come before the redirect or it is unreachable and the dead end is back'
    );

    assert.match(source, /ConsentUnavailable/, 'the error case must render something, not navigate');
    assert.match(source, /onRetry=\{refresh\}/, 'the retry has to actually re-read, or it is a button that lies');
  });

  test('the retry screen still admits nobody', () => {
    // Fails closed is not the bug and must not become one. The unreadable
    // state is still `allowed: false`; this only changes what is SHOWN.
    assert.deepEqual(evaluateConsentGate(null), { allowed: false, missing: [], reason: 'unknown' });
    assert.deepEqual(evaluateConsentGate(undefined), { allowed: false, missing: [], reason: 'unknown' });

    const screen = read('../../web/src/components/ConsentUnavailable.jsx');
    assert.doesNotMatch(screen, /Navigate|useNavigate/, 'it must not route anywhere - it replaces the children');
    // The RENDER form, not the word - `/children/` matched the prose in this
    // component's own comment explaining that it stands in front of them.
    // Same readSource/readRaw trap this repo keeps re-learning.
    assert.doesNotMatch(screen, /\{\s*children\s*\}/, 'it must not render what it is standing in front of');
  });

  test('the retry screen says whose fault it is and that nothing was lost', () => {
    // The redirect said neither, to somebody who had done everything asked.
    for (const locale of ['en', 'es']) {
      const copy = read(`../../web/src/i18n/locales/${locale}.js`);
      const at = copy.indexOf('unavailable: {');
      assert.ok(at > -1, `${locale} has no copy for an unreadable consent state`);
      const block = copy.slice(at, at + 700);
      for (const key of ['title:', 'body:', 'reassurance:', 'retry:']) {
        assert.ok(block.includes(key), `${locale} consent.unavailable is missing ${key}`);
      }
    }
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
    /*
     * This asserted the literal dependency array `[userId, load]`, which made
     * it fail the moment a legitimate dependency was added - and the property
     * it exists to protect has nothing to do with the array's length. What
     * matters is that `session` is NOT in it: keying on the session object
     * refetches on every token refresh, which Supabase does on tab focus.
     */
    const consent = read('../../web/src/context/ConsentContext.jsx');
    const deps = consent.match(/\}, \[([^\]]*)\]\);/g) ?? [];
    assert.ok(deps.length, 'no effect dependencies found - this test is measuring nothing');
    const loadEffect = deps.find((d) => d.includes('load'));
    assert.ok(loadEffect, 'the consent load effect has no dependency array');
    assert.match(loadEffect, /userId/, 'the load must re-run when the person changes');
    assert.doesNotMatch(
      loadEffect,
      /\bsession\b/,
      'keying the effect on the session object refetches on every token refresh'
    );
  });

  test('and it waits for the second factor before asking', () => {
    /*
     * /api/consent needs aal2 from an account that has MFA on it. Asking
     * during the challenge returns 401 mfa_required, and this context turned
     * that into status 'error', which ProtectedRoute renders as "We could not
     * load your privacy choices - that is a problem on our end". Every
     * MFA-enabled sign-in hit it. Nothing was wrong; the person had not
     * finished signing in.
     */
    const consent = read('../../web/src/context/ConsentContext.jsx');
    assert.match(consent, /useMfa/, 'the consent load cannot tell whether sign-in finished');
    assert.match(consent, /if \(!userId \|\| !mfaChecked \|\| !mfaSatisfied\)/);
    // And if one slips through anyway, it is not an error.
    assert.match(consent, /err\?\.code === 'mfa_required' \? 'idle' : 'error'/);

    // The provider has to be able to SEE the MFA context to do any of that.
    const app = read('../../web/src/App.jsx');
    assert.ok(
      app.indexOf('<MfaProvider>') < app.indexOf('<ConsentProvider>'),
      'ConsentProvider is outside MfaProvider, so useMfa() cannot work there'
    );
    assert.ok(
      app.indexOf('<MfaProvider>') < app.indexOf('<ThemeProvider>'),
      'ThemeProvider is outside MfaProvider, so it cannot wait for the second factor either'
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

describe('one dropped request is not a wall', () => {
  /*
   * Read here rather than borrowing the `read` helper declared inside the
   * describe above it. Referencing an out-of-scope binding threw while the
   * describe body ran, so these three tests never executed - and node reported
   * "24 pass, 0 fail" with a `not ok` on the suite line that a summary-only
   * grep does not show. Three planted mutants survived, which is how it was
   * found: the mutants were more honest than the test run.
   */
  const consent = readFileSync(new URL('../../web/src/context/ConsentContext.jsx', import.meta.url), 'utf8');

  test('a transient failure is retried before the dead end is shown', () => {
    /*
     * An athlete signed up on 2026-09-02, completed the whole intake, and the
     * only thing in their error log is `storage_unavailable` on /api/consent.
     * They sent no messages and never came back. ProtectedRoute already
     * carries that date in a comment, because an earlier fix stopped this dead
     * end being reached by a REDIRECT - and did not stop it being reached by
     * one bad request, which is what happened to them.
     *
     * "That is a problem on our end" over a Try again button is honest, and it
     * is also the last screen in the product for somebody with no reason yet
     * to persist.
     */
    assert.match(consent, /withRetries\(\(\) => api\.getConsents\(\)\)/);
    assert.match(consent, /RETRY_DELAYS_MS = \[400, 1200\]/);
  });

  test('and a refusal is not retried, because asking again cannot change it', () => {
    /*
     * The gate still fails closed and an unreadable state is still "not
     * granted". Only failures that look transient are tried again: no status
     * at all, which is a dropped connection, or a 5xx, which is us. Retrying a
     * 4xx would be a loop rather than a recovery - and 401 has its own path.
     */
    assert.match(consent, /if \(status >= 400 && status < 500\) return false;/);
    assert.match(consent, /if \(status == null\) return true;/);
    const guard = consent.slice(consent.indexOf('async function withRetries'));
    assert.match(guard, /!isTransient\(err\)\) throw err;/);
  });

  test('the retries are bounded', () => {
    // An unbounded retry on a page that gates the whole product is an outage
    // that looks like a spinner.
    const guard = consent.slice(consent.indexOf('async function withRetries'));
    assert.match(guard, /i >= RETRY_DELAYS_MS\.length/);
  });
});

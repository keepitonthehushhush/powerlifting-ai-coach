import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, readRaw, phrase, latestDefinition } from './helpers/source.js';
import {
  AUTH_ERROR_CODES, RECORDED_AUTH_CODES, classifyAuthError, shouldRecord,
} from '../../web/src/lib/authErrors.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';

/**
 * The 2026-08-29 sign-up outage.
 *
 * A real person could not create an account. Production auth logs:
 *
 *   POST /signup  400  captcha_failed
 *     "captcha protection: request disallowed (no captcha_token found)"
 *   POST /token   400  captcha_failed   (x3, two addresses)
 *
 * CAPTCHA had been switched on in the Supabase dashboard while the deployed
 * bundle carried no VITE_TURNSTILE_SITE_KEY, so no token was ever sent.
 *
 * Two separate failures, and the tests below are split along that line, because
 * only one of them is fixable in code:
 *
 *   THE OUTAGE     configuration; fixed by the operator, and now detected by
 *                  scripts/verify-deployment.mjs before anybody notices.
 *   THE SILENCE    ours; the person was shown the provider's own sentence,
 *                  which named a token they had never heard of and offered no
 *                  action, and nothing was recorded anywhere we look.
 */

const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));
const verifier = readRaw(new URL('../../scripts/verify-deployment.mjs', import.meta.url));
const migration = readRaw(
  new URL('../../supabase/migrations/0043_auth_failures_are_recordable.sql', import.meta.url)
);

/** The exact error the production logs recorded, as an object. */
const PRODUCTION_ERROR = {
  code: 'captcha_failed',
  status: 400,
  message: 'captcha protection: request disallowed (no captcha_token found)',
};

test('the error that broke sign-up', async (t) => {
  await t.test('is OUR misconfiguration when the build carried no site key', () => {
    /**
     * The distinction the whole module exists for. Same provider error, three
     * meanings, and only the client knows which - so a single message for all
     * three is a message nobody can act on.
     */
    const code = classifyAuthError(PRODUCTION_ERROR, { captchaConfigured: false });
    assert.equal(code, AUTH_ERROR_CODES.captcha_misconfigured);
  });

  await t.test('is THEIR network when the widget was blocked', () => {
    const code = classifyAuthError(PRODUCTION_ERROR, { captchaConfigured: true, captchaBlocked: true });
    assert.equal(code, AUTH_ERROR_CODES.captcha_unavailable);
  });

  await t.test('and is an expired token when the client had one to send', () => {
    const code = classifyAuthError(PRODUCTION_ERROR, { captchaConfigured: true, captchaBlocked: false });
    assert.equal(code, AUTH_ERROR_CODES.captcha_rejected);
  });

  await t.test('all three are recorded, because all three mean something is wrong', () => {
    for (const code of [
      AUTH_ERROR_CODES.captcha_misconfigured,
      AUTH_ERROR_CODES.captcha_unavailable,
      AUTH_ERROR_CODES.captcha_rejected,
    ]) assert.ok(shouldRecord(code), `${code} is not recorded`);
  });

  await t.test('but a mistyped password is not', () => {
    // The commonest event in any auth system. Recording it would bury the four
    // rows that mattered under thousands that did not.
    const code = classifyAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' });
    assert.equal(code, AUTH_ERROR_CODES.invalid_credentials);
    assert.ok(!shouldRecord(code));
  });
});

test('the provider is never quoted to the person', async (t) => {
  await t.test('Login.jsx does not render error.message', () => {
    /**
     * The line that showed a stranger "captcha protection: request disallowed
     * (no captcha_token found)". Asserted as an ABSENCE, over comment-stripped
     * source, because the explanation of why it is gone contains the phrase.
     */
    assert.ok(
      !/text:\s*error\.message/.test(login),
      'Login.jsx is showing the provider error verbatim again'
    );
    assert.match(login, /classifyAuthError\(error/);
    assert.match(login, /authErrorMessageKey\(code\)/);
  });

  await t.test('every code has a sentence in both languages', () => {
    // A code with no message renders as its own key, which is worse than the
    // provider's sentence: at least that one was English.
    for (const code of Object.values(AUTH_ERROR_CODES)) {
      for (const [lang, cat] of [['en', en], ['es', es]]) {
        const copy = cat?.auth?.errors?.[code];
        assert.ok(typeof copy === 'string' && copy.length > 20, `${lang} has no message for ${code}`);
      }
    }
  });

  await t.test('and the one that is our fault apologizes rather than instructing', () => {
    // No action by the reader can fix a build/dashboard disagreement, so a
    // message telling them to do something would be a lie.
    const copy = en.auth.errors.captcha_misconfigured;
    assert.match(copy, /our end|on our/i);
    assert.ok(!/check your|make sure you/i.test(copy), 'it blames the reader for our misconfiguration');
  });
});

test('the failure is written somewhere we look', async (t) => {
  await t.test('through a function anon can call, because a failed sign-up has no user', () => {
    const fn = latestDefinition('function public.record_auth_failure').body;
    assert.match(migration, /grant execute on function public\.record_auth_failure\(text\) to anon, authenticated/);
    assert.match(fn, /recordable_auth_codes/);
  });

  await t.test('which takes a code and nothing else', () => {
    /**
     * The property that makes an unauthenticated write acceptable. There is no
     * argument here that could carry an email, an address, or a message - not
     * because the caller is trusted, but because there is nowhere to put one.
     */
    const signature = migration.slice(
      migration.indexOf('create or replace function public.record_auth_failure'),
      migration.indexOf('returns boolean')
    );
    assert.match(signature, /\(p_code text\)/);
    for (const forbidden of ['email', 'address', 'message', 'detail', 'ip']) {
      assert.ok(!signature.includes(forbidden), `record_auth_failure takes a ${forbidden}`);
    }
  });

  await t.test('and is flood-capped, because there is no user to rate limit', () => {
    const fn = latestDefinition('function public.record_auth_failure').body;
    assert.match(fn, /ceiling/);
    assert.match(fn, /interval '1 minute'/);
  });

  await t.test('the SQL vocabulary and the JavaScript one are the same list', () => {
    // Two lists that must agree are one list plus a bug.
    const declared = latestDefinition('function private.recordable_auth_codes').body;
    const inSql = [...declared.matchAll(/'([a-z_]{3,40})'/g)].map(([, c]) => c).sort();
    assert.deepEqual(inSql, [...RECORDED_AUTH_CODES].sort(), 'authErrors.js and 0043 disagree');
  });

  await t.test('and every code fits the column the row lands in', () => {
    // error_events.code is CHECKed for shape. A code that failed it would raise
    // inside a catch block on the page somebody is already stuck on.
    for (const code of RECORDED_AUTH_CODES) {
      assert.match(code, /^[a-z][a-z_]{2,39}$/, `${code} would be rejected by error_events`);
    }
  });
});

test('the deployment check that would have caught it', async (t) => {
  await t.test('probes the real interaction rather than the bundle alone', () => {
    /**
     * Checking that a site key is present would NOT have caught this: the key
     * is optional by design and a build without one is correct whenever CAPTCHA
     * is off. What is never correct is the two halves disagreeing, so the probe
     * asks the server whether it wants a token the client cannot produce.
     */
    assert.match(verifier, /auth\/v1\/token\?grant_type=password/);
    assert.match(verifier, phrase('NOBODY CAN CREATE AN ACCOUNT'));
  });

  await t.test('signs IN rather than signing up, so it creates nothing', () => {
    // A check with a side effect is a check somebody eventually disables.
    assert.ok(!/auth\/v1\/signup/.test(verifier), 'the probe would create real accounts');
  });

  await t.test('and refuses to answer when it did not reach Supabase', () => {
    /**
     * The false pass this nearly shipped with. The first version tested the raw
     * body for /captcha/i, and a sandbox proxy answered "Host not in allowlist"
     * - no "captcha" in it - so the probe reported captcha was not required and
     * printed a PASS while never having spoken to Supabase at all.
     */
    assert.match(verifier, /isAuthResponse/);
    assert.match(verifier, phrase('The sign-up check did NOT run'));
    assert.ok(
      !/serverWantsCaptcha = \/captcha\/i\.test\(body\)/.test(verifier),
      'the probe is back to testing the raw body, which any proxy can fake'
    );
  });
});

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';
import {
  sha1Hex,
  splitHash,
  parseRanges,
  checkPwned,
  VERY_COMMON_THRESHOLD,
} from '../../web/src/lib/pwnedPassword.js';

const source = readSource(new URL('../../web/src/lib/pwnedPassword.js', import.meta.url));

/** The canonical example: SHA-1("password") = 5BAA6...  */
const PASSWORD_SHA1 = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';

describe('the privacy guarantee', () => {
  test('SHA-1 matches the published vector, so the corpus lookups line up', async () => {
    assert.equal(await sha1Hex('password'), PASSWORD_SHA1);
  });

  test('exactly five characters are separated out to be sent', () => {
    const { prefix, suffix } = splitHash(PASSWORD_SHA1);
    assert.equal(prefix, '5BAA6');
    assert.equal(prefix.length, 5);
    assert.equal(prefix + suffix, PASSWORD_SHA1);
  });

  test('THE REQUEST CARRIES THE PREFIX AND NOTHING ELSE', async () => {
    // This is the whole privacy claim and it is the one thing that must never
    // silently regress. If a future edit sends the full hash - or, worse, the
    // password - this test is what catches it.
    let seenUrl = null;
    let seenInit = null;
    const fake = async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return { ok: true, text: async () => '' };
    };

    await checkPwned('password', fake);

    // Exact equality rather than a "does not contain the password" regex.
    // The first draft of this test asserted doesNotMatch(/password/i) and
    // failed - on the HOSTNAME, api.pwnedPASSWORDs.com. An absence assertion
    // matching something incidental is the same trap that made
    // helpers/source.js necessary, and the fix is the same: assert the exact
    // thing you mean instead of the absence of a substring.
    assert.equal(seenUrl, 'https://api.pwnedpasswords.com/range/5BAA6');
    assert.doesNotMatch(seenUrl, new RegExp(splitHash(PASSWORD_SHA1).suffix, 'i'), 'the hash suffix left the browser');
    assert.equal(JSON.stringify(seenInit ?? {}).includes('password'), false);
    // No cookie may ride along; it would re-identify the request and undo the
    // k-anonymity entirely.
    assert.equal(seenInit.credentials, 'omit');
    assert.equal(seenInit.headers['Add-Padding'], 'true');
  });

  test('the module never reaches for anything but the range endpoint', () => {
    const urls = [...source.matchAll(/https?:\/\/[^\s'"`]+/g)].map((m) => m[0]);
    assert.deepEqual(urls, ['https://api.pwnedpasswords.com/range/']);
  });
});

describe('parseRanges', () => {
  test('reads suffix and count pairs', () => {
    const counts = parseRanges('ABCDE:5\r\nFGHIJ:12\n');
    assert.equal(counts.get('ABCDE'), 5);
    assert.equal(counts.get('FGHIJ'), 12);
  });

  test('drops the zero-count padding rows rather than counting them as hits', () => {
    // Add-Padding pads the response with count-0 entries. Treating one as a
    // match would tell an innocent person their password was breached.
    const counts = parseRanges('AAAAA:0\nBBBBB:3\n');
    assert.equal(counts.has('AAAAA'), false);
    assert.equal(counts.get('BBBBB'), 3);
  });

  test('survives blank lines and junk without throwing', () => {
    const counts = parseRanges('\n\nnotavalidline\nCCCCC:not-a-number\nDDDDD:7\n');
    assert.equal(counts.size, 1);
    assert.equal(counts.get('DDDDD'), 7);
  });
});

describe('checkPwned', () => {
  const respond = (body) => async () => ({ ok: true, text: async () => body });

  test('reports a breached password with how many times it was seen', async () => {
    const { suffix } = splitHash(PASSWORD_SHA1);
    const result = await checkPwned('password', respond(`${suffix}:12345\nZZZZZ:1\n`));
    assert.equal(result.status, 'breached');
    assert.equal(result.count, 12345);
    assert.ok(result.count > VERY_COMMON_THRESHOLD);
  });

  test('reports safe when the suffix is absent from the bucket', async () => {
    const result = await checkPwned('password', respond('ZZZZZ:1\n'));
    assert.equal(result.status, 'safe');
    assert.equal(result.count, 0);
  });

  test('FAILS OPEN when the service is unreachable, and says unknown not safe', async () => {
    // A third party being down must never stop somebody creating an account.
    // But unknown has to stay distinguishable from safe, or the interface ends
    // up quietly implying a pass it never got.
    const thrown = await checkPwned('password', async () => {
      throw new Error('network down');
    });
    assert.equal(thrown.status, 'unknown');

    const errored = await checkPwned('password', async () => ({ ok: false, status: 503 }));
    assert.equal(errored.status, 'unknown');
  });

  test('an empty password is unknown rather than an unnecessary request', async () => {
    let called = false;
    await checkPwned('', async () => {
      called = true;
      return { ok: true, text: async () => '' };
    });
    assert.equal(called, false);
  });
});

describe('why this is here rather than switched on in a dashboard', () => {
  test('the file records that it stands in for a paid feature', () => {
    // Whoever upgrades the plan later needs to know this exists, or the
    // product ends up checking twice and nobody remembers why.
    const raw = readSource(new URL('../../web/src/lib/pwnedPassword.js', import.meta.url));
    assert.ok(raw.length > 0);
  });

  test('it is documented as advisory, not enforcement', () => {
    // readRaw, not readSource: this asserts something ABOUT the comments, so
    // stripping them is exactly wrong. The helper's own note calls out this
    // asymmetry and the first draft of this test ignored it.
    assert.match(readRaw(new URL('../../web/src/lib/pwnedPassword.js', import.meta.url)), /ADVISORY/);
  });
});

describe('the reset path is held to the same rules as sign-up', () => {
  const reset = readRaw(new URL('../../web/src/pages/ResetPassword.jsx', import.meta.url));
  const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));
  const app = readSource(new URL('../../web/src/App.jsx', import.meta.url));

  test('a reset cannot set a weak or breached password', () => {
    // Otherwise the reset flow is a way around the sign-up policy - and the
    // more attractive way around, because it is the one an attacker reaches
    // through a mailbox they have already compromised.
    assert.match(reset, /checkPassword/);
    assert.match(reset, /checkPwned/);
    assert.match(reset, /disabled=\{busy \|\| !policy\.ok \|\| breach\.status === 'breached'\}/);
  });

  test('THE REQUEST FORM CANNOT BE USED TO DISCOVER WHO HAS AN ACCOUNT', () => {
    // A reset form that says "sent" for real addresses and something else for
    // the rest is an enumeration oracle. On a product whose users have
    // recorded injuries and drinking habits, merely being on the list is the
    // sensitive fact.
    //
    // The error path is the half that is easy to leak: Supabase rate-limits
    // this endpoint, and surfacing its error verbatim would answer differently
    // for a registered address than for one that was never used. So the result
    // is deliberately not branched on at all.
    const handler = login.slice(login.indexOf('async function handleReset'));
    const body = handler.slice(0, handler.indexOf('async function handleSubmit'));
    // Asserted as BEHAVIOR, not as the literal call. This used to pin
    // `await resetPassword(email);` exactly, and adding a captcha token as a
    // second argument - a change that does not touch enumeration at all -
    // failed it. A test that pins the call text stops the code changing rather
    // than protecting the property; the property is "the result is never
    // looked at".
    assert.match(body, /await resetPassword\(/);
    assert.doesNotMatch(body, /(const|let)\s*\{[^}]*\}\s*=\s*await resetPassword/,
      'the reset request destructures the result, which is the first step to leaking it');
    assert.doesNotMatch(body, /if \(error/, 'the reset request branches on the result');
    assert.doesNotMatch(body, /error\.message/, 'a provider error reaches the screen');
    assert.match(body, /t\('auth\.reset\.sent'\)/);
  });

  test('the same sentence is shown whatever happened', () => {
    const en = readRaw(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
    assert.match(en, /If an account exists for that address/);
  });

  test('the reset page is reachable without a session, like the policy pages', () => {
    // Somebody arriving from the email has no session when the router first
    // runs. Sending them to /login would discard the token in the URL, and
    // would be circular - /login is what they cannot get through.
    const route = app.slice(app.indexOf('path="/reset-password"'));
    assert.doesNotMatch(route.slice(0, 120), /ProtectedRoute/);
  });

  test('it never asks for the old password', () => {
    // They are here because they do not have it.
    assert.doesNotMatch(reset, /currentPassword|oldPassword|current-password/);
  });

  test('the way out is offered before somebody has to fail', () => {
    // Asserted against the KEYS the login page renders, not against the
    // English behind them. The first version of this matched a string in the
    // catalog - `forgot: 'Forgot your password?'` - which turned out to be a
    // string nothing displayed: the page shows auth.forgotPrompt above a
    // button labeled auth.reset.forgotAction. So the test passed while
    // pinning a dead string, and then failed when the dead string was removed.
    // i18n.test.js now guarantees every literal t() key resolves to a real
    // string, which makes the key the stronger thing to assert on: this
    // survives a reword and still fails if the affordance disappears.
    assert.match(login, /setMode\('reset'\)/);
    assert.match(login, /t\('auth\.forgotPrompt'\)/);
    assert.match(login, /t\('auth\.reset\.forgotAction'\)/);
  });
});

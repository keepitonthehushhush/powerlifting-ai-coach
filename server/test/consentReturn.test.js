import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';
import { afterConsent, continueLabelKey, DEFAULT_AFTER_CONSENT } from '../../web/src/lib/afterConsent.js';

/**
 * RE-CONSENTING MUST NOT LOOK LIKE STARTING OVER.
 *
 * ── THE BUG, AND HOW THE DATABASE SHOWED IT ────────────────────────────────
 *
 * A consent is recorded against a policy VERSION, so changing a policy
 * supersedes every stored agreement to the old wording. That is the mechanism
 * working correctly, and on 2026-09-09 the AI-processing policy changed with
 * the nutrition-detail setting - which made the `ai_processing` consent of
 * every account that existed superseded at once.
 *
 * What happened next was not the mechanism working. ProtectedRoute redirected
 * to /consent without recording where the person had been going, and /consent
 * navigated to '/intake' afterwards, hardcoded. So an athlete who opened the
 * app to talk to their coach, was stopped by a screen they did not expect, and
 * agreed - was handed the intake form they completed weeks earlier, under a
 * button that said "Continue to intake".
 *
 * There is no way to read that except "it lost my account".
 *
 * Six of the seven accounts in production were holding a superseded
 * ai_processing consent when this was found. One of them had signed in nine
 * days after their last visit, never reached their profile or their coach, and
 * left.
 */

const route = readSource(new URL('../../web/src/components/ProtectedRoute.jsx', import.meta.url));
const page = readSource(new URL('../../web/src/pages/Consent.jsx', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const es = readSource(new URL('../../web/src/i18n/locales/es.js', import.meta.url));

describe('the destination survives the interruption', () => {
  test('the redirect carries where they were going', () => {
    assert.match(route, /state=\{\{ from: location\.pathname \+ location\.search \}\}/);
    assert.doesNotMatch(route, /<Navigate to="\/consent" replace \/>/, 'the destination is dropped again');
  });

  test('and the page navigates there rather than to a fixed path', () => {
    assert.match(page, /navigate\(afterConsent\(from\)\)/);
    assert.doesNotMatch(page, /navigate\('\/intake'\)/, 'the hardcoded intake redirect is back');
  });

  for (const [from, expected, why] of [
    ['/coach', '/coach', 'the coach is where most returning athletes were going'],
    ['/program', '/program', 'and some of them were going to read their block'],
    ['/log?date=2026-09-11', '/log?date=2026-09-11', 'the query string is part of where they were'],
    [null, DEFAULT_AFTER_CONSENT, 'a fresh signup has no destination and belongs at intake'],
    [undefined, DEFAULT_AFTER_CONSENT, 'same for an absent value'],
    ['', DEFAULT_AFTER_CONSENT, 'and for an empty one'],
  ]) {
    test(`${JSON.stringify(from)} -> ${expected}: ${why}`, () => {
      assert.equal(afterConsent(from), expected);
    });
  }
});

describe('it is a redirect, so it refuses to be an open one', () => {
  for (const hostile of [
    '//evil.example/phish',
    'https://evil.example',
    'http://evil.example',
    'evil.example',
    '//evil.example',
  ]) {
    test(`${hostile} goes nowhere`, () => {
      /*
       * `from` arrives through router state, which is ordinary client-side
       * data on a history entry a person can edit. Anything that turns a
       * stored string into a navigation target is an open redirect until it
       * refuses to be - and `//host` is the one that looks relative and is
       * not: every browser reads it as a protocol-relative URL to another
       * origin.
       */
      assert.equal(afterConsent(hostile), DEFAULT_AFTER_CONSENT);
    });
  }

  test('and it never sends anybody back to the gate', () => {
    // The loop this screen exists outside of.
    assert.equal(afterConsent('/consent'), DEFAULT_AFTER_CONSENT);
    assert.equal(afterConsent('/consent?x=1'), DEFAULT_AFTER_CONSENT);
  });
});

describe('the button says where the button goes', () => {
  test('intake for a new account, and not for a returning one', () => {
    assert.equal(continueLabelKey(null), 'consent.continue');
    assert.equal(continueLabelKey('/coach'), 'consent.continueBack');
  });

  test('both labels exist in both languages', () => {
    // A missing key renders as `consent.continueBack` on the screen where
    // somebody is deciding whether to trust what this product tells them.
    for (const [name, catalogue] of [['en', en], ['es', es]]) {
      assert.match(catalogue, /\n\s+continue: '/, `${name} lost consent.continue`);
      assert.match(catalogue, /\n\s+continueBack: '/, `${name} has no consent.continueBack`);
    }
  });

  test('the returning label does not promise a form', () => {
    // "Continue to intake" in front of somebody who finished intake a month
    // ago is the sentence that loses them.
    assert.doesNotMatch(en.slice(en.indexOf('continueBack:'), en.indexOf('continueBack:') + 80), /intake/i);
    assert.doesNotMatch(es.slice(es.indexOf('continueBack:'), es.indexOf('continueBack:') + 80), /cuestionario/i);
  });
});

describe('the reason is written down where the next person will look', () => {
  test('the redirect explains what it is carrying and why', () => {
    const raw = readRaw(new URL('../../web/src/components/ProtectedRoute.jsx', import.meta.url));
    assert.match(raw, /WHERE THEY WERE GOING TRAVELS WITH THEM/);
    // The date matters: it is what lets somebody line this up against the
    // consent rows and see which accounts were affected.
    assert.match(raw, /2026-09-09/);
  });
});

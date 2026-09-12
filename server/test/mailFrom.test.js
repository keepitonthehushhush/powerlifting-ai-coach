import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';

import { isSendableFrom, senderFrom, SENDER_NAME } from '../src/lib/mailFrom.js';

/**
 * The predicate the health endpoint and check:smtp must agree on.
 *
 * env.js defaults SMTP_FROM to SMTP_USER - right for providers whose username
 * IS the mailbox, and wrong for both this project has touched. Postmark's
 * username is a Server API Token; Resend's is the literal word `resend`.
 */
describe('isSendableFrom', () => {
  test('accepts what a mail server would accept', () => {
    assert.equal(isSendableFrom('coach@coachdiaz.app'), true);
    // Display-name form is legitimate and common; rejecting it would be a
    // worse failure than the one being guarded against.
    assert.equal(isSendableFrom('Coach Diaz <coach@coachdiaz.app>'), true);
    assert.equal(isSendableFrom('  coach@coachdiaz.app  '), true);
  });

  test('rejects the two values SMTP_USER actually holds', () => {
    // These are the whole reason this exists. Not hypothetical shapes -
    // the literal usernames of the two providers in play.
    assert.equal(isSendableFrom('resend'), false, "Resend's SMTP username");
    assert.equal(
      isSendableFrom('a1b2c3d4-5e6f-7890-abcd-ef1234567890'),
      false,
      'a Postmark Server API Token'
    );
  });

  test('rejects absence without throwing', () => {
    for (const value of [undefined, null, '', '   ']) {
      assert.equal(isSendableFrom(value), false);
    }
  });

  test('rejects an address a public mail server cannot route to', () => {
    assert.equal(isSendableFrom('coach@localhost'), false);
    assert.equal(isSendableFrom('not an address'), false);
    assert.equal(isSendableFrom('two@@at.signs'), false);
  });
});

describe('both callers use it, so they cannot disagree', () => {
  /*
   * Two copies of this predicate is how "configured" comes to mean one thing
   * in a dashboard and another in a terminal. The transport BUILDER is
   * duplicated on purpose - an independent witness must not share the code it
   * witnesses - but a pure predicate has nothing to hide.
   */
  test('the health endpoint imports it rather than re-deriving it', () => {
    const app = readSource(new URL('../src/app.js', import.meta.url));
    assert.match(app, /import \{ isSendableFrom \}/);
    assert.doesNotMatch(app, /\[\^@\\s\]/, 'app.js is re-implementing the check instead of importing it');
  });

  test('check:smtp imports it rather than re-deriving it', () => {
    const script = readSource(new URL('../../scripts/check-smtp.mjs', import.meta.url));
    // Both pure helpers, from the one module. The import gained senderFrom
    // when the display name moved into code; asserting the exact old import
    // line would have failed for the right change.
    assert.match(script, /import \{ isSendableFrom, senderFrom \}/);
    assert.doesNotMatch(script, /\[\^@\\s\]/, 'check-smtp.mjs is re-implementing the check');
  });

  test('the health endpoint distinguishes misconfigured from unconfigured', () => {
    // Two states hid the dangerous one: credentials present with an unsendable
    // From is a GUARANTEED send failure, and it reported as "configured".
    const app = readSource(new URL('../src/app.js', import.meta.url));
    assert.match(app, /'misconfigured'/);
    assert.match(app, /return 'unconfigured'/);
    assert.match(app, /isSendableFrom\(config\.smtp\.from\)/);
  });
});

describe('the name a person sees in their inbox', () => {
  /*
   * ── REPORTED FROM AN ACTUAL INBOX ──────────────────────────────────────────
   *
   * The first message this product ever delivered to a real mailbox arrived
   * from a sender called "coach". Mail clients fall back to the local part of
   * the address when the From header has no display name, and SMTP_FROM is the
   * bare address coach@coachdiaz.app.
   *
   * Not cosmetic on this particular message. It is a notice telling somebody
   * their terms changed and asking them to sign in, which is the exact shape of
   * a phishing mail - and it turned up from "coach" rather than from anything
   * with a name.
   */
  test('a bare address gains the product name', () => {
    assert.equal(senderFrom('coach@coachdiaz.app'), 'Coach Diaz <coach@coachdiaz.app>');
    assert.equal(SENDER_NAME, 'Coach Diaz');
  });

  test('the result is still a From header the predicate accepts', () => {
    // The health endpoint and check:smtp both gate on isSendableFrom. A
    // display name that broke it would report production as misconfigured.
    assert.ok(isSendableFrom(senderFrom('coach@coachdiaz.app')));
  });

  test('a display name an operator set themselves is left alone', () => {
    assert.equal(
      senderFrom('Something Else <coach@coachdiaz.app>'),
      'Something Else <coach@coachdiaz.app>'
    );
  });

  test('AND A MISCONFIGURATION IS NOT DISGUISED AS A FRIENDLY SENDER', () => {
    /*
     * The one that matters. SMTP_FROM defaults to SMTP_USER, which on Postmark
     * is a Server API Token. Wrapping "Coach Diaz <...>" around a token would
     * turn a value isSendableFrom REFUSES into one it accepts - so the check
     * that exists to catch that misconfiguration would start passing on it.
     */
    for (const bad of ['', '   ', 'not-an-address', '415ab0de-1111-2222-3333-444444444444', 'resend']) {
      assert.equal(senderFrom(bad), bad.trim(), `${JSON.stringify(bad)} was dressed up`);
      assert.equal(isSendableFrom(senderFrom(bad)), false, `${JSON.stringify(bad)} now passes the gate`);
    }
  });

  test('a name with a comma or a quote is quoted rather than breaking the header', () => {
    // Not needed for "Coach Diaz", needed the day somebody changes it.
    assert.equal(senderFrom('coach@coachdiaz.app', 'Coach, Diaz'), '"Coach, Diaz" <coach@coachdiaz.app>');
    assert.match(senderFrom('coach@coachdiaz.app', 'The "Coach"'), /^"The \\"Coach\\"" </);
  });

  test('both sends and the probe compose it the same way', () => {
    /*
     * The probe's whole purpose is to prove what the real messages do. A From
     * header built separately in the script would differ from production's in
     * exactly the way that went unnoticed until somebody read their inbox.
     */
    const mailer = readSource(new URL('../src/lib/mailer.js', import.meta.url));
    const script = readSource(new URL('../../scripts/check-smtp.mjs', import.meta.url));
    assert.equal((mailer.match(/from: senderFrom\(config\.smtp\.from\)/g) ?? []).length, 2);
    assert.doesNotMatch(mailer, /from: config\.smtp\.from/, 'a send bypasses the composition');
    assert.match(script, /const from = senderFrom\(configuredFrom\)/);
  });

  test('and the address, not the header, is what gets validated', () => {
    // Postmark matches a Sender Signature on the address. The failure message
    // has to name the value an operator would go and change.
    const script = readSource(new URL('../../scripts/check-smtp.mjs', import.meta.url));
    assert.match(script, /isSendableFrom\(configuredFrom\)/);
  });
});

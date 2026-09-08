import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';

import { isSendableFrom } from '../src/lib/mailFrom.js';

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
    assert.match(script, /import \{ isSendableFrom \}/);
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

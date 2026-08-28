import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkPassword, PASSWORD_RULES, MIN_LENGTH } from '../../web/src/lib/passwordPolicy.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';

/**
 * The point these tests are guarding is easy to lose: this policy is a MIRROR
 * of the Supabase Auth settings, not the enforcement of them. Sign-up goes
 * from browser to Supabase directly, so a person who never loads the form is
 * never subject to a single line of this file.
 *
 * What the tests can check is that the mirror is accurate, complete and
 * honest - and that nobody later mistakes it for the control it reflects.
 */

describe('password policy', () => {
  test('rejects the passwords people actually pick', () => {
    for (const weak of ['password', 'Password1', '12345678', 'letmein', 'squat123', 'Coach!']) {
      assert.equal(checkPassword(weak).ok, false, `${weak} should be rejected`);
    }
  });

  test('accepts a password that satisfies every rule', () => {
    assert.equal(checkPassword('CorrectHorse1!').ok, true);
  });

  test('length alone is not enough, and neither is variety alone', () => {
    assert.equal(checkPassword('aaaaaaaaaaaaaaaaaaaa').ok, false, 'long but one class');
    assert.equal(checkPassword('aA1!').ok, false, 'every class but too short');
  });

  test('reports every rule with its state, not only the failures', () => {
    const { results } = checkPassword('Password1');
    assert.equal(results.length, PASSWORD_RULES.length);
    const byId = Object.fromEntries(results.map((r) => [r.id, r.satisfied]));
    assert.equal(byId.uppercase, true);
    assert.equal(byId.symbol, false);
  });

  test('does not throw on a missing or non-string value', () => {
    for (const value of [undefined, null, 42, {}, []]) {
      assert.equal(checkPassword(value).ok, false);
    }
  });

  test('the minimum is at least the 8 characters Supabase calls the floor', () => {
    assert.ok(MIN_LENGTH >= 8, 'anything under 8 is below the documented floor');
  });

  test('only symbols Supabase Auth accepts are counted as symbols', () => {
    const symbolRule = PASSWORD_RULES.find((r) => r.id === 'symbol');
    for (const ch of ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '-', '=', '[', ']', '{', '}', ';', "'", ':', '"', '|', '<', '>', '?', ',', '.', '/', '`', '~']) {
      assert.equal(symbolRule.test(ch), true, `${ch} is in Supabase's accepted set`);
    }
    // A character the server would not count must not be counted here either,
    // or the form promises a password the server will refuse.
    for (const ch of ['é', '€', ' ', '§']) {
      assert.equal(symbolRule.test(ch), false, `${ch} is not in Supabase's accepted set`);
    }
  });
});

describe('password policy is fully translated', () => {
  for (const [name, catalogue] of [['en', en], ['es', es]]) {
    test(`${name}: every rule has a label`, () => {
      for (const { id } of PASSWORD_RULES) {
        const label = catalogue.auth?.passwordRules?.[id];
        assert.equal(typeof label, 'string', `${name} is missing auth.passwordRules.${id}`);
        assert.ok(label.trim().length > 0, `${name}: auth.passwordRules.${id} is blank`);
      }
    });

    test(`${name}: has the surrounding copy the checklist needs`, () => {
      for (const key of ['requirements', 'weak', 'managerHint', 'met', 'notMet']) {
        assert.equal(typeof catalogue.auth?.passwordRules?.[key], 'string', `${name} is missing auth.passwordRules.${key}`);
      }
    });
  }
});

describe('the policy does not pretend to be enforcement', () => {
  test('says plainly that Supabase Auth is the control', () => {
    const source = readFileSync(new URL('../../web/src/lib/passwordPolicy.js', import.meta.url), 'utf8');
    assert.match(source, /NOT the enforcement point/i);
    assert.match(source, /Supabase/);
  });

  test('SECURITY.md records the server-side settings this mirrors', () => {
    const doc = readFileSync(new URL('../../docs/SECURITY.md', import.meta.url), 'utf8');
    assert.match(doc, /[Pp]assword/);
    assert.match(doc, new RegExp(String(MIN_LENGTH)));
  });
});

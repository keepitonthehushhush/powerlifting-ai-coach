import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanEmailInput,
  hadInvisibleCharacters,
  describeEmailProblem,
} from '../../web/src/lib/emailInput.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';
import { readSource } from './helpers/source.js';

/**
 * The iPhone login failure, pinned.
 *
 * "Stuck on enter an email address when I have one entered - clicking sign in
 * does nothing." The field showed a correct address, the error log had nothing
 * in it at all, and the request never left the phone.
 *
 * The cause is a character that cannot be seen. The fixtures below are the
 * measured behavior of a real browser, not a guess: `input type=email` strips
 * ASCII whitespace itself, so the obvious suspect passes, and the ones that
 * fail are the ones a phone actually inserts.
 */

const ADDRESS = 'eddydiaz10@gmail.com';

describe('invisible characters are removed from an email as it is typed', () => {
  const CULPRITS = {
    'a non-breaking space (U+00A0), from a contact-card autofill': '\u00a0',
    'a zero-width space (U+200B), from a paste out of a mail app': '\u200b',
    'a soft hyphen (U+00AD)': '\u00ad',
    'a zero-width non-joiner (U+200C)': '\u200c',
    'a word joiner (U+2060)': '\u2060',
    'a byte-order mark (U+FEFF)': '\ufeff',
    'a left-to-right mark (U+200E)': '\u200e',
    'a narrow no-break space (U+202F)': '\u202f',
    'an ideographic space (U+3000)': '\u3000',
  };

  for (const [description, character] of Object.entries(CULPRITS)) {
    test(`removes ${description}`, () => {
      /*
       * Three positions, because a phone can put one anywhere: appended by a
       * QuickType suggestion, prepended by a paste, or dropped mid-string by
       * a soft-hyphen line break in whatever the address was copied out of.
       * All three must come back as the plain address.
       */
      for (const value of [
        `${ADDRESS}${character}`,
        `${character}${ADDRESS}`,
        `eddy${character}diaz10@gmail.com`,
      ]) {
        assert.equal(cleanEmailInput(value), ADDRESS, JSON.stringify(value));
        assert.equal(hadInvisibleCharacters(value), true, JSON.stringify(value));
      }
    });
  }

  test('an ordinary address is returned untouched', () => {
    assert.equal(cleanEmailInput(ADDRESS), ADDRESS);
    assert.equal(hadInvisibleCharacters(ADDRESS), false);
  });

  test('case is left alone, because the local part is not ours to change', () => {
    // Capitalization does not break validation - measured - so silently
    // lowercasing somebody's address would be a change with no cause.
    assert.equal(cleanEmailInput('Eddydiaz10@Gmail.com'), 'Eddydiaz10@Gmail.com');
  });

  test('plus addressing and dots survive, since people really use them', () => {
    for (const value of ['eddy+coach@gmail.com', 'eddy.diaz.10@gmail.com', "o'brien@example.co.uk"]) {
      assert.equal(cleanEmailInput(value), value);
    }
  });

  test('it never lengthens the value, whatever it is given', () => {
    // The property that makes it safe to run on every keystroke.
    for (const value of ['', ' ', ADDRESS, `${ADDRESS}\u00a0\u200b`, 'not an email at all', '\u3000\u3000']) {
      assert.ok(cleanEmailInput(value).length <= value.length, JSON.stringify(value));
    }
  });

  test('non-strings do not throw', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      assert.equal(cleanEmailInput(value), '');
      assert.equal(hadInvisibleCharacters(value), false);
    }
  });

  test('a repair is reported, so a silent fix is not a secret one', () => {
    assert.equal(hadInvisibleCharacters(`${ADDRESS}\u00a0`), true);
    assert.equal(hadInvisibleCharacters(ADDRESS), false);
  });
});

describe('the login form actually uses it, and tells iOS to behave', () => {
  const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));

  test('the email field is cleaned on change', () => {
    assert.match(login, /setEmail\(cleanEmailInput\(e\.target\.value\)\)/);
    // The raw value must never be assigned straight to state again.
    assert.doesNotMatch(login, /setEmail\(e\.target\.value\)/);
  });

  test('and the repair is surfaced rather than hidden', () => {
    assert.match(login, /setEmailRepaired\(hadInvisibleCharacters\(e\.target\.value\)\)/);
    assert.match(login, /auth\.emailCleaned/);
  });

  test('iOS is told not to capitalize, autocorrect or spellcheck the address', () => {
    /*
     * None of these break validation on their own - capitalization was
     * measured as valid. They break the LOGIN: an address the user did not
     * type is an address that does not match the account, and the failure that
     * produces is a screen that just says no.
     */
    for (const attribute of [
      /autoCapitalize="none"/,
      /autoCorrect="off"/,
      /spellCheck=\{false\}/,
      /inputMode="email"/,
    ]) {
      assert.match(login, attribute);
    }
  });

  test('the field is still a real email input, so the keyboard is right', () => {
    // The fix must not reach for type="text" to dodge validation. The @ key on
    // an iPhone keyboard is worth more than the validation is worth avoiding.
    assert.match(login, /type="email"/);
    assert.match(login, /autoComplete="email"/);
  });
});

describe('the form says WHICH problem, not "enter an email address"', () => {
  /*
   * Two rounds of "same thing" produced no new information, because the only
   * thing the app could say was the browser's own sentence - which names the
   * one thing that is not wrong, cannot be reworded, and reports nothing back.
   * Every branch below exists so the third round starts from a fact.
   */
  const CASES = {
    'eddydiaz10@gmail.com': null,
    'eddy+tag@sub.gmail.co.uk': null,
    '': 'empty',
    '   ': 'empty',
    'eddydiaz10': 'noAt',
    'a@@b.com': 'manyAt',
    '@gmail.com': 'noLocal',
    'eddy@': 'noDomain',
    'eddy@gmail': 'noDot',
    'eddy@gmail..com': 'badDot',
    'eddy@gmail.com.': 'badDot',
    'eddy@.gmail.com': 'badDot',
  };

  for (const [value, code] of Object.entries(CASES)) {
    test(`${JSON.stringify(value)} -> ${code ?? 'accepted'}`, () => {
      const problem = describeEmailProblem(value);
      assert.equal(problem?.code ?? null, code);
    });
  }

  test('an invisible character never reaches the verdict, because it is stripped first', () => {
    // The two halves working together: cleaning removes it, so the address
    // that remains is judged on its merits rather than rejected for a
    // character nobody can see.
    assert.equal(describeEmailProblem(`eddydiaz10@gmail.com\u00a0`), null);
    assert.equal(describeEmailProblem(`\u200beddydiaz10@gmail.com`), null);
  });

  test('a lookalike @ is named as such, not reported as a missing @', () => {
    /*
     * Checked BEFORE the missing-@ test on purpose. A full-width @ from a
     * keyboard the user did not realize they were on would otherwise produce
     * "that address is missing an @ sign" while one is plainly on screen -
     * the same unhelpfulness, one level down.
     */
    const problem = describeEmailProblem('eddy＠gmail.com');
    assert.equal(problem.code, 'lookalikeAt');
    assert.equal(problem.codePoint, 'U+FF20');
  });

  test('an unusual visible character is reported with its code point', () => {
    // "Remove the U+2019 character" is actionable. "Enter an email address"
    // is not, which is the entire reason this function exists.
    const problem = describeEmailProblem("eddy’s@gmail.com");
    assert.equal(problem.code, 'oddCharacter');
    assert.equal(problem.codePoint, 'U+2019');
  });

  test('every code the function can return has a message in every locale', () => {
    // A verdict with no sentence attached is a silent failure wearing a
    // different hat.
    const codes = ['empty', 'noAt', 'manyAt', 'noLocal', 'noDomain', 'noDot', 'badDot'];
    for (const [name, locale] of [['en', en], ['es', es]]) {
      for (const code of codes) {
        assert.ok(locale.auth.emailProblem[code], `${name} has no message for ${code}`);
      }
      // The two character verdicts share one message, which takes the code point.
      assert.match(locale.auth.emailProblem.character, /\{code\}/, `${name} does not interpolate the code point`);
    }
  });

  test('the form validates itself rather than leaving it to the browser', () => {
    const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));
    assert.match(login, /noValidate/);
    assert.match(login, /describeEmailProblem\(email\)/);
    // And the field keeps type=email, so the phone keyboard still has an @.
    assert.match(login, /type="email"/);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AAL1,
  AAL2,
  assuranceLevelOf,
  describeStepUp,
  shouldRefuse,
} from '../src/lib/assuranceLevel.js';
import {
  describeMfaState,
  verifiedTotpFactor,
  abandonedTotpFactors,
  cleanTotpCode,
  codeLooksComplete,
} from '../../web/src/lib/mfa.js';
import { readSource } from './helpers/source.js';

/**
 * The second factor, on both sides of the wire.
 *
 * Two failures are possible and they are not symmetrical. Letting an aal1
 * session through when the account has a verified factor means the control
 * does not exist. Refusing somebody who never enrolled means locking a person
 * out of a health record they own, with a code they cannot produce. The tests
 * below are weighted accordingly: the first must be impossible, the second
 * must be impossible, and everything ambiguous is named rather than guessed.
 */

/** A token whose payload is the given claims. Signature is irrelevant here - */
/** requireAuth verifies the token before this module ever sees it. */
const tokenWith = (claims) =>
  ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');

describe('reading the assurance level off a verified token', () => {
  test('aal2 is read as aal2', () => {
    assert.equal(assuranceLevelOf(tokenWith({ sub: 'x', aal: 'aal2' })), AAL2);
  });

  test('aal1 is read as aal1', () => {
    assert.equal(assuranceLevelOf(tokenWith({ sub: 'x', aal: 'aal1' })), AAL1);
  });

  test('a MISSING claim is aal1, which is what Supabase documents', () => {
    // "JWTs without an `aal` claim are at the `aal1` level." Reading absent as
    // aal2 is the one mistake here that silently disables the whole feature.
    assert.equal(assuranceLevelOf(tokenWith({ sub: 'x' })), AAL1);
  });

  test('garbage never throws and never reads as strong', () => {
    for (const bad of [null, undefined, '', 'not.a.token', 'a.b', 'a.!!!.c', 42, {}]) {
      assert.doesNotThrow(() => assuranceLevelOf(bad));
      assert.equal(assuranceLevelOf(bad), AAL1, `${String(bad)} read as something other than aal1`);
    }
  });

  test('a claim that is not a string does not pass through', () => {
    assert.equal(assuranceLevelOf(tokenWith({ aal: 2 })), AAL1);
    assert.equal(assuranceLevelOf(tokenWith({ aal: '' })), AAL1);
  });
});

describe('deciding whether a caller still owes a second factor', () => {
  const verified = { factor_type: 'totp', status: 'verified' };
  const unverified = { factor_type: 'totp', status: 'unverified' };

  test('THE CASE THE FEATURE EXISTS FOR: a verified factor and an aal1 session', () => {
    const stepUp = describeStepUp({ level: AAL1, factors: [verified] });
    assert.equal(stepUp.verdict, 'stepUpRequired');
    assert.equal(shouldRefuse(stepUp), true);
  });

  test('THE CASE THAT MUST NEVER LOCK ANYBODY OUT: no factors at all', () => {
    const stepUp = describeStepUp({ level: AAL1, factors: [] });
    assert.equal(stepUp.verdict, 'satisfied');
    assert.equal(shouldRefuse(stepUp), false);
  });

  test('an abandoned enrollment is not a second factor', () => {
    // enroll() writes an unverified factor immediately. Somebody who opened
    // the setup screen and closed it must still be able to sign in.
    const stepUp = describeStepUp({ level: AAL1, factors: [unverified] });
    assert.equal(stepUp.verdict, 'satisfied');
    assert.equal(shouldRefuse(stepUp), false);
  });

  test('an aal2 session is satisfied whatever the factor list says', () => {
    for (const factors of [[verified], [], null, undefined]) {
      assert.equal(describeStepUp({ level: AAL2, factors }).verdict, 'satisfied');
    }
  });

  test('an ABSENT factor list is unknown, not empty', () => {
    // "getUser() returned no factors field" and "this person has no factors"
    // are different facts, and collapsing them is how a check reports an
    // unearned pass.
    for (const factors of [null, undefined, 'nope', {}]) {
      const stepUp = describeStepUp({ level: AAL1, factors });
      assert.equal(stepUp.verdict, 'unknown', `${String(factors)} was treated as a factor list`);
    }
  });

  test('unknown does not refuse, and the reason is written down where it is decided', () => {
    /*
     * Deliberate and uncomfortable. Refusing on unknown turns any change in
     * the shape of a getUser() response into a total outage for everybody,
     * including the majority with no second factor. It is only safe because
     * the restrictive RLS policy evaluates the same rule inside the database,
     * where the factor list is the table being read and cannot be absent.
     */
    assert.equal(shouldRefuse(describeStepUp({ level: AAL1, factors: null })), false);
    const source = readSource(new URL('../src/lib/assuranceLevel.js', import.meta.url));
    assert.match(source, /verdict === 'stepUpRequired'/, 'refusal must key on the one verdict');
  });
});

describe('what the browser shows, from the two levels Supabase reports', () => {
  const cases = [
    [AAL1, AAL1, 'notEnrolled', true],
    [AAL1, AAL2, 'challengeRequired', false],
    [AAL2, AAL2, 'active', true],
    [AAL2, AAL1, 'staleSession', true],
  ];

  for (const [currentLevel, nextLevel, state, satisfied] of cases) {
    test(`${currentLevel} / ${nextLevel} is ${state}`, () => {
      const result = describeMfaState({ currentLevel, nextLevel });
      assert.equal(result.state, state);
      assert.equal(result.satisfied, satisfied);
    });
  }

  test('anything else is unknown, and unknown is not a pass', () => {
    for (const levels of [{}, null, { currentLevel: 'aal3', nextLevel: 'aal3' }, { currentLevel: AAL1 }]) {
      const result = describeMfaState(levels);
      assert.equal(result.state, 'unknown');
      assert.equal(result.satisfied, false, 'unknown must never satisfy the gate');
    }
  });

  test('the two sides agree about what aal2 means', () => {
    // The browser and the API each decide this independently. They are allowed
    // to be implemented separately; they are not allowed to disagree.
    assert.equal(describeMfaState({ currentLevel: AAL2, nextLevel: AAL2 }).satisfied, true);
    assert.equal(describeStepUp({ level: AAL2, factors: [] }).verdict, 'satisfied');
  });
});

describe('picking a factor out of what listFactors returns', () => {
  /*
   * The installed SDK (@supabase/supabase-js 2.112.4) returns `all` alongside
   * per-type arrays that are typed verified-only, which is NOT what the
   * published guide shows. Read off node_modules rather than the docs, and
   * written to survive either shape.
   */
  const verified = { id: 'f1', factor_type: 'totp', status: 'verified' };
  const abandoned = { id: 'f2', factor_type: 'totp', status: 'unverified' };

  test('the verified factor is found in the newer `all` shape', () => {
    assert.equal(verifiedTotpFactor({ all: [abandoned, verified] })?.id, 'f1');
  });

  test('and in the older per-type shape', () => {
    assert.equal(verifiedTotpFactor({ totp: [verified] })?.id, 'f1');
  });

  test('an unverified factor is never mistaken for one', () => {
    assert.equal(verifiedTotpFactor({ all: [abandoned] }), null);
    assert.equal(verifiedTotpFactor({ totp: [abandoned] }), null);
  });

  test('nothing, or nonsense, is null rather than a throw', () => {
    for (const bad of [null, undefined, {}, { all: 'no' }]) {
      assert.equal(verifiedTotpFactor(bad), null);
    }
  });

  test('abandoned enrollments are findable, so they can be cleared', () => {
    // The default ceiling is ten factors per user. Without this, the eleventh
    // abandoned setup attempt is a person who cannot turn MFA on and is told
    // nothing about why.
    const abandoned2 = { id: 'f3', factor_type: 'totp', status: 'unverified' };
    const found = abandonedTotpFactors({ all: [verified, abandoned, abandoned2] });
    assert.deepEqual(found.map((f) => f.id), ['f2', 'f3']);
  });
});

describe('the code somebody types', () => {
  test('spaces and dashes are forgiven, because authenticator apps show them', () => {
    assert.equal(cleanTotpCode('123 456'), '123456');
    assert.equal(cleanTotpCode('123-456'), '123456');
    assert.equal(cleanTotpCode('  123456  '), '123456');
  });

  test('it never grows past six digits', () => {
    assert.equal(cleanTotpCode('1234567890'), '123456');
  });

  test('completeness is six digits and nothing else', () => {
    assert.equal(codeLooksComplete('123 456'), true);
    for (const bad of ['12345', '1234a5', '', null, undefined, 'abcdef']) {
      assert.equal(codeLooksComplete(bad), false, `${String(bad)} looked complete`);
    }
  });
});

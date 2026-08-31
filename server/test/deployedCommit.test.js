import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { describeCommitAgreement } from '../src/lib/deployedCommit.js';
import { readSource } from './helpers/source.js';

/**
 * The check that would have saved two hours.
 *
 * 2026-08-31: a login fix deployed at 16:44, a redeploy of the previous day's
 * commit took the coachdiaz.app alias at 16:45, and production silently
 * reverted a day's work. The user reinstalled the app twice and reported the
 * bug as unfixed, which it was.
 *
 * Every existing deployment assertion passed throughout, because the old build
 * was a perfectly good build - of the wrong commit. Nothing asked which code
 * was serving, so nothing could say.
 */

describe('agreement between the deployed commit and this checkout', () => {
  test('identical shas agree', () => {
    const out = describeCommitAgreement({ local: 'a'.repeat(40), health: { commit: 'a'.repeat(40) } });
    assert.equal(out.verdict, 'agree');
  });

  test('a short sha still agrees with the long one it names', () => {
    // Refusing an abbreviated sha would invent a difference, which is the
    // noisiest possible failure for a check whose whole job is noticing one.
    assert.equal(
      describeCommitAgreement({ local: 'abc123def456789', health: { commit: 'abc123d' } }).verdict,
      'agree',
    );
    assert.equal(
      describeCommitAgreement({ local: 'abc123d', health: { commit: 'abc123def456789' } }).verdict,
      'agree',
    );
  });

  test('different shas differ, and both are reported', () => {
    const out = describeCommitAgreement({ local: 'aaa111', health: { commit: 'bbb222' } });
    assert.equal(out.verdict, 'differ');
    assert.equal(out.local, 'aaa111');
    assert.equal(out.remote, 'bbb222');
  });

  test('a sha that only shares a prefix by accident still differs', () => {
    assert.equal(
      describeCommitAgreement({ local: 'abc123', health: { commit: 'abc999' } }).verdict,
      'differ',
    );
  });

  test('whitespace around a sha does not manufacture a difference', () => {
    assert.equal(
      describeCommitAgreement({ local: ' abc123\n', health: { commit: 'abc123 ' } }).verdict,
      'agree',
    );
  });
});

describe('every way of not knowing is "unknown", never "agree"', () => {
  /*
   * The property that matters. Collapsing "could not determine" into a pass is
   * how a check reports a green it has not earned, and this codebase has paid
   * for that more than once.
   */
  const CANNOT_TELL = {
    'health was unreachable': { local: 'abc123', healthProblem: 'fetch failed' },
    'the deployment predates the commit field': { local: 'abc123', health: {} },
    'the deployment reports no commit': { local: 'abc123', health: { commit: 'dev' } },
    'the commit field is empty': { local: 'abc123', health: { commit: '   ' } },
    'the commit field is not a string': { local: 'abc123', health: { commit: 42 } },
    'git could not be read here': { health: { commit: 'abc123' } },
    'nothing was supplied at all': {},
  };

  for (const [situation, input] of Object.entries(CANNOT_TELL)) {
    test(`unknown when ${situation}`, () => {
      const out = describeCommitAgreement(input);
      assert.equal(out.verdict, 'unknown', situation);
      assert.ok(out.reason && out.reason.length > 10, `${situation} gives no reason`);
    });
  }

  test('no input shape returns agree without two real shas', () => {
    // Stated as a property rather than trusting the cases above to be complete.
    for (const input of Object.values(CANNOT_TELL)) {
      assert.notEqual(describeCommitAgreement(input).verdict, 'agree');
    }
  });
});

describe('the pieces are wired together', () => {
  test('the server publishes the commit on /api/health', () => {
    const app = readSource(new URL('../src/app.js', import.meta.url));
    assert.match(app, /commit:\s*process\.env\.VERCEL_GIT_COMMIT_SHA \?\? 'dev'/);
  });

  test('verify:deployment reads it and can fail on it', () => {
    const script = readSource(new URL('../../scripts/verify-deployment.mjs', import.meta.url));
    assert.match(script, /describeCommitAgreement/);
    assert.match(script, /rev-parse/);
    // The failure must set the exit status, not merely print. A warning nobody
    // is forced to read is how the original problem survived two hours.
    assert.match(script, /deployed\.verdict === 'differ'[\s\S]{0,400}failed = true/);
  });

  test('it says which direction, because behind and ahead need opposite actions', () => {
    const script = readSource(new URL('../../scripts/verify-deployment.mjs', import.meta.url));
    assert.match(script, /BEHIND/);
    assert.match(script, /rev-list/);
  });
});

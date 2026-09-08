import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The check that exists because nothing else would ever notice.
 *
 * `mailer.js` reports a dead transport to its caller, which is right - but its
 * only caller is the guardian consent route, used when somebody aged 13-17
 * signs up. So the first person able to discover that SMTP is misconfigured is
 * a parent who did not get the mail, about a child who is waiting.
 */

const SCRIPT = fileURLToPath(new URL('../../scripts/check-smtp.mjs', import.meta.url));
const source = readFileSync(SCRIPT, 'utf8');

/** Run it with a clean SMTP environment plus whatever this case sets. */
function run(env = {}, args = []) {
  const base = { ...process.env };
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_PORT', 'SMTP_FROM']) delete base[key];
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      env: { ...base, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('check:smtp', () => {
  test('an unconfigured transport is exit 3, not a failure', () => {
    // Correct and expected locally and in every test run. Collapsing this into
    // FAIL is the same error as calling a billing outage a safety regression.
    const { code, out } = run();
    assert.equal(code, 3);
    assert.match(out, /NOT CONFIGURED/);
    assert.match(out, /SMTP_HOST/);
  });

  test('--require turns the same state into a failure, for the production runbook', () => {
    const { code, out } = run({}, ['--require']);
    assert.equal(code, 1);
    assert.match(out, /FAIL/);
  });

  test('a half-configured transport names only what is missing', () => {
    // The failure has to say which of the three, or it sends somebody to check
    // all three and re-paste the one that was already right.
    const { code, out } = run({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'someone' });
    assert.equal(code, 3);
    assert.match(out, /SMTP_PASSWORD/);
    assert.doesNotMatch(out, /SMTP_HOST/);
  });

  /*
   * THE ONE THAT WOULD BE UNFORGIVABLE.
   *
   * This runs against a shell holding production credentials, and its output
   * goes to terminals and CI logs. A check that echoes the secret it is
   * checking is a worse defect than the one it looks for.
   */
  test('it can never print the password', () => {
    const secret = 'correct-horse-battery-staple';
    const { out } = run({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'someone', SMTP_PASSWORD: secret });
    assert.doesNotMatch(out, new RegExp(secret), 'the password reached the output');

    // And no path in the source can, whatever the branch taken at runtime -
    // the case above cannot reach the connect path on a machine without
    // nodemailer, so the static half is what covers the half it cannot run.
    assert.doesNotMatch(source, /console\.(log|error)\([^)]*\bpass\b/, 'a log line interpolates the password');
    assert.doesNotMatch(source, /SMTP_PASSWORD.*console|console.*SMTP_PASSWORD/, 'the variable name is logged with its value');
  });

  test('it verifies rather than sends, so it needs no recipient', () => {
    // A check that mails somebody to prove mail works needs an address, and
    // every address this product holds belongs to an athlete or to a guardian
    // who never signed up for anything.
    assert.match(source, /\.verify\(\)/, 'the connection must be proved by verify()');
    assert.doesNotMatch(source, /sendMail/, 'this must never send a message');
  });

  test('the four outcomes are distinct, and only one of them is a finding', () => {
    // works 0 / broken 1 / unconfigured 3 / cannot check 3. The two 3s are
    // both "no information", which is the property - neither is a defect.
    assert.match(source, /process\.exit\(0\)/);
    assert.match(source, /process\.exit\(1\)/);
    assert.match(source, /process\.exit\(3\)/);
    assert.match(source, /CANNOT CHECK/, 'a missing library must not read as a broken transport');
  });
});

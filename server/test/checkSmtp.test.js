import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('the From header, which one provider makes easy to get wrong', () => {
  /*
   * env.js defaults SMTP_FROM to SMTP_USER - correct for providers whose
   * username IS the mailbox, and wrong for Resend, whose SMTP username is the
   * fixed literal `resend`. The resulting From is not an address, the send
   * fails at the far end, and the only person positioned to notice is a parent
   * who never received the link.
   */
  test('a username that is not an address is refused, not connected with', () => {
    const { code, out } = run({
      SMTP_HOST: 'smtp.resend.com',
      SMTP_USER: 'resend',
      SMTP_PASSWORD: 're_not_a_real_key',
    });
    assert.equal(code, 1, 'this must fail, not pass and not read as unconfigured');
    assert.match(out, /not an email address/);
    assert.match(out, /SMTP_FROM/, 'the failure has to name the variable that fixes it');
  });

  test('an explicit SMTP_FROM gets past the check and on to the connection', () => {
    // Proves the guard is about the ADDRESS and not about the provider: with a
    // real From it stops being a From problem, and the run gets far enough to
    // need nodemailer (absent here, so exit 3 - no information, not a finding).
    const { code, out } = run({
      SMTP_HOST: 'smtp.resend.com',
      SMTP_USER: 'resend',
      SMTP_PASSWORD: 're_not_a_real_key',
      SMTP_FROM: 'coach@coachdiaz.app',
    });
    assert.notEqual(code, 1, 'a valid From must not be reported as a From failure');
    assert.doesNotMatch(out, /not an email address/);
  });

  test('the From is checked BEFORE the connection', () => {
    // A valid login with an unsendable From is still a mailbox that cannot
    // deliver. Reporting PASS on it is this project's recurring defect: a green
    // check over something that does not work.
    // `await transport.verify()`, not `.verify()` - the bare form also appears
    // in this script's own header comment EXPLAINING what verify does, which
    // sits above the guard and made this assertion fail on correct code. The
    // readSource/readRaw trap, third time in one session.
    const fromCheck = source.indexOf('not an email address');
    const connect = source.indexOf('await transport.verify()');
    assert.ok(fromCheck > -1 && connect > -1);
    assert.ok(fromCheck < connect, 'the From guard must run before the transport is verified');
  });
});

describe('it reads .env, like every other script in this repo', () => {
  /*
   * It read `process.env` alone, so it announced "NOT CONFIGURED - SMTP_HOST,
   * SMTP_USER, SMTP_PASSWORD are unset" for a repository whose .env had them
   * filled in. A check whose entire job is telling you the truth about your
   * configuration, lying about your configuration - and lying in the direction
   * that sends somebody back to re-enter values that were already correct.
   *
   * Behavioral, not a grep for `dotenv`: what matters is that values in a file
   * REACH the check, which is the thing that was broken.
   */
  test('values in a .env file reach it', () => {
    const file = join(tmpdir(), `check-smtp-${process.pid}.env`);
    writeFileSync(
      file,
      [
        // .invalid is reserved and cannot resolve, so a machine that HAS
        // nodemailer fails DNS immediately rather than dialing a real host
        // from a test run.
        'SMTP_HOST=smtp.invalid',
        'SMTP_PORT=587',
        'SMTP_USER=11111111-2222-3333-4444-555555555555',
        'SMTP_PASSWORD=11111111-2222-3333-4444-555555555555',
        'SMTP_FROM=coach@coachdiaz.app',
      ].join('\n'),
    );
    try {
      const { out } = run({ DOTENV_CONFIG_PATH: file });
      assert.doesNotMatch(
        out,
        /NOT CONFIGURED/,
        'a .env with all five values still reported them unset - dotenv is not being loaded',
      );
    } finally {
      rmSync(file, { force: true });
    }
  });

  test('an unset variable says which kind of unset it is', () => {
    // "You did not set it" and "I could not read the file you set it in" are
    // different problems with different fixes, and the message said neither.
    const { out } = run();
    assert.match(out, /\.env was loaded|dotenv is not installed/);
  });
});

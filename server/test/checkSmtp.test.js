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

/**
 * Run it with a clean SMTP environment plus whatever this case sets.
 *
 * ── WHY IT RUNS SOMEWHERE ELSE ────────────────────────────────────────────
 *
 * Deleting the variables from `env` is not enough. The script loads
 * `dotenv/config`, which reads `.env` from the CURRENT WORKING DIRECTORY - so
 * every "unconfigured" case here was passing only because this developer's
 * `.env` happened to have no SMTP block in it. The day one was added, five
 * tests failed at once and none of them was about the change that broke them.
 *
 * A test whose result depends on an untracked file in the repository root is
 * not testing what it says it is. Running from a temp directory gives dotenv
 * nothing to find. The script's own imports resolve against its module URL
 * rather than cwd, so moving it is safe.
 */
function run(env = {}, args = []) {
  const base = { ...process.env };
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_PORT', 'SMTP_FROM']) delete base[key];
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      env: { ...base, ...env },
      cwd: tmpdir(),
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

  test('it verifies, and sends only to an address the operator typed', () => {
    /*
     * This used to assert `sendMail` appeared nowhere, and the reason given was
     * that every address this product holds belongs to an athlete or to a
     * guardian who never signed up for anything. That reason is still right and
     * it is not an argument against sending - it is an argument about WHERE THE
     * RECIPIENT COMES FROM.
     *
     * It had to change because verify() proves the login and not the send.
     * Postmark accepts the credentials of a server whose Sender Signature is
     * unconfirmed and refuses every message with a 422, so a green check here
     * was compatible with nothing ever arriving. The gap was closed the only
     * way that does not involve a real parent: one fixed message, to one
     * address, named on the command line.
     */
    assert.match(source, /\.verify\(\)/, 'the connection must be proved by verify()');

    // The recipient is argv and nothing else. No database, no env var, no
    // fallback - a default recipient eventually becomes somebody else.
    assert.match(source, /const PROBE = probeIndex === -1 \? null : \(process\.argv\[probeIndex \+ 1\] \?\? ''\)\.trim\(\)/);
    assert.doesNotMatch(source, /to: [^P\n]*process\.env/, 'the recipient comes from the environment');

    // And the send is unreachable without it.
    const sendAt = source.indexOf('transport.sendMail');
    const guardAt = source.indexOf('if (!PROBE) {');
    assert.ok(guardAt > 0 && guardAt < sendAt, 'the send is not behind the --probe guard');
    assert.equal(
      (source.match(/sendMail/g) ?? []).length,
      1,
      'more than one send path in a script whose default is to send nothing'
    );
  });

  /**
   * ── THE ONE THIS PROJECT PAID FOR ─────────────────────────────────────
   *
   * The probe printed PASS, said "go and look in your inbox", and nothing
   * arrived. Postmark had taken the message on the connection, returned a
   * message id, and then refused it internally: SMTPApiError 100007, error
   * 412 - a new account may only send to its own domain until a person
   * approves it. Every user of this product is on gmail, protonmail or
   * icloud, so not one of them could have been reached, and every check
   * anybody had run said PASS.
   *
   * The rejection is ASYNCHRONOUS. No SMTP result could have caught it. The
   * only record is the provider's, so the provider gets asked.
   */
  test('a message accepted and then refused is a FAIL, not a PASS', () => {
    const probe = source.slice(source.indexOf('const verdict = await postmarkVerdict'));
    assert.match(probe.slice(0, 400), /if \(verdict\.bounced\)/);
    assert.match(probe.slice(0, 600), /FAIL - \$\{host\} accepted the message and then refused it/);
    // And it exits non-zero, or a runbook would carry on to the next step.
    const bounceBlock = probe.slice(0, probe.indexOf('console.log('));
    assert.match(bounceBlock, /process\.exit\(1\)/);
  });

  test('not finding a bounce is not reported as arrival', () => {
    // "I saw no problem in twelve seconds" turned into "it works" would be
    // the same defect this function exists because of.
    const probe = source.slice(source.indexOf('const verdict = await postmarkVerdict'));
    assert.match(probe, /still not proof of arrival/);
    assert.doesNotMatch(probe.slice(0, 1600), /PASS - (the message |it )?arrived/);
  });

  test('the bounce is matched on the recipient AND the time', () => {
    // Matching the address alone would report last week's bounce as this
    // message's - a confident wrong answer that costs an afternoon.
    const fn = source.slice(source.indexOf('async function postmarkVerdict'));
    assert.match(fn, /String\(bounce\.Email \?\? ''\)\.toLowerCase\(\) === PROBE\.toLowerCase\(\)/);
    assert.match(fn, /Date\.parse\(bounce\.BouncedAt \?\? ''\) >= sentAt/);
  });

  test('it needs no credential it did not already have', () => {
    // Postmark's SMTP password IS the Server API Token, so the bounce lookup
    // adds no configuration and no second secret to hold.
    const fn = source.slice(source.indexOf('async function postmarkVerdict'));
    assert.match(fn, /'X-Postmark-Server-Token': pass/);
    assert.doesNotMatch(fn, /process\.env\.POSTMARK/);
  });

  test('it does not claim to have checked a provider it cannot ask', () => {
    const fn = source.slice(source.indexOf('async function postmarkVerdict'));
    assert.match(fn, /notPostmark/);
    assert.match(fn, /checked: false/);
  });

  test('the pending-approval code gets named, because the message alone is not enough', () => {
    assert.match(source, /verdict\.code === 100007/);
    assert.match(source, /NOTHING can reach a real/);
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
    /*
     * Proves the guard is about the ADDRESS and not about the provider: with a
     * real From it stops being a From problem and the run goes on to connect.
     *
     * This used to assert `code !== 1`, which passed for a reason that had
     * nothing to do with the From header: nodemailer was not installed, so the
     * run ended at CANNOT CHECK with exit 3 before it could reach a network
     * failure. Installing it made the same correct behavior fail the test.
     *
     * So the assertion is on the OUTPUT, which is where the distinction
     * actually lives. Refusing a bad From and failing to reach a fake server
     * are both exit 1, and an exit code cannot tell them apart.
     */
    const { out } = run({
      SMTP_HOST: 'smtp.resend.com',
      SMTP_USER: 'resend',
      SMTP_PASSWORD: 're_not_a_real_key',
      SMTP_FROM: 'coach@coachdiaz.app',
    });
    assert.doesNotMatch(out, /not an email address/, 'a valid From was reported as a From failure');
    assert.match(
      out,
      /refused the connection|CANNOT CHECK/,
      'the run did not get past the From guard at all'
    );
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

describe('the mail this check does not cover', () => {
  const script = readFileSync(new URL('../../scripts/check-smtp.mjs', import.meta.url), 'utf8');

  test('it names the signup path it cannot see, on every successful run', () => {
    /*
     * ── WHY A PASS HERE IS NOT A PASS FOR MAIL ────────────────────────────
     *
     * This script checks the APPLICATION's transport, which carries one
     * message: the guardian consent link. Address confirmation and password
     * reset go through Supabase Auth's own SMTP setting, in a dashboard this
     * script cannot read.
     *
     * On 2026-09-10 that setting was empty, so every confirmation this product
     * has ever sent went through Supabase's built-in service - two per hour,
     * no delivery SLA, documented as not for production. It has worked for
     * seven signups over seventeen days and has never been asked for two in an
     * hour.
     *
     * A green PASS over that is the same shape of failure this file already
     * exists to prevent: the probe section was written because a PASS covered
     * a Postmark account that could not mail a single real user. So the
     * uncovered half is printed rather than remembered.
     */
    assert.match(script, /THIS DOES NOT COVER SIGNUP MAIL/);
    assert.match(script, /Project Settings -> Authentication -> SMTP Settings/);
  });

  test('the notice is printed on the PASS path, not only defined', () => {
    // A constant nobody logs is a comment with extra steps, and this codebase
    // has shipped exactly that before.
    const at = script.indexOf('await transport.verify();');
    assert.notEqual(at, -1);
    assert.match(script.slice(at, at + 400), /console\.log\(AUTH_MAIL_NOTICE\)/);
  });

  test('it does not claim to have checked what it has not', () => {
    // The sentence that matters: this says the guardian link can go out, and
    // says nothing about whether anybody can create an account.
    assert.match(script, /says nothing about\\n' \+\s*'whether anybody can create an account/);
  });
});

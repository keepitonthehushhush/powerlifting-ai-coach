import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, readRaw, flatten } from './helpers/source.js';

import { POLICY_VERSIONS } from '../src/lib/policyVersions.js';

const mailer = readSource(new URL('../src/lib/mailer.js', import.meta.url));
const script = readFileSync(new URL('../../scripts/send-policy-notice.mjs', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../supabase/migrations/0063_a_record_of_what_we_told_you_we_changed.sql', import.meta.url),
  'utf8'
);
/**
 * The migration with its comments stripped.
 *
 * readSource() exists for exactly this and does not cover SQL. Both halves of
 * that lesson were re-learned here: a check for a `body` column matched the
 * word "nobody" in a comment, and a check that the unique constraint EXISTS was
 * satisfied by the comment above it explaining why the constraint matters -
 * so deleting the constraint left the test green. Structural assertions read
 * this; assertions about the prose read `migration`.
 */
const migrationSql = migration.replace(/--.*$/gm, '');
const checkSmtp = readFileSync(new URL('../../scripts/check-smtp.mjs', import.meta.url), 'utf8');

/**
 * The second message this product sends.
 *
 * ── WHY THERE IS ONE AT ALL ───────────────────────────────────────────────
 *
 * Three accounts hold consent recorded against policy versions that no longer
 * exist. The app already refuses to let them past the consent screen - but
 * only if they come back, and nothing could tell them to. An obligation that
 * depends on somebody happening to return is not an obligation being met.
 */
describe('the policy-change notice', () => {
  test('mailer.js still exports two named sends and no general one', () => {
    /*
     * The file's own rule: adding a kind of mail is a deliberate edit, not a
     * parameter. A `send(kind, data)` or a template lookup is how a health-data
     * product ends up with a function whose possible outputs nobody can
     * enumerate.
     */
    const exported = [...mailer.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
    assert.deepEqual(exported, ['sendGuardianConsentEmail', 'sendPolicyUpdateEmail']);
    assert.doesNotMatch(mailer, /export async function send\(/);
  });

  test('the body is a literal, not built from anything the caller passes', () => {
    // The only interpolated value in the whole message is the version list.
    const body = mailer.slice(mailer.indexOf('function policyUpdateMessage'), mailer.indexOf('export async function sendPolicyUpdateEmail'));
    const interpolations = [...body.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
    assert.deepEqual(interpolations, ['version'], `the notice interpolates ${interpolations.join(', ')}`);
  });

  test('it carries no link to click, on purpose', () => {
    const body = mailer.slice(mailer.indexOf('function policyUpdateMessage'), mailer.indexOf('export async function sendPolicyUpdateEmail'));
    /*
     * A token would be a new credential travelling by email for no gain, and
     * agreement collected by pressing a button in a message is agreement from
     * whoever holds the inbox, to text they never had to open. It is also the
     * exact shape of a phishing mail about your account terms.
     */
    assert.doesNotMatch(body, /https?:\/\//, 'the notice contains a URL');
    assert.match(flatten(body), /There is no link in this message to click/);
  });

  test('a notice naming no version is refused rather than sent', () => {
    // "Something changed, work out what" is not a notice. The caller has a bug
    // and the recipient would carry the cost of it.
    const fn = mailer.slice(mailer.indexOf('export async function sendPolicyUpdateEmail'));
    assert.match(flatten(fn), /if \(listed\.length === 0\) \{ logger\.warn/);
    assert.ok(fn.indexOf('no_versions') < fn.indexOf('transport()'), 'it builds a transport before it checks');
  });

  test('a failure is never reported as a send', () => {
    const fn = mailer.slice(mailer.indexOf('export async function sendPolicyUpdateEmail'));
    assert.match(fn, /return \{ sent: false, reason: 'send_failed' \}/);
    // The code, not the message: an SMTP error routinely quotes the envelope,
    // and here the envelope is one of our own users.
    assert.doesNotMatch(fn, /err\?\.message/);
  });
});

describe('who has been told, as a fact rather than a memory', () => {
  test('the row is unique per person per notice', () => {
    // This, not any check in the script, is what makes a second run unable to
    // email anybody twice.
    assert.match(migrationSql, /unique \(user_id, notice_key\)/);
  });

  test('the reservation is written before the send is attempted', () => {
    const reserve = script.indexOf('const reservation = await reserve(');
    const send = script.indexOf('await sendPolicyUpdateEmail(');
    assert.ok(reserve > 0 && send > 0);
    assert.ok(reserve < send, 'a timeout mid-send would let a re-run mail the person again');
    // ...and an existing reservation stops before the send rather than after
    // it. Ordering alone would still mail somebody twice if the duplicate
    // check only skipped the bookkeeping.
    /*
     * Scoped to the reservation block itself, not to everything between the
     * two calls. The first version was lazy across that whole range and
     * matched the `continue` belonging to the missing-address branch below -
     * so removing the skip entirely, and logging "sending anyway", still
     * passed. A duplicate check that does not stop the send is not a check.
     */
    const guard = script.slice(script.indexOf('if (!reservation) {'));
    const block = guard.slice(0, guard.indexOf('\n    }'));
    assert.match(block, /continue;/, 'a person already told is mailed again');
  });

  test('delivery is recorded separately from the attempt', () => {
    // A row with no delivered_at is a person who was NOT reached. Collapsing
    // the two would make "we tried" indistinguishable from "they know".
    assert.match(migrationSql, /delivered_at timestamptz/);
    const failure = script.slice(script.indexOf('} else {', script.indexOf('if (outcome.sent)')));
    assert.doesNotMatch(failure.slice(0, 400), /markDelivered/);
  });

  test('a duplicate is not reported as a failure', () => {
    // 409 is the constraint doing its job. Exiting non-zero on it would train
    // somebody to re-run with a flag that skips the check.
    assert.match(script, /if \(response\.status === 409\) return null;/);
  });

  test('nobody but the service role can write it', () => {
    // A person who could insert here could forge a record that we had notified
    // them, which is the one direction this table is evidence in.
    assert.match(migrationSql, /grant select on public\.policy_notice_emails to authenticated;/);
    assert.match(migrationSql, /revoke insert, update, delete on public\.policy_notice_emails/);
    assert.doesNotMatch(migrationSql, /grant (insert|update|all)[^;]*to authenticated/);
  });

  test('it holds no address and no message body', () => {
    /*
     * The column names, with the SQL comments stripped first.
     *
     * The first version of this asserted against the raw slice and failed on
     * the word "nobody" in a comment explaining the constraint. Same defect
     * readSource() exists for, in a file type that helper does not cover: a
     * regex written against the meaning of a file, defeated by its prose.
     */
    const table = migrationSql.slice(
      migrationSql.indexOf('create table'),
      migrationSql.indexOf('comment on table')
    );
    // Digits allowed in the name on purpose: `notice_key2` must be REPORTED as
    // an unexpected column, not skipped by a pattern that cannot spell it.
    const columns = [...table.matchAll(/^\s{2}([a-z_][a-z0-9_]*)\s+[a-z]/gm)].map((m) => m[1]);

    assert.deepEqual(columns.sort(), [
      'created_at',
      'delivered_at',
      'id',
      'message_id',
      'notice_key',
      'user_id',
    ]);
    // Named rather than pattern-matched, so adding one is a decision somebody
    // makes here rather than a regex somebody widens.
    for (const forbidden of ['email', 'address', 'message_body', 'subject', 'recipient']) {
      assert.ok(!columns.includes(forbidden), `the table holds a ${forbidden} column`);
    }
  });

  test('and it is in the subject access request', () => {
    const account = readSource(new URL('../src/routes/account.js', import.meta.url));
    assert.match(account, /from\('policy_notice_emails'\)/);
    assert.match(account, /policy_notice_emails: policyNotices\.data \?\? \[\]/);
  });
});

describe('the script refuses more than it does', () => {
  test('there is no "everybody" mode', () => {
    assert.match(flatten(script), /There is no "everybody" mode, deliberately/);
    assert.doesNotMatch(script, /--all\b/);
  });

  test('naming the accounts is not enough; --send is a second decision', () => {
    // The failure mode of an emailing script is not "it did not work". It is
    // "it worked, on the wrong list", and there is no undo.
    assert.match(script, /const SEND = has\('--send'\);/);
    const dry = script.slice(script.indexOf('if (!SEND) {'));
    assert.match(dry.slice(0, 600), /DRY RUN - nothing has been sent/);
    assert.ok(script.indexOf('if (!SEND) {') < script.indexOf('await import(\'../server/src/lib/mailer.js\')'));
  });

  test('an account that is already current is refused, not mailed', () => {
    assert.match(flatten(script), /already on the current versions, so there is nothing to tell them/);
  });

  test('the versions come from the same constant the app gates on', () => {
    // A second list would drift, and the drift would show up as an email to
    // somebody who did not need one.
    assert.match(script, /import \{ POLICY_VERSIONS \} from '\.\.\/server\/src\/lib\/policyVersions\.js'/);
    assert.ok(Object.keys(POLICY_VERSIONS).length >= 4);
  });

  test('"latest" means the highest seq, not the last row it happened to read', () => {
    // consent_records is append-only and two rows can share a created_at.
    assert.match(script, /order=seq\.asc/);
  });

  test('a withdrawn consent is not treated as one to renew', () => {
    assert.match(script, /!row\.granted/);
  });

  test('it exits non-zero when anybody named was not reached', () => {
    // Run by a person, read in a scrollback. "Some of them" must not look
    // like success.
    assert.match(flatten(script), /if \(sent !== targets\.length\) process\.exit\(1\)/);
  });

  test('the address is fetched and never stored or printed', () => {
    const fn = script.slice(script.indexOf('async function addressOf'), script.indexOf('async function reserve'));
    assert.doesNotMatch(fn, /console\./, 'the lookup logs');

    // The address lives in one variable. Assert on THAT rather than on any
    // line containing the word "to" - the first version of this matched
    // "Send to one of them with:" and reported a leak that was punctuation.
    assert.doesNotMatch(script, /\$\{to\}/, 'the address is interpolated into output');
    assert.doesNotMatch(script, /body: JSON\.stringify\([^)]*\bto\b[^)]*\)/, 'the address is written to a row');
  });
});

describe('proving the transport without a real parent', () => {
  test('the probe is opt-in and names its own recipient', () => {
    // Never defaulted: a default recipient eventually becomes somebody else.
    assert.match(checkSmtp, /const probeIndex = process\.argv\.indexOf\('--probe'\)/);
    assert.match(checkSmtp, /if \(probeIndex !== -1 && !isSendableFrom\(PROBE\)\)/);
  });

  test('without it, nothing is sent', () => {
    const success = checkSmtp.slice(checkSmtp.indexOf('await transport.verify();'));
    const noProbe = success.slice(success.indexOf('if (!PROBE) {'), success.indexOf('const info = await transport.sendMail'));
    assert.match(noProbe, /No message was sent/);
    assert.ok(noProbe.indexOf('process.exit(0)') > 0, 'it falls through to the send');
  });

  test('it says why verify() alone is not enough', () => {
    // Postmark accepts the login of a server whose Sender Signature is
    // unconfirmed and refuses the send with a 422. A green PASS here has
    // always been compatible with every message failing.
    assert.match(flatten(checkSmtp), /Sender Signature not defined for/);
    assert.match(flatten(checkSmtp), /err\?\.responseCode === 422/);
  });

  test('accepted is not reported as arrived', () => {
    assert.match(flatten(checkSmtp), /ACCEPTED IS NOT ARRIVED/);
  });

  test('the probe message says what it is', () => {
    // Somebody may find this months later with no memory of running it, and a
    // mystery message from a coaching service would be alarming.
    const probe = checkSmtp.slice(checkSmtp.indexOf('subject: \'Coach Diaz: SMTP probe\''));
    assert.match(flatten(probe.slice(0, 700)), /This is a test message/);
    assert.match(flatten(probe.slice(0, 700)), /you can ignore and delete it/);
  });

  test('the diagnostic send does not live in mailer.js', () => {
    // A "send arbitrary text to an arbitrary address" function in that file
    // would undo the reason it is shaped the way it is.
    assert.doesNotMatch(mailer, /probe/i);
  });
});

describe('the runbook says how to do this', () => {
  const runbook = readRaw(new URL('../../docs/runbooks/daily-deployment-check.md', import.meta.url));

  test('the order is prove the transport, then write to a person', () => {
    assert.match(runbook, /--probe/);
    assert.match(runbook, /policy:notice/);
    assert.ok(
      runbook.indexOf('--probe') < runbook.indexOf('policy:notice'),
      'the runbook has somebody emailing users before proving mail works'
    );
  });
});

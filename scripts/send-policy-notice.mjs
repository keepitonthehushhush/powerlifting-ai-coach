#!/usr/bin/env node
/**
 * Tell named people that a policy they agreed to has changed.
 *
 * ── WHY THIS IS A SCRIPT AND NOT A ROUTE OR A CRON ────────────────────────
 *
 * Because the decision to write to somebody is a decision, and it should be
 * made by a person who then watches it happen. A scheduled job that emails
 * users is a thing that emails users at three in the morning when a policy
 * version is bumped by a typo fix, and the first anybody hears of it is a
 * reply. This runs when somebody runs it, to the accounts they named.
 *
 * ── AND WHY IT REFUSES TO SEND UNLESS YOU SAY SO TWICE ────────────────────
 *
 * `--send` is required on top of naming the accounts, and without it this
 * prints exactly what it would do and exits. The reason is that the failure
 * mode of an emailing script is not "it did not work" - it is "it worked, on
 * the wrong list, and cannot be undone". There is no undo for a sent message
 * and no version of this that is worth being clever about.
 *
 * `--list` needs no ids at all: it reports who is on a superseded version, so
 * the ids you pass are read off a real query rather than remembered.
 *
 * ── THE SAFETY PROPERTY IS IN THE DATABASE, NOT IN THIS FILE ──────────────
 *
 * The row in policy_notice_emails is inserted BEFORE the message is attempted,
 * and (user_id, notice_key) is unique. So a second run - after a timeout, in
 * another terminal, by somebody who did not see the first finish - collides on
 * the constraint and sends nothing. Every guard in this script could be wrong
 * and a person still could not receive the same notice twice.
 *
 * The cost of that ordering is the honest one: a send that fails leaves a row
 * saying we tried and no delivered_at. That is why there are two columns. A
 * row with no delivered_at is a person who was NOT reached, which is a fact
 * worth being able to see, and `--retry` is deliberately not implemented -
 * decide what happened before you send again.
 *
 * ── WHAT IT NEEDS ─────────────────────────────────────────────────────────
 *
 *   SUPABASE_URL, SUPABASE_SECRET_KEY   to read who is stale and their address
 *   SMTP_HOST / _PORT / _USER / _PASSWORD / _FROM   to send
 *
 * All of them are in .env at the repository root, which is gitignored. This
 * reads the environment rather than parsing that file:
 *
 *   set -a; source .env; set +a; node scripts/send-policy-notice.mjs --list
 */

import 'dotenv/config';

import { POLICY_VERSIONS } from '../server/src/lib/policyVersions.js';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const userIds = args
  .map((arg, index) => (arg === '--user' ? args[index + 1] : null))
  .filter((value) => typeof value === 'string' && value !== '');

const LIST_ONLY = has('--list');
const SEND = has('--send');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    'send-policy-notice needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.\n' +
      'They are in .env at the repository root. Run it as:\n\n' +
      '  set -a; source .env; set +a; node scripts/send-policy-notice.mjs --list\n'
  );
  process.exit(2);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = userIds.filter((id) => !UUID.test(id));
if (bad.length > 0) {
  console.error(`Not user ids: ${bad.join(', ')}`);
  process.exit(2);
}

if (!LIST_ONLY && userIds.length === 0) {
  console.error(
    'Name the accounts. There is no "everybody" mode, deliberately.\n\n' +
      '  node scripts/send-policy-notice.mjs --list\n' +
      '  node scripts/send-policy-notice.mjs --user <uuid> [--user <uuid>]\n' +
      '  node scripts/send-policy-notice.mjs --user <uuid> --send\n'
  );
  process.exit(2);
}

const rest = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

/**
 * The latest consent each account holds, per type.
 *
 * The ledger is append-only, so "what do they currently agree to" is the
 * highest `seq` per (user_id, consent_type) - not the last row inserted and
 * not `created_at`, which two rows can share.
 */
async function currentConsents() {
  const response = await rest(
    '/rest/v1/consent_records?select=user_id,consent_type,granted,policy_version,seq&order=seq.asc'
  );
  if (!response.ok) throw new Error(`consent_records: ${response.status} ${await response.text()}`);

  const latest = new Map();
  for (const row of await response.json()) {
    latest.set(`${row.user_id}|${row.consent_type}`, row);
  }
  return [...latest.values()];
}

/** Who is on a superseded version of something, and which versions those are. */
function staleByUser(rows) {
  const stale = new Map();
  for (const row of rows) {
    const current = POLICY_VERSIONS[row.consent_type];
    // A type we no longer publish is not a stale agreement to it, and a
    // withdrawn consent is not one to renew.
    if (!current || !row.granted || row.policy_version === current) continue;
    if (!stale.has(row.user_id)) stale.set(row.user_id, []);
    stale.get(row.user_id).push(row.policy_version);
  }
  // Sorted so the notice key is stable whatever order the rows arrived in.
  for (const [id, versions] of stale) stale.set(id, [...new Set(versions)].sort());
  return stale;
}

/** Their own address, from Supabase Auth. Never stored, never logged. */
async function addressOf(userId) {
  const response = await rest(`/auth/v1/admin/users/${userId}`);
  if (!response.ok) return null;
  const user = await response.json();
  return typeof user?.email === 'string' && user.email.includes('@') ? user.email : null;
}

/** Reserve the send. Returns the row id, or null if this notice already exists. */
async function reserve(userId, noticeKey) {
  const response = await rest('/rest/v1/policy_notice_emails', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, notice_key: noticeKey }),
  });
  // 23505 is a unique violation: somebody already ran this. That is the
  // constraint doing its job, not an error to report as a failure.
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(`reserve: ${response.status} ${await response.text()}`);
  const [row] = await response.json();
  return row?.id ?? null;
}

async function markDelivered(id, messageId) {
  await rest(`/rest/v1/policy_notice_emails?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ delivered_at: new Date().toISOString(), message_id: messageId ?? null }),
  });
}

const noticeKeyFor = (versions) => versions.join('+');

async function main() {
  const stale = staleByUser(await currentConsents());

  if (LIST_ONLY) {
    if (stale.size === 0) {
      console.log('Nobody is on a superseded policy version.');
      return;
    }
    console.log(`${stale.size} account(s) on a superseded version:\n`);
    for (const [id, versions] of stale) console.log(`  ${id}  ${versions.join(', ')}`);
    console.log('\nCurrent versions:');
    for (const [type, version] of Object.entries(POLICY_VERSIONS)) console.log(`  ${type}: ${version}`);
    console.log('\nSend to one of them with:  --user <uuid> --send');
    return;
  }

  // Named but not stale is almost always a copied id or a stale terminal.
  // Refusing beats sending somebody a notice about nothing.
  const targets = userIds.map((id) => ({ id, versions: stale.get(id) ?? [] }));
  const notStale = targets.filter((t) => t.versions.length === 0);
  if (notStale.length > 0) {
    console.error(
      `These accounts are already on the current versions, so there is nothing to tell them:\n` +
        notStale.map((t) => `  ${t.id}`).join('\n')
    );
    process.exit(2);
  }

  if (!SEND) {
    console.log('DRY RUN - nothing has been sent and nothing has been recorded.\n');
    for (const { id, versions } of targets) {
      console.log(`  ${id}`);
      console.log(`    superseded: ${versions.join(', ')}`);
      console.log(`    notice key: ${noticeKeyFor(versions)}`);
    }
    console.log('\nAdd --send to actually send this.');
    return;
  }

  // Imported here and not at the top: --list and a dry run must work on a
  // machine with no SMTP configured, which is every machine until somebody
  // fills in .env.
  const { sendPolicyUpdateEmail } = await import('../server/src/lib/mailer.js');

  let sent = 0;
  for (const { id, versions } of targets) {
    const noticeKey = noticeKeyFor(versions);
    const reservation = await reserve(id, noticeKey);
    if (!reservation) {
      console.log(`${id}: already told about ${noticeKey}. Skipped.`);
      continue;
    }

    const to = await addressOf(id);
    if (!to) {
      console.error(`${id}: no address on the account. Row reserved, nothing sent.`);
      continue;
    }

    const outcome = await sendPolicyUpdateEmail({ to, versions });
    if (outcome.sent) {
      await markDelivered(reservation, outcome.messageId);
      sent += 1;
      console.log(`${id}: sent.`);
    } else {
      // No delivered_at. The row says we tried and did not reach them, which
      // is the fact somebody needs later.
      console.error(`${id}: NOT sent (${outcome.reason}). Row reserved with no delivery.`);
    }
  }

  console.log(`\n${sent} of ${targets.length} sent.`);
  // Non-zero when anybody named was not reached: this is run by a person, and
  // "some of them" must not look like success in a scrollback.
  if (sent !== targets.length) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

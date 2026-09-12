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
 * `--check` is the step before all of that: it resolves each address and
 * reports whether this credential can see it, reserving nothing and sending
 * nothing. Run it first. The first irreversible thing --send does is write a
 * reservation, and finding out your key is wrong on the far side of that costs
 * somebody their one notice.
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
/* Reads only. Proves the credential can see addresses before anything is
   reserved, which is the question --send could not answer until afterwards. */
const CHECK_ONLY = has('--check');
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
  /*
   * ── WHY AN EMAIL ADDRESS GETS ITS OWN SENTENCE ────────────────────────────
   *
   * Because it is what a person reaches for. The first real attempt at this
   * script was `--user eddydiaz10@gmail.com --send`, which is the obvious
   * thing to type and got back "Not user ids: eddydiaz10@gmail.com" - correct,
   * unhelpful, and indistinguishable from a typo in a uuid.
   *
   * The refusal itself stays. An address is a SECOND way to name a person, and
   * the failure mode of a second way is mistyping one character of somebody
   * else's address and writing to them instead - against a table keyed by
   * user_id, which would then record the notice against the wrong account.
   * The id comes off a real query; that is the whole point of --list.
   */
  const addresses = bad.filter((value) => value.includes('@'));
  if (addresses.length > 0) {
    console.error(
      'This takes the ACCOUNT ID, not an email address.\n\n' +
        'The address is looked up from the account at send time, so naming one here would be\n' +
        'a second way to say who you mean - and one mistyped character would write to somebody\n' +
        'else while recording it against the account you named.\n\n' +
        'Get the ids from:\n\n' +
        '  npm run policy:notice -- --list\n'
    );
    process.exit(2);
  }
  console.error(`Not user ids: ${bad.join(', ')}`);
  process.exit(2);
}

/*
 * --check with no ids checks everybody who is stale, which is safe for the
 * reason --send can never be: it reads. There is still no "everybody" mode for
 * sending, and there is not going to be one.
 */
if (!LIST_ONLY && !CHECK_ONLY && userIds.length === 0) {
  console.error(
    'Name the accounts. There is no "everybody" mode for sending, deliberately.\n\n' +
      '  node scripts/send-policy-notice.mjs --list\n' +
      '  node scripts/send-policy-notice.mjs --check                  (reads only, reserves nothing)\n' +
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

/**
 * Their own address, from Supabase Auth. Never stored, never logged.
 *
 * ── IT SAYS WHICH OF TWO THINGS WENT WRONG, BECAUSE IT USED TO SAY ONE ────
 *
 * This returned `null` for a refused request and for an account with no
 * address, and the caller printed "no address on the account" either way.
 * Every account in this database has a confirmed address, so that sentence
 * could only ever have been the wrong one - it sends somebody to look at a
 * user record when the problem is a key, a URL, or a permission.
 *
 * `reason` carries the HTTP status. The BODY is deliberately not read: an
 * error body from the auth admin API can quote the record it was asked about.
 */
async function addressOf(userId) {
  const response = await rest(`/auth/v1/admin/users/${userId}`);
  if (!response.ok) {
    return {
      email: null,
      reason: response.status === 401 || response.status === 403
        ? `the admin API refused this key (HTTP ${response.status}) - SUPABASE_SECRET_KEY must be the SECRET key, not the publishable one`
        : `the admin API answered HTTP ${response.status}`,
    };
  }
  const user = await response.json();
  const email = typeof user?.email === 'string' && user.email.includes('@') ? user.email : null;
  return { email, reason: email ? null : 'the account really has no address on it' };
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

  /*
   * ── --check: CAN THIS SCRIPT REACH THEM AT ALL ────────────────────────────
   *
   * Reads, and does nothing else. No reservation, no send, no row.
   *
   * It exists because the first thing --send does that cannot be taken back is
   * write a reservation, and until this existed there was no way to find out
   * beforehand whether the credential could even read an address. The honest
   * order of operations is: prove you can reach people, then decide to write
   * to them - not discover the credential is wrong by spending somebody's
   * only notice on it.
   *
   * It prints the DOMAIN and never the address. Knowing the script can see a
   * gmail.com address for an account is the whole question; the local part is
   * somebody's name and this is a terminal that ends up in a screenshot.
   */
  if (CHECK_ONLY) {
    const ids = userIds.length > 0 ? userIds : [...stale.keys()];
    if (ids.length === 0) {
      console.log('Nobody is on a superseded policy version, so there is nothing to check.');
      return;
    }
    let reachable = 0;
    for (const id of ids) {
      const { email, reason } = await addressOf(id);
      if (email) {
        reachable += 1;
        console.log(`  ${id}  OK  (@${email.split('@')[1]})`);
      } else {
        console.error(`  ${id}  UNREACHABLE  ${reason}`);
      }
    }
    console.log(`\n${reachable} of ${ids.length} reachable. Nothing was reserved and nothing was sent.`);
    if (reachable > 0) {
      console.log('\nThe address is only half of it. `npm run check:smtp -- --probe you@example.com`');
      console.log('proves the transport can actually deliver to an address outside coachdiaz.app.');
    }
    if (reachable !== ids.length) process.exit(1);
    return;
  }

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

    /*
     * ── THE READ HAPPENS BEFORE THE RESERVATION, AND THE SEND AFTER IT ────
     *
     * Looking up an address is a READ. It changes nothing, it can be repeated,
     * and it fails for reasons that have nothing to do with this person - a
     * wrong key, a typo in the URL, an auth API having a bad minute.
     *
     * It used to happen after the reservation, so any of those spent this
     * account's one notice on a request that never left the building. There
     * is no --retry, by design, so the cost of that ordering was: the people
     * most in need of the message become the people who can no longer be sent
     * it, and the printed reason blamed their user record.
     *
     * The safety property is untouched. The reservation still happens BEFORE
     * the send and (user_id, notice_key) is still unique, so a second run
     * cannot deliver a second copy. What moved is a read, out in front of it.
     */
    const { email: to, reason } = await addressOf(id);
    if (!to) {
      console.error(`${id}: ${reason}. Nothing reserved, nothing sent.`);
      continue;
    }

    const reservation = await reserve(id, noticeKey);
    if (!reservation) {
      console.log(`${id}: already told about ${noticeKey}. Skipped.`);
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
  /*
   * `fetch failed` is what Node says when a host does not resolve, and on its
   * own it sends somebody to read this script rather than to check their
   * network or their SUPABASE_URL. Name the likely cause; keep the original
   * underneath, because a guess printed as a fact is its own problem.
   */
  if (err?.message === 'fetch failed' || err?.cause?.code === 'EAI_AGAIN' || err?.cause?.code === 'ENOTFOUND') {
    console.error(
      `Could not reach ${process.env.SUPABASE_URL ?? 'SUPABASE_URL'}.\n` +
        'Nothing was read, reserved or sent. Check the URL and that this machine has a\n' +
        `route to it - some sandboxes do not.\n\nUnderlying error: ${err.message}`
    );
    process.exit(1);
  }
  console.error(err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * The way back in when somebody loses their authenticator.
 *
 * ── WHY THIS HAD TO EXIST BEFORE MFA WAS TURNED ON ────────────────────────
 *
 * Supabase requires an aal2 session to unenroll a factor. That is correct -
 * otherwise an attacker with a stolen password could simply remove the second
 * factor - and it means the person who lost their phone cannot undo it
 * themselves. There are no built-in recovery codes for TOTP.
 *
 * So the only way back in runs through the operator and the service-role key.
 * Writing the lockout into a migration comment without also writing the way
 * out would have been shipping a door that locks from the inside.
 *
 * ── WHY IT REFUSES TO GUESS ───────────────────────────────────────────────
 *
 * It takes an email, prints exactly what it found, and does nothing until it
 * is run again with --confirm. Removing somebody's second factor is the one
 * operation in this repository that makes an account easier to break into,
 * and a script that does it on a typo is worse than no script.
 *
 * ── AND WHY IT WRITES AN AUDIT ROW ────────────────────────────────────────
 *
 * Because "the operator removed a security control from an account" is
 * precisely the event that must not be invisible, including to the operator's
 * future self reading the table and wondering.
 *
 * USAGE
 *   node scripts/mfa-recovery.mjs somebody@example.com            # look
 *   node scripts/mfa-recovery.mjs somebody@example.com --confirm  # remove
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment. Never commit
 * either; never paste the secret key into a chat, a log, or another machine.
 */

import { createClient } from '@supabase/supabase-js';

const email = process.argv[2];
const CONFIRMED = process.argv.includes('--confirm');

if (!email || email.startsWith('--')) {
  console.error('Usage: node scripts/mfa-recovery.mjs <email> [--confirm]');
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error(
    'SUPABASE_URL and SUPABASE_SECRET_KEY must be set.\n' +
      'They are not in this repository and must not be. Load them from the\n' +
      'environment you keep them in and run this again.'
  );
  process.exit(2);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

/**
 * Find exactly one account, or refuse.
 *
 * listUsers is paged and there is no exact-email lookup in the admin API, so
 * this walks pages and matches case-insensitively. It refuses on more than one
 * match rather than picking - two accounts differing only by case is a state
 * worth stopping on, not resolving quietly.
 */
async function findUser(address) {
  const wanted = address.trim().toLowerCase();
  const matches = [];
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`could not list users: ${error.message}`);
    const users = data?.users ?? [];
    matches.push(...users.filter((u) => (u.email ?? '').toLowerCase() === wanted));
    if (users.length < 200) break;
  }
  if (matches.length === 0) throw new Error(`no account with the address ${address}`);
  if (matches.length > 1) {
    throw new Error(`${matches.length} accounts share that address; resolve that first`);
  }
  return matches[0];
}

const user = await findUser(email);
const factors = user.factors ?? [];

console.log(`\naccount   ${user.email}`);
console.log(`id        ${user.id}`);
console.log(`created   ${user.created_at}`);
console.log(`factors   ${factors.length}`);

for (const factor of factors) {
  console.log(
    `          - ${factor.factor_type} ${factor.status.padEnd(10)} ` +
      `${factor.friendly_name ?? '(no name)'}  id=${factor.id}`
  );
}

if (factors.length === 0) {
  console.log('\nNothing to remove. This account has no second factor, so the');
  console.log('lockout is something else - check the sign-in flow, not MFA.');
  process.exit(0);
}

if (!CONFIRMED) {
  console.log('\nNOTHING HAS BEEN CHANGED.');
  console.log('Removing these makes the account reachable with the password alone.');
  console.log('Confirm the person is who they say they are FIRST - this script');
  console.log('cannot do that part and neither can the database.');
  console.log('\nWhen you are sure:');
  console.log(`  node scripts/mfa-recovery.mjs ${email} --confirm\n`);
  process.exit(0);
}

let removed = 0;
for (const factor of factors) {
  const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id });
  if (error) {
    console.error(`FAILED to remove ${factor.id}: ${error.message}`);
    continue;
  }
  removed += 1;
  console.log(`removed   ${factor.id}`);
}

/*
 * The audit row is written with the service-role client, which bypasses RLS -
 * that is the point, since the subject of the row is not the caller. `actor`
 * says operator rather than naming a person, because the only identity this
 * script can prove is "whoever held the key".
 */
const { error: auditError } = await admin.from('audit_events').insert({
  user_id: user.id,
  action: 'mfa_factor_removed',
  actor: 'operator',
  // Two numbers and nothing else. They differ when a delete failed partway,
  // which is the state somebody reading this back would need to know about.
  // No email, no secret, and not the friendly name - "phone in pocket" is
  // somebody's words about their own device.
  detail: { found: factors.length, removed },
});

if (auditError) {
  console.error(`\nWARNING: factors were removed but the audit row failed: ${auditError.message}`);
  console.error('Record this by hand. An unlogged security change is the thing');
  console.error('this row exists to prevent.');
  process.exit(1);
}

console.log(`\nDone. ${removed} of ${factors.length} removed, and it is in audit_events.`);
console.log('Tell them to sign in and enroll again from the account page.');

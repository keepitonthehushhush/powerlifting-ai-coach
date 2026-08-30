#!/usr/bin/env node
/**
 * Does the address in the Terms still receive mail?
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Because it is always DNS.
 *
 * That is a joke in the trade because it is true often enough to be a
 * heuristic, and it matters more here than it usually does. The Terms commit
 * to deleting an account when a parent tells us it belongs to a minor. That
 * commitment is now carried by MX records at a third-party forwarder, and MX
 * records fail in the worst possible way: silently, invisibly, and only
 * detectably by somebody trying to reach you - who, by definition, is a person
 * we have told to reach us and who now cannot.
 *
 * A registrar change, a nameserver migration, a free-tier forwarder ageing out
 * an unverified domain, a DNSSEC misconfiguration, an accidental record edit
 * while adding something unrelated - every one of those takes the address down
 * without touching the site, and the site keeps confidently printing it.
 *
 * So the route gets the same treatment as every other silent failure in this
 * codebase: something that checks it, and a reason written next to the check.
 * See lib/contact.js - CONTACT_LIVE is supposed to record a fact. This is how
 * the fact gets re-established rather than assumed to still be true.
 *
 * ── WHAT IT CAN AND CANNOT PROVE ──────────────────────────────────────────
 *
 * It proves the domain still advertises somewhere to deliver mail, and that
 * the somewhere is the forwarder we configured. It CANNOT prove a message
 * arrives in a human's inbox - the forwarder could be suspended, the
 * destination mailbox full, the mail landing in spam. Only sending a real
 * message proves that, which is why the runbook asks for one periodically
 * rather than treating this script as the whole answer.
 */

import { resolveMx, resolveTxt } from 'node:dns/promises';
import { readFileSync } from 'node:fs';

const contactSource = readFileSync(
  new URL('../web/src/lib/contact.js', import.meta.url),
  'utf8'
);

const email = /CONTACT_EMAIL = '([^']+)'/.exec(contactSource)?.[1];
const live = /CONTACT_LIVE = (true|false)/.exec(contactSource)?.[1] === 'true';

if (!email) {
  console.error('Could not read CONTACT_EMAIL out of web/src/lib/contact.js.');
  process.exit(2);
}

const domain = email.split('@')[1];
console.log(`Contact address: ${email}`);
console.log(`Documents print it: ${live ? 'yes' : 'no (CONTACT_LIVE is false)'}\n`);

/**
 * ── "NO MX RECORD" AND "COULD NOT ASK" ARE NOT THE SAME ANSWER ────────────
 *
 * This script used to treat every DNS error as proof the address was dead, and
 * printed "Mail to the address in the Terms is going nowhere" with a
 * recommendation to set CONTACT_LIVE to false.
 *
 * Run on 2026-08-30 from a sandbox with no DNS egress it said exactly that,
 * for a domain whose MX records were live and correct - verified from another
 * machine seconds later:
 *
 *     ECONNREFUSED  ->  "FAIL - no usable MX record for coachdiaz.app"
 *
 * Acting on that would have removed a WORKING contact route from the Terms,
 * which is the opposite of the harm this check exists to prevent - and it
 * would have been done on the authority of a check that never reached a
 * resolver.
 *
 * Third time in one day a check here has answered confidently without looking:
 * the deployment probe read a proxy error as "captcha not required", the export
 * completeness test matched a different endpoint, and this. So the answer is
 * three-valued, like the others.
 *
 * ENOTFOUND and ENODATA are real answers from a resolver that looked: the
 * domain has no MX. Everything else - refused, timed out, SERVFAIL, EAI_AGAIN -
 * means the question was never asked, and the honest output is "unknown".
 */
const ANSWERED = new Set(['ENOTFOUND', 'ENODATA']);

let failed = false;
let unknown = false;

try {
  const mx = await resolveMx(domain);
  if (mx.length === 0) {
    const empty = new Error('the domain resolves but advertises no MX');
    empty.code = 'ENODATA';
    throw empty;
  }
  mx.sort((a, b) => a.priority - b.priority);
  console.log('MX records:');
  for (const r of mx) console.log(`  ${String(r.priority).padStart(3)}  ${r.exchange}`);
  console.log('\nPASS - the domain still advertises somewhere to deliver mail.');
} catch (error) {
  if (ANSWERED.has(error.code)) {
    failed = true;
    console.error(`FAIL - no usable MX record for ${domain}: ${error.message}`);
    console.error(
      '\nMail to the address in the Terms is going nowhere. Either fix the DNS, or set\n' +
        'CONTACT_LIVE to false in web/src/lib/contact.js and deploy - the documents will\n' +
        'fall back to the Account-page route rather than printing an address that bounces.'
    );
  } else {
    unknown = true;
    console.error(
      `UNKNOWN - could not reach a DNS resolver for ${domain}: ${error.code ?? error.message}\n\n` +
        'THE CHECK DID NOT RUN. This says nothing about whether the address works, and\n' +
        'is not a reason to change CONTACT_LIVE. Usually a sandbox, a VPN or a captive\n' +
        'network with no DNS egress - re-run it from a machine with ordinary internet\n' +
        'access before believing anything about the contact route.'
    );
  }
}

// SPF is not required for RECEIVING mail, so its absence is a warning rather
// than a failure. It is checked because a forwarder that has lost its SPF
// record is usually a forwarder whose setup has been partially undone.
try {
  const txt = (await resolveTxt(domain)).flat().join(' ');
  if (/v=spf1/i.test(txt)) console.log('SPF record present.');
  else console.warn('WARNING - no SPF record. Receiving still works; check the forwarder setup.');
} catch {
  console.warn('WARNING - could not read TXT records.');
}

if (live && failed) {
  console.error('\nThe documents are printing an address that cannot receive mail.');
  process.exit(1);
}
// A distinct exit code, so CI can tell "this is broken" from "I could not
// look". Treating the second as a pass would make the check decorative;
// treating it as a failure would make a network blip look like an outage.
if (unknown) process.exit(3);
if (!live && !failed) {
  console.log(
    '\nNote: the DNS is working but CONTACT_LIVE is false, so nothing prints the address.\n' +
      'Send a real test message, confirm it arrives, then set the flag to true.'
  );
}
process.exit(failed ? 1 : 0);

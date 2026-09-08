#!/usr/bin/env node
/**
 * Does the mail actually go?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * There is exactly one outbound message in this product: a guardian consent
 * link, sent when somebody aged 13-17 signs up. `mailer.js` reports an
 * unconfigured or failing transport honestly - to the CALLER, at the moment of
 * a send. Which means the first person who can discover that SMTP is wrong is
 * a parent who never received the mail, about a child who is waiting, and the
 * athlete sees "we have sent it" either way.
 *
 * Nothing else in this product would ever notice. Guardian requests are rare
 * by construction, so the gap between "SMTP broke" and "somebody found out"
 * has no upper bound.
 *
 * So: a check that connects and authenticates on demand, without sending
 * anything to anybody. `transporter.verify()` opens the connection, runs the
 * handshake and the AUTH exchange, and closes it.
 *
 * ── THREE OUTCOMES, NOT TWO ─────────────────────────────────────────────────
 *
 * Same rule as the safety evaluation. "Not configured" and "configured and
 * refusing" are different mornings and must not share an exit code:
 *
 *   0  works       - connected and authenticated.
 *   1  broken      - configured, and the server would not take it. This is the
 *                    one that means guardian mail is silently dead right now.
 *   3  unconfigured- no SMTP_HOST/USER/PASSWORD. Correct and expected locally
 *                    and in every test run; a problem only in production, and
 *                    the caller decides which of those it is. `--require`
 *                    turns it into a failure for the production runbook.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 *
 * It does not send a message. A check that mails somebody to prove mail works
 * needs a recipient, and the only addresses this product holds belong to
 * athletes and to guardians who never signed up for anything.
 *
 * It prints the host and the port. It does not print the user and it can not
 * print the password: this is run against a shell that has production
 * credentials in it, and a check that echoes a secret into a terminal - or
 * into CI output - is a worse defect than the one it is looking for.
 */

/*
 * IMPORTED LAZILY, BELOW, AND ONLY WHEN THERE IS SOMETHING TO CHECK.
 *
 * A check that cannot tell you mail is unconfigured without a mail library
 * installed is a check that fails on the machine most likely to be missing
 * both. `nodemailer` is a root dependency and present wherever the server
 * runs; it is absent on the device VM, whose node_modules is a partial copy.
 * Loading it at the top made the unconfigured path - the common one, and the
 * one that must always work - die on a module-resolution stack trace.
 */

import { isSendableFrom } from '../server/src/lib/mailFrom.js';

const REQUIRE = process.argv.includes('--require');

const host = (process.env.SMTP_HOST ?? '').trim();
const user = (process.env.SMTP_USER ?? '').trim();
const pass = process.env.SMTP_PASSWORD ?? '';
const port = Number.parseInt(process.env.SMTP_PORT ?? '587', 10);

if (!host || !user || !pass) {
  const missing = [
    !host && 'SMTP_HOST',
    !user && 'SMTP_USER',
    !pass && 'SMTP_PASSWORD',
  ].filter(Boolean);

  const line = `NOT CONFIGURED - ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} unset.`;

  if (REQUIRE) {
    console.error(`FAIL - ${line}`);
    console.error(
      '\nRun with --require only where mail MUST work. A guardian consent request\n' +
        'will return `email_unavailable` and no teenager under 18 can be coached.',
    );
    process.exit(1);
  }

  console.log(line);
  console.log(
    '\nExpected locally and in every test run - the product works without it, and\n' +
      'the one message it sends fails visibly rather than silently.\n' +
      'Exit 3 so a caller can tell this apart from a transport that is refusing.',
  );
  process.exit(3);
}

/*
 * ── THE FROM HEADER, BEFORE THE CONNECTION ─────────────────────────────────
 *
 * env.js defaults SMTP_FROM to SMTP_USER, which is right for most providers
 * because they reject a From that is not the authenticated mailbox. It is
 * wrong for exactly one shape, and it is the shape in use: Resend's SMTP
 * username is the fixed literal `resend`, so leaving SMTP_FROM unset builds a
 * From header reading `resend` - not an address at all.
 *
 * That failure happens at the far end, at send time, on the one message this
 * product sends. The athlete is told the link went. The parent never gets it.
 * Nobody else is in a position to notice.
 *
 * Checked BEFORE connecting, because a valid login with an unsendable From is
 * still a mailbox that cannot deliver, and reporting PASS on it would be this
 * whole project's recurring defect in miniature - a green check over a thing
 * that does not work.
 */
const from = (process.env.SMTP_FROM ?? '').trim() || user;
if (!isSendableFrom(from)) {
  console.error(`FAIL - the From header would be "${from}", which is not an email address.`);
  console.error(
    '\nSMTP_FROM is unset, so it fell back to SMTP_USER. That default suits providers\n' +
      'whose username IS the mailbox; it does not suit Resend, whose SMTP username is\n' +
      'the literal word `resend`. Set SMTP_FROM to an address on your verified domain.',
  );
  process.exit(1);
}

/*
 * A FOURTH OUTCOME: cannot check. Distinct from "broken" for the same reason
 * "not graded" is distinct from "failed" - a missing library says nothing
 * about whether the credentials work, and reporting it as a failure would send
 * somebody looking for a mail problem that may not exist.
 */
let nodemailer;
try {
  ({ default: nodemailer } = await import('nodemailer'));
} catch (err) {
  console.error('CANNOT CHECK - nodemailer is not installed here.');
  console.error(`  ${err?.code ?? 'unknown'}`);
  console.error(
    '\nThis says nothing about whether SMTP works. It is a dependency of the server\n' +
      'and is present wherever the server actually runs; run this there, or\n' +
      '`npm install` first. Exit 3, the same as unconfigured: not a finding.',
  );
  process.exit(3);
}

/*
 * 465 is implicit TLS; everything else negotiates STARTTLS. This mirrors
 * mailer.js deliberately rather than importing it: the point of the check is
 * to prove the CREDENTIALS and the SERVER work, and sharing the transport
 * builder would let one bug hide in both. Getting `secure` backwards produces
 * a connection that hangs rather than one that fails, which is why the timeout
 * below is short and explicit.
 */
const transport = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 15_000,
});

try {
  await transport.verify();
  console.log(`PASS - connected and authenticated to ${host}:${port}, sending as ${from}.`);
  console.log('No message was sent. The credentials work and the guardian link can go out.');
  process.exit(0);
} catch (err) {
  /*
   * The code, not the message. An SMTP library's `message` routinely quotes
   * the envelope and the greeting, and this runs in terminals and CI logs.
   */
  console.error(`FAIL - ${host}:${port} refused the connection or the credentials.`);
  console.error(`  code: ${err?.code ?? 'unknown'}`);
  console.error(`  response code: ${err?.responseCode ?? 'none'}`);
  console.error(
    '\nGuardian consent mail is not going out right now. Common causes, in the order\n' +
      'they actually happen: the password is an account password where the provider\n' +
      'wants an API key or an app password; the sending domain is not verified yet;\n' +
      'SMTP_PORT is 465 without implicit TLS on the far end, or 587 with it.',
  );
  process.exit(1);
} finally {
  transport.close();
}

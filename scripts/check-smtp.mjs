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
 * ── WHAT IT WILL NOT DO ON ITS OWN ──────────────────────────────────────────
 *
 * It sends nothing unless you name a recipient. A check that mails somebody to
 * prove mail works needs a recipient, and the only addresses this product holds
 * belong to athletes and to guardians who never signed up for anything.
 *
 * `--probe <address>` is the deliberate exception, and it exists because
 * `verify()` cannot answer the question that actually bites. Postmark accepts
 * the login of a server whose Sender Signature is unconfirmed and then refuses
 * the SEND with a 422, `Sender Signature not defined for From address`. So a
 * green PASS here has always been compatible with every message failing. The
 * probe is the only way to find that out that does not involve a real parent.
 *
 * It is a diagnostic and it lives here rather than in mailer.js on purpose:
 * mailer.js sends the product's messages, all of them written out in full, and
 * a "send arbitrary text to an arbitrary address" function in that file would
 * undo the reason it is shaped the way it is. This one has a fixed body, goes
 * only where the operator points it, records nothing, and touches no account.
 *
 * ── AND THEN IT ASKS WHAT HAPPENED TO IT, BECAUSE ACCEPTING IS NOT SENDING ──
 *
 * The first version of the probe printed PASS and told the operator to go and
 * look in their inbox. Nothing arrived. Postmark had taken the message on the
 * SMTP connection, returned a message id, and then rejected it internally:
 *
 *   type SMTPApiError, code 100007, error 412 - "While your account is pending
 *   approval, all recipient addresses must share the same domain as the 'From'
 *   address."
 *
 * A brand new Postmark account is restricted to its own domain until a human
 * at Postmark approves it. Every one of this product's users is on gmail,
 * protonmail or icloud, so the account could not have mailed a single one of
 * them - and every check anybody had ever run said PASS.
 *
 * That is this project's recurring defect exactly: a green signal over a thing
 * that does not work. The failure is ASYNCHRONOUS, so no SMTP result could
 * have caught it. The only place it exists is the provider's bounce record, so
 * that is what gets read.
 *
 * Provider-specific, and deliberately so. A generic check that cannot see the
 * one place the answer is kept would be a generic check that is wrong.
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

/*
 * ── LOAD .env, LIKE EVERY OTHER SCRIPT HERE ────────────────────────────────
 *
 * This read `process.env` alone, so it reported "NOT CONFIGURED - SMTP_HOST,
 * SMTP_USER, SMTP_PASSWORD are unset" for a repository whose .env had them
 * filled in. A check whose whole job is telling you the truth about your
 * configuration, lying about your configuration - and lying in the direction
 * that sends somebody to re-enter values that were already right.
 *
 * safety-eval.mjs and scan-bundle-for-secrets.mjs both do this. Being the
 * third script to need it and the first to forget is not a coincidence worth
 * defending.
 *
 * Guarded, because dotenv is genuinely absent in some places this runs, and
 * `loaded` is tracked so an unset variable can say WHICH of the two it means:
 * "you did not set it" or "I could not read the file you set it in".
 */
let dotenvLoaded = false;
try {
  await import('dotenv/config');
  dotenvLoaded = true;
} catch {
  // Absent. process.env is the only source, and the message below says so.
}

const REQUIRE = process.argv.includes('--require');

/*
 * The address to prove delivery to, if any. Taken as an explicit argument and
 * never defaulted: the whole point is that the operator names an inbox they
 * can open, and a default would eventually be somebody else's.
 */
const probeIndex = process.argv.indexOf('--probe');
const PROBE = probeIndex === -1 ? null : (process.argv[probeIndex + 1] ?? '').trim();

if (probeIndex !== -1 && !isSendableFrom(PROBE)) {
  console.error('FAIL - --probe needs an address to send to.');
  console.error('\n  npm run check:smtp -- --probe you@example.com\n');
  process.exit(2);
}

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
  console.log(
    dotenvLoaded
      ? '\n.env was loaded, so these are genuinely unset rather than unread.'
      : '\nNOTE: dotenv is not installed here, so a .env file was NOT read. If you set\n' +
        'these in .env, that is why they look unset - run `npm install`, or export them\n' +
        'for one command.',
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

/**
 * Ask Postmark what actually happened to the message we just handed it.
 *
 * ── WHY POLLING, AND WHY A WINDOW ─────────────────────────────────────────
 *
 * The rejection is asynchronous - it happens after the SMTP connection is
 * closed and the message id has been returned - so there is nothing to read at
 * the moment of the send. It lands in the bounce record a moment later.
 *
 * The window is short and the failure mode is chosen deliberately: NOT FINDING
 * A BOUNCE IS NOT A PASS, and this says so rather than printing a green line.
 * A check that turns "I did not see a problem in eight seconds" into "it works"
 * would be the same defect this whole function exists because of.
 *
 * The token is the one already in the environment. It is a Server API Token,
 * which is what Postmark's SMTP username and password are, so this needs no
 * new credential and no new configuration.
 */
async function postmarkVerdict(sentAt) {
  const notPostmark = !/(^|\.)postmarkapp\.com$/i.test(host);
  if (notPostmark) return { bounced: false, checked: false, why: `${host} is not Postmark` };

  const WINDOW_MS = 12_000;
  const started = Date.now();

  while (Date.now() - started < WINDOW_MS) {
    // A second between attempts. The record usually appears within two.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    let payload;
    try {
      const response = await fetch('https://api.postmarkapp.com/bounces?count=10&offset=0', {
        headers: { 'X-Postmark-Server-Token': pass, Accept: 'application/json' },
      });
      if (!response.ok) {
        return { bounced: false, checked: false, why: `the bounce API answered ${response.status}` };
      }
      payload = await response.json();
    } catch {
      return { bounced: false, checked: false, why: 'the bounce API could not be reached' };
    }

    /*
     * Matched on recipient AND time. Matching on the address alone would
     * report a bounce from last week as this message's, which is the kind of
     * confident wrong answer that costs an afternoon. One second of slack for
     * clock skew between here and Postmark.
     */
    const mine = (payload?.Bounces ?? []).find(
      (bounce) =>
        String(bounce.Email ?? '').toLowerCase() === PROBE.toLowerCase() &&
        Date.parse(bounce.BouncedAt ?? '') >= sentAt - 1000
    );

    if (mine) {
      return {
        bounced: true,
        checked: true,
        type: mine.Type ?? 'unknown',
        code: mine.TypeCode ?? 0,
        // Postmark puts the useful sentence in Subject for an SMTP API error,
        // which is odd and is where the answer actually is.
        reason: String(mine.Details || mine.Subject || mine.Description || 'no reason given').slice(0, 500),
      };
    }
  }

  return { bounced: false, checked: true, waitedSeconds: Math.round(WINDOW_MS / 1000) };
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

/**
 * ── THE MAIL THIS CHECK DOES NOT COVER, SAID ON EVERY RUN ──────────────────
 *
 * This checks the APPLICATION's transport, which carries exactly one message:
 * the guardian consent link. It says nothing at all about the mail that gates
 * every signup - the address confirmation, the password reset - because those
 * are sent by Supabase Auth through ITS OWN SMTP setting, configured in a
 * dashboard this script cannot read and using credentials it does not hold.
 *
 * On 2026-09-10 that setting was empty. Every confirmation this product has
 * ever sent went through Supabase's built-in service, which their own
 * documentation describes as best-effort, rate-limited to two messages an
 * hour, with no delivery SLA, and not for production. It has worked for seven
 * signups spread over seventeen days and has never once been asked to send two
 * in an hour.
 *
 * A green PASS here while THAT is the state is the exact shape of failure this
 * file already exists to prevent - the probe section above was written because
 * a PASS covered an account that could not mail a single real user. So the
 * uncovered half is named in the output rather than left for somebody to
 * remember, because nobody remembers.
 */
const AUTH_MAIL_NOTICE =
  '\nTHIS DOES NOT COVER SIGNUP MAIL. Address confirmation and password reset are\n' +
  'sent by Supabase Auth through its own SMTP setting, which this script cannot\n' +
  'read. If that setting is empty, those messages go through Supabase\'s built-in\n' +
  'service: two per hour, no delivery guarantee, and documented as not for\n' +
  'production. Check it at Project Settings -> Authentication -> SMTP Settings.\n' +
  'A green result below says the guardian link can go out. It says nothing about\n' +
  'whether anybody can create an account.';

try {
  await transport.verify();
  console.log(`PASS - connected and authenticated to ${host}:${port}, sending as ${from}.`);
  console.log(AUTH_MAIL_NOTICE);

  if (!PROBE) {
    console.log('No message was sent. The credentials work and the guardian link can go out.');
    console.log(
      '\nThat is the login, not the delivery. A provider can accept this handshake and\n' +
        'still refuse every send - Postmark answers 422 "Sender Signature not defined for\n' +
        'From address" when the sending address is not confirmed. Prove the rest with:\n\n' +
        '  npm run check:smtp -- --probe you@example.com',
    );
    process.exit(0);
  }

  /*
   * Deliberately dull, and deliberately says what it is. Somebody may find
   * this in an inbox months from now with no memory of running it, and a
   * mystery message from a service about a child's training would be alarming.
   */
  const sentAt = Date.now();
  const info = await transport.sendMail({
    from,
    to: PROBE,
    subject: 'Coach Diaz: SMTP probe',
    text: [
      'This is a test message from the Coach Diaz deployment check. Somebody ran',
      '`npm run check:smtp -- --probe` and named this address.',
      '',
      'It is not about an account and nothing has changed. If you were not expecting',
      'it, you can ignore and delete it.',
      '',
      `Sent as: ${from}`,
      `Through: ${host}:${port}`,
    ].join('\n'),
    // The same stream the product's own mail uses. A probe that proves a
    // different route than the real messages take is a probe that proves
    // nothing about them. See MESSAGE_STREAM in server/src/lib/mailer.js.
    headers: { 'X-PM-Message-Stream': 'outbound' },
  });

  console.log(`  accepted for delivery to ${PROBE}.`);
  console.log(`  message id: ${info?.messageId ?? 'none returned'}`);

  const verdict = await postmarkVerdict(sentAt);
  if (verdict.bounced) {
    console.error(`\nFAIL - ${host} accepted the message and then refused it.`);
    console.error(`  type: ${verdict.type} (code ${verdict.code})`);
    console.error(`  ${verdict.reason}`);
    if (verdict.code === 100007) {
      console.error(
        '\nThat is the pending-approval restriction: a new Postmark account may only\n' +
          'send to its own domain until a person at Postmark approves it. Request\n' +
          'approval in the Postmark dashboard. Until then NOTHING can reach a real\n' +
          'user, because none of them are on your sending domain.',
      );
    }
    process.exit(1);
  }

  console.log(
    verdict.checked
      ? `\nNo bounce recorded in the ${verdict.waitedSeconds}s after sending. That is the best\n` +
        'this can tell you, and it is still not proof of arrival - go and look in that\n' +
        'inbox, including spam. Only an email you can read proves the domain authenticates.'
      : '\nACCEPTED IS NOT ARRIVED, and this could not check further (' + verdict.why + ').\n' +
        'Go and look in that inbox, including spam.',
  );
  process.exit(0);
} catch (err) {
  /*
   * The code, not the message. An SMTP library's `message` routinely quotes
   * the envelope and the greeting, and this runs in terminals and CI logs.
   */
  console.error(
    PROBE
      ? `FAIL - ${host}:${port} refused the connection, the credentials, or the send.`
      : `FAIL - ${host}:${port} refused the connection or the credentials.`,
  );
  console.error(`  code: ${err?.code ?? 'unknown'}`);
  console.error(`  response code: ${err?.responseCode ?? 'none'}`);
  console.error(
    '\nGuardian consent mail is not going out right now. Common causes, in the order\n' +
      'they actually happen: the password is an account password where the provider\n' +
      'wants an API key or an app password; the sending domain is not verified yet;\n' +
      'SMTP_PORT is 465 without implicit TLS on the far end, or 587 with it.',
  );
  if (err?.responseCode === 422 || /sender signature/i.test(err?.response ?? '')) {
    console.error(
      '\nThat response code is the Sender Signature one: the login is fine and the\n' +
        `address is not. Confirm ${from} in Postmark, or verify its domain.`,
    );
  }
  process.exit(1);
} finally {
  transport.close();
}

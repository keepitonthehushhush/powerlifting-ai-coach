import nodemailer from 'nodemailer';

import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * Sending one kind of message: a guardian consent link.
 *
 * ── WHY THIS IS DELIBERATELY NOT A MAIL SERVICE ───────────────────────────
 *
 * There is exactly one outbound message in this product and there is no plan
 * for a second. A general mailer - templates, queues, retries, a `send(kind,
 * data)` signature - is machinery built for a future that has not been decided
 * on, and every one of those parts is somewhere a health-data product could
 * later put something it should not send. So this exports one function that
 * sends one message, and adding a second kind of mail is a deliberate edit
 * rather than a parameter.
 *
 * ── WHAT IT REFUSES TO CARRY ──────────────────────────────────────────────
 *
 * Nothing about the athlete but their first name, and only if they gave one.
 * Not their injuries, not their age, not their training, not their email.
 * A guardian needs to know who is asking and what they are agreeing to; the
 * rest is the athlete's, and an inbox is not a place this product controls.
 *
 * The link is the only secret in the message and it is single-use for granting.
 *
 * ── FAILING VISIBLY, NOT OPEN ─────────────────────────────────────────────
 *
 * Turnstile, Sentry and the paywall all degrade quietly when unconfigured,
 * which is right for each of them: the product still does its job. This is
 * different. If the mail does not go, the guardian never hears, and the athlete
 * is left waiting for something that will never arrive - while the interface
 * says "we have sent it".
 *
 * So an unconfigured or failing mailer is reported to the caller rather than
 * swallowed, and the route turns that into an honest message. The one thing it
 * must never do is claim to have sent something it did not.
 *
 * ── AND WHAT IS NEVER LOGGED ──────────────────────────────────────────────
 *
 * The guardian's address is personal data about a third party who never signed
 * up for anything. It is not a log line here, and `logger.js` would not redact
 * it if it were - "email" is not on the sensitive-keys list, deliberately,
 * because the athlete's own address is genuinely useful in a diagnostic. So
 * this passes an opaque outcome and a message id, never the recipient.
 */

let cached;

/**
 * The transport, built once.
 *
 * `null` when SMTP is not configured, which is a real and expected state -
 * local development and every test run - rather than an error.
 */
function transport() {
  if (cached !== undefined) return cached;
  const { host, port, user, pass } = config.smtp ?? {};
  cached = host && user && pass
    ? nodemailer.createTransport({
      host,
      port,
      // 465 is implicit TLS; everything else negotiates STARTTLS. Getting this
      // backwards produces a connection that hangs rather than one that fails.
      secure: port === 465,
      auth: { user, pass },
    })
    : null;
  return cached;
}

/** Test seam. The transport is built once and cached; this forgets it. */
export function resetMailer() {
  cached = undefined;
}

/**
 * Plain text only, and no HTML alternative.
 *
 * An HTML mail from a service a parent has never heard of, asking them to click
 * a link about their child, is the exact shape of a phishing message. Plain
 * text shows them the URL they are actually visiting, which is the one thing
 * that lets somebody check it.
 */
function guardianMessage({ link, athleteName }) {
  const who = athleteName ? `${athleteName} (aged 13-17)` : 'A teenager aged 13 to 17';
  return [
    `${who} has asked to use Coach Diaz, an AI strength coaching app, and gave us your`,
    'address as their parent or guardian. It will not coach them until you agree.',
    '',
    'Before you decide, one thing matters more than the rest: Coach Diaz writes a training',
    'program and your child goes and does it on their own. It is not supervision. Nobody',
    'watches them lift. The full explanation, and what the coaching will and will not do',
    'for someone their age, is on the page below.',
    '',
    'Read it and decide here:',
    link,
    '',
    'That link works once to agree. It will always work to say no, or to change your mind',
    'later - including after it has expired.',
    '',
    'If you were not expecting this, you can ignore it. Nothing happens until somebody',
    'agrees, and we will not write to you again.',
    '',
    '-- Coach Diaz',
  ].join('\n');
}

/**
 * Send a guardian their consent link.
 *
 * @returns {Promise<{sent: boolean, reason?: string}>} never throws; the caller
 *   decides what to tell the athlete, and must not imply success on `false`.
 */
export async function sendGuardianConsentEmail({ to, link, athleteName = null }) {
  const mail = transport();
  if (!mail) {
    logger.warn('mailer.not_configured', { purpose: 'guardian_consent' });
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const info = await mail.sendMail({
      from: config.smtp.from,
      to,
      subject: 'Permission needed: Coach Diaz',
      text: guardianMessage({ link, athleteName }),
    });
    // The id, never the recipient.
    logger.info('mailer.sent', { purpose: 'guardian_consent', messageId: info?.messageId ?? null });
    return { sent: true };
  } catch (err) {
    // `err.message` from an SMTP library routinely quotes the envelope, which
    // is the recipient address. The code is the diagnosis; the message is not
    // ours to log.
    logger.error('mailer.failed', { purpose: 'guardian_consent', code: err?.code ?? 'unknown' });
    return { sent: false, reason: 'send_failed' };
  }
}

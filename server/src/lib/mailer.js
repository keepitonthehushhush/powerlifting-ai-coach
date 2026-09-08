import nodemailer from 'nodemailer';

import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * Sending two kinds of message: a guardian consent link, and a notice that a
 * policy somebody agreed to has changed.
 *
 * ── WHY THIS IS DELIBERATELY NOT A MAIL SERVICE ───────────────────────────
 *
 * This file used to say "there is exactly one outbound message in this product
 * and there is no plan for a second", and required that adding one be a
 * deliberate edit rather than a parameter. This is that edit, and the rule did
 * its job: what follows is a second FUNCTION with its own message written out
 * in full, not a `send(kind, data)` and a template directory.
 *
 * The distinction is not stylistic. A general mailer - templates, queues,
 * retries, a variable body - is machinery built for a future nobody has decided
 * on, and every one of those parts is somewhere a health-data product could
 * later put something it should not send. Two functions with two fixed texts
 * can be read in full on one screen, and the question "what could this send?"
 * has an answer you can finish reading.
 *
 * ── WHY THE SECOND ONE HAD TO EXIST ───────────────────────────────────────
 *
 * Three people are using this product under policy versions it no longer
 * offers. A consent recorded against superseded text is agreement to something
 * we have since changed, and the app already refuses to let them past the
 * consent screen until they re-read it - but only if they come back. Nothing
 * could tell them to. An obligation that depends on the person happening to
 * return is not an obligation being met.
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
 * The policy-change notice.
 *
 * ── WHAT IT MAY NOT CONTAIN, AND THE REASON IS NOT THE SAME ONE ───────────
 *
 * The guardian message withholds the athlete's details because they belong to
 * the athlete. This one goes to the person themselves, so that reasoning does
 * not apply - and it still carries nothing but policy version strings. The
 * reason here is the inbox: an email is stored, forwarded, and read on screens
 * in rooms this product knows nothing about. There is no sentence about
 * somebody's training, body or injuries that is improved by being in one.
 *
 * NO LINK THAT DOES ANYTHING. Not a magic link, not a one-click "I agree", not
 * a token of any kind. Two reasons, and the second is the load-bearing one:
 * a token would be a new credential travelling by email for no gain, and
 * agreement collected by clicking a link in a message is agreement from
 * whoever holds the inbox, to text they did not have to open. The consent gate
 * already stops them at the door and shows them what changed. All this has to
 * do is say: come back and sign in.
 *
 * Plain text, same as the guardian message, and here the reason is sharper: a
 * message about your account terms with a button in it is the exact template
 * of a phishing mail. Plain text with a bare, typeable address is the version
 * a careful person can check without trusting us.
 */
function policyUpdateMessage({ versions }) {
  const list = versions.map((version) => `  ${version}`);
  return [
    'The terms you agreed to when you signed up for Coach Diaz have been updated. Nothing',
    'about your account has changed and nothing has been deleted.',
    '',
    'The versions you agreed to, which are the ones that have moved on:',
    ...list,
    '',
    'Next time you sign in you will be shown what changed and asked whether you still',
    'agree. Until you do, your training and your history stay exactly where they are -',
    'you just will not be able to use the coach.',
    '',
    'Sign in the usual way, at coachdiaz.app. There is no link in this message to click,',
    'on purpose: nobody should agree to terms by pressing a button in an email, and a',
    'message about your account that wants you to click something is what a fake one',
    'looks like.',
    '',
    'If you would rather not agree, the same screen lets you export everything we hold',
    'about you and delete your account.',
    '',
    '-- Coach Diaz',
  ].join('\n');
}

/**
 * Tell somebody the policy they agreed to has changed.
 *
 * @param {object} input
 * @param {string} input.to - their own address.
 * @param {string[]} input.versions - the superseded versions THEY are on.
 * @returns {Promise<{sent: boolean, reason?: string, messageId?: string|null}>}
 *   never throws. The caller records what actually happened, and must not write
 *   down a delivery on `false`.
 */
export async function sendPolicyUpdateEmail({ to, versions }) {
  const listed = (Array.isArray(versions) ? versions : []).filter(
    (v) => typeof v === 'string' && v.trim() !== ''
  );
  // A notice that names no version is a message saying "something changed,
  // work out what". Refused here rather than sent, because the caller has a
  // bug and the recipient would carry the cost of it.
  if (listed.length === 0) {
    logger.warn('mailer.refused_empty', { purpose: 'policy_update' });
    return { sent: false, reason: 'no_versions' };
  }

  const mail = transport();
  if (!mail) {
    logger.warn('mailer.not_configured', { purpose: 'policy_update' });
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const info = await mail.sendMail({
      from: config.smtp.from,
      to,
      subject: 'Coach Diaz: our terms have changed',
      text: policyUpdateMessage({ versions: listed }),
    });
    logger.info('mailer.sent', { purpose: 'policy_update', messageId: info?.messageId ?? null });
    return { sent: true, messageId: info?.messageId ?? null };
  } catch (err) {
    // The code is the diagnosis; the message routinely quotes the envelope,
    // and here the envelope is one of our own users.
    logger.error('mailer.failed', { purpose: 'policy_update', code: err?.code ?? 'unknown' });
    return { sent: false, reason: 'send_failed' };
  }
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

/**
 * The one address, in one place.
 *
 * ── WHY THIS IS A MODULE AND NOT THREE STRINGS ────────────────────────────
 *
 * It appears in the Terms, in the consumer health data policy, and on the
 * static maintenance page. Three copies of a contact address is three chances
 * for the documents to promise different routes, which is the same class of
 * defect as the disclosure audit found in the first place.
 *
 * ── AND WHY THERE IS A FLAG ───────────────────────────────────────────────
 *
 * Because a legal document naming an address that bounces is worse than one
 * that names none. The Terms commit to deleting an account when somebody tells
 * us it belongs to a minor; if the route to tell us does not work, the
 * commitment is decorative, and a decorative commitment is what the whole
 * under-18 section was written to avoid.
 *
 * So the documents ask CONTACT_LIVE before printing anything. Until the MX
 * records resolve, they render the route that is genuinely available - the
 * Account page, which deletes everything and needs no inbox - and say that an
 * address is being set up. Flip the flag in one place when mail is flowing;
 * a test asserts the documents cannot print the address while it is false.
 *
 * ── WHY NOT THE OWNER'S PERSONAL ADDRESS ──────────────────────────────────
 *
 * It was the faster option and it was refused deliberately. An address in a
 * public legal document is scraped within days, and once it is in a document
 * that people have consented to, changing it means a version bump and asking
 * every user to agree again. A forwarding address costs five minutes now and
 * can be repointed forever without touching the Terms.
 */

/** Where a parent, guardian, or anybody exercising a data right writes. */
export const CONTACT_EMAIL = 'privacy@coachdiaz.app';

/**
 * Whether mail to CONTACT_EMAIL actually arrives somewhere a person reads.
 *
 * Set to true ONLY after sending a test message to it and receiving it. Not
 * after adding the DNS records, and not after the forwarder's dashboard says
 * it is verified - after an actual email lands in an actual inbox. The whole
 * point of this flag is that it records a fact rather than an intention.
 */
export const CONTACT_LIVE = true;

/** True when the documents may print the address as a working route. */
export function contactIsUsable() {
  return CONTACT_LIVE && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(CONTACT_EMAIL);
}

/**
 * ── WHAT WE ASK PEOPLE TO SEND, AND WHY IT IS A TEMPLATE ──────────────────
 *
 * The problem: somebody writing in about their child's account will explain
 * themselves, and explaining themselves means health information arriving in
 * an inbox that has none of the protections the rest of this product has - no
 * row-level security, no consent ledger, no retention story. We did not ask
 * for it and we do not need it, and it is now ours to look after.
 *
 * The obvious answer is a confidentiality disclaimer, and the obvious answer
 * is worthless. A disclaimer tries to bind the recipient by appending text to
 * a message; contract formation needs both parties to agree, and nobody agrees
 * to a footer. It also does nothing about the actual risk, which is not that
 * somebody misuses what we sent them - it is that we are holding something we
 * never wanted.
 *
 * What US state privacy law actually points at is minimisation: collect what
 * is reasonably necessary, and dispose of it within a reasonable time once it
 * is not. So the fix is upstream of the disclaimer entirely. Do not ask for
 * the story, tell people plainly not to send it, and delete what arrives
 * anyway.
 *
 * A prefilled mailto is the strongest lever available for that, and it is
 * pure design rather than law: the message opens already written, with the two
 * fields we need and a line saying what to leave out. Most people will send it
 * as-is. It shapes the message before it exists, which no footer can do.
 *
 * A web form would minimise harder - you cannot type what has no field - and
 * it was rejected, because a form lands in a table somebody has to remember to
 * open, and "a commitment nobody can invoke" is the exact failure this whole
 * contact route was built to fix. Reliability wins; the template recovers most
 * of the minimisation.
 */

/** The subject line, so the message is filterable the moment it arrives. */
export const REMOVAL_SUBJECT = 'Account removal request';

/**
 * The body a removal request opens with.
 *
 * Deliberately short and deliberately explicit about what NOT to include. The
 * account email is the only thing needed to act - everything else is detail we
 * would have to hold, and holding a child's medical history because a worried
 * parent volunteered it is worse than the problem it was volunteered to solve.
 */
export const REMOVAL_BODY = [
  'Account email address:',
  '',
  'Your relationship to the account holder (e.g. parent, guardian):',
  '',
  '---',
  'Please do not include medical details, diagnoses, or anything about the',
  'account holder\'s health. We do not need any of it to remove an account, and',
  'we would rather not hold information nobody asked us to keep. The email',
  'address above is enough.',
].join('\n');

/**
 * A mailto that opens with the template already in it.
 *
 * @param {string} [subject]
 * @param {string} [body]
 * @returns {string}
 */
export function removalMailto(subject = REMOVAL_SUBJECT, body = REMOVAL_BODY) {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

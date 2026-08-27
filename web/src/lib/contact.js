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
export const CONTACT_LIVE = false;

/** True when the documents may print the address as a working route. */
export function contactIsUsable() {
  return CONTACT_LIVE && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(CONTACT_EMAIL);
}

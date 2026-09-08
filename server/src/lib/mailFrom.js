/**
 * Is this From header one a mail server will accept?
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
 *
 * Two callers need the same answer and must not disagree about it: the health
 * endpoint, which reports whether production COULD send, and check:smtp, which
 * proves it. Two copies of a predicate is how "configured" comes to mean one
 * thing in a dashboard and another in a terminal.
 *
 * (The transport BUILDER is deliberately duplicated between mailer.js and
 * check-smtp.mjs, for the opposite reason - sharing it would let one bug hide
 * in both, and the point of the check is to be an independent witness. A pure
 * predicate has no such failure mode: there is nothing for it to hide.)
 *
 * ── WHAT IT IS ACTUALLY GUARDING ────────────────────────────────────────────
 *
 * env.js defaults SMTP_FROM to SMTP_USER, which is right for providers whose
 * username IS the mailbox. Neither provider this project has touched works
 * that way: Postmark's username is a Server API Token, Resend's is the literal
 * word `resend`. On both, leaving SMTP_FROM unset produces a From header that
 * is not an address, `configured` still reports true because it only checks
 * host/user/pass, and the failure surfaces at send time - on a consent request
 * to the parent of a child, where the only person positioned to notice is the
 * parent who never got it.
 *
 * Deliberately not a full RFC 5322 validator. Rejecting an exotic-but-valid
 * address would be a worse failure than accepting one, and the thing being
 * caught here is not an unusual address - it is an API token sitting in a
 * field that wanted an email.
 */
export function isSendableFrom(from) {
  const value = String(from ?? '').trim();
  // A display-name form is legitimate and common: `Coach Diaz <coach@x.app>`.
  const angled = value.match(/<([^<>]+)>\s*$/);
  const address = angled ? angled[1].trim() : value;
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(address);
}

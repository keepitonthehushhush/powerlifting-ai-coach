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

/**
 * The name a person sees in their inbox instead of an address.
 *
 * ── WHY THIS IS IN CODE AND NOT IN SMTP_FROM ───────────────────────────────
 *
 * Reported as: the first real message this product delivered arrived from
 * "coach". Mail clients fall back to the local part of the address when the
 * From header carries no display name, and `SMTP_FROM` is the bare address
 * `coach@coachdiaz.app` - so a notice about somebody's terms changing turned
 * up from a sender called "coach", next to messages from companies with names.
 *
 * `SMTP_FROM="Coach Diaz <coach@coachdiaz.app>"` would also have fixed it, and
 * it is the wrong fix by a small margin that matters:
 *
 *   - it is TWO places. Production reads Vercel's environment, not `.env`, so
 *     the brand name would have to be right in both and would drift the first
 *     time one was changed alone.
 *   - Postmark matches a Sender Signature on the ADDRESS. Keeping the variable
 *     a bare address keeps the thing being matched obvious in the dashboard
 *     and in `check:smtp`'s own output.
 *   - the product's name is not deployment configuration. It is the same
 *     string in every environment, which is the definition of a constant.
 *
 * ── AND WHY THE PROBE USES IT TOO ──────────────────────────────────────────
 *
 * `check-smtp.mjs` duplicates the transport BUILDER deliberately, so that the
 * check is an independent witness to a bug in mailer.js. Composing a header is
 * a pure function, which the note at the top of this file already identifies
 * as the safe thing to share: there is nothing for it to hide. If the probe
 * built its own From header, the message used to prove delivery would not be
 * the message production sends - and the display name is exactly the kind of
 * difference that would then go unnoticed until somebody reported it again.
 */
export const SENDER_NAME = 'Coach Diaz';

/** Characters that would need the display name quoted per RFC 5322. */
const NEEDS_QUOTING = /[()<>[\]:;@\\,."]/;

/**
 * `Coach Diaz <coach@coachdiaz.app>` from a bare address.
 *
 * @param {string} from the configured SMTP_FROM
 * @param {string} [name] override, for tests
 * @returns {string} a From header, or the input unchanged when it cannot be
 *   improved - an operator who set their own display name meant it, and a
 *   value that is not an address is a misconfiguration this must not disguise
 *   by wrapping a friendly name around it.
 */
export function senderFrom(from, name = SENDER_NAME) {
  const value = String(from ?? '').trim();
  if (value === '' || !isSendableFrom(value)) return value;
  // Already carries a display name. Leave it alone.
  if (/<[^<>]+>\s*$/.test(value)) return value;
  const display = NEEDS_QUOTING.test(name) ? `"${name.replace(/(["\\])/g, '\\$1')}"` : name;
  return `${display} <${value}>`;
}

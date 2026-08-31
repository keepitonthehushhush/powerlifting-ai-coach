/**
 * Cleaning an email as it is typed, because a phone can put things in it that
 * are not there when you look at the field.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * Reported from an iPhone home-screen install: "stuck on enter an email
 * address when I have one entered - clicking sign in does nothing". The field
 * showed a correct address. No request reached the server - the error log had
 * nothing at all - so it never got past the browser.
 *
 * "Enter an email address." is WebKit's own validation message for an invalid
 * `type=email` field. So the browser considered the value invalid while the
 * user could see a perfectly good address in it, refused to submit, and gave
 * a message that named the one thing that was not wrong. There is nothing a
 * person can do with that.
 *
 * ── WHAT IS ACTUALLY IN THE FIELD ─────────────────────────────────────────
 *
 * Measured in a browser rather than reasoned about, because the intuitive
 * answer is wrong. `input type=email` strips leading and trailing ASCII
 * whitespace itself, as part of the spec's value sanitization - so an ordinary
 * stray space is NOT the culprit and never was:
 *
 *   "eddy@gmail.com "        (ASCII space) -> VALID, browser strips it
 *   "eddy@gmail.com\\u00a0"  (NBSP)        -> INVALID
 *   "eddy@gmail.com\\u200b"  (zero-width)  -> INVALID
 *   "Eddy@gmail.com"         (capitalised) -> VALID
 *
 * The sanitizer only removes ASCII whitespace. A non-breaking space, a
 * zero-width space, a soft hyphen or a bidi mark survives, is invisible in the
 * field, and fails validation. Those are exactly what arrives from an iOS
 * QuickType suggestion, a contact-card autofill, or a paste out of a mail app
 * or a messaging thread.
 *
 * ── SO IT IS STRIPPED, NOT VALIDATED AGAINST ──────────────────────────────
 *
 * An address cannot contain any of these characters, so removing them destroys
 * nothing a user meant to type, and it fixes the value BEFORE the browser
 * judges it. Rejecting with a better message would be the lesser fix: the user
 * still could not see what was wrong, because the offending character is
 * invisible by definition.
 */

/**
 * Characters that cannot appear in an email address and cannot be seen.
 *
 * Written as escapes, never as the characters themselves. A regex containing
 * a literal zero-width space is a regex nobody can read, review or safely
 * edit - and the lint rule that forbids irregular whitespace in source is
 * catching exactly the class of bug this module exists to fix, one level up.
 *
 * `\s` in JavaScript already covers the Unicode space separators including
 * U+00A0. It does NOT cover the zero-width family, the soft hyphen, or the
 * bidi controls, so those are named explicitly. U+FEFF appears in both and
 * the overlap is harmless.
 */
const INVISIBLE =
  /[\s\u00ad\u200b-\u200f\u2060\u2066-\u2069\ufeff]/g;

/**
 * The value with every invisible character removed.
 *
 * Safe to run on every keystroke: it can only ever shorten the value, and
 * anything it removes was never valid in an address.
 */
export function cleanEmailInput(value) {
  return typeof value === 'string' ? value.replace(INVISIBLE, '') : '';
}

/**
 * Did cleaning actually change anything?
 *
 * Used to explain a repair the user cannot see. Silently fixing the value is
 * right; silently fixing it AND saying nothing means somebody whose address
 * keeps arriving mangled never learns why.
 */
export function hadInvisibleCharacters(value) {
  return typeof value === 'string' && cleanEmailInput(value) !== value;
}

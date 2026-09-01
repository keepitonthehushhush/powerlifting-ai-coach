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

/**
 * Why this value is not an address, in terms a person can act on.
 *
 * ── WHY WE VALIDATE INSTEAD OF THE BROWSER ────────────────────────────────
 *
 * `input type=email` blocks submission and says "Enter an email address." on a
 * field that visibly contains one. That message names the only thing that is
 * not wrong. It cannot be reworded, cannot be translated, and reports nothing
 * back to us - so two rounds of "same thing" produced no new information.
 *
 * The form now carries noValidate and asks this instead. It costs the native
 * bubble, which was worth nothing here, and buys a sentence that names the
 * actual problem - including the code point of a character nobody can see.
 *
 * The keyboard is unaffected: the field is still type=email, so an iPhone
 * still offers the @ key. Only the refusal changes hands.
 *
 * ── DELIBERATELY NOT AN RFC 5322 VALIDATOR ────────────────────────────────
 *
 * Every regex claiming to implement that standard is either wrong or
 * unreadable, and being stricter than the mail system helps nobody: the
 * authoritative test of an address is whether mail arrives. This looks for the
 * mistakes people actually make and the characters phones actually insert, and
 * lets anything else through to the server, which will say no with its own
 * error if it must.
 *
 * @returns {null | {code: string, character?: string, codePoint?: string}}
 */
export function describeEmailProblem(value) {
  const cleaned = cleanEmailInput(value);

  if (!cleaned) return { code: 'empty' };

  /*
   * A lookalike @ is checked BEFORE the missing-@ test, or the message tells
   * somebody there is no @ sign while one is plainly on their screen - the
   * same unhelpfulness this function was written to remove, one level down.
   * U+FF20 comes from a full-width keyboard, U+FE6B from some paste paths.
   */
  const lookalikeAt = cleaned.match(/[\uff20\ufe6b]/);
  if (lookalikeAt) {
    return {
      code: 'lookalikeAt',
      character: lookalikeAt[0],
      codePoint: `U+${lookalikeAt[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
    };
  }

  const at = cleaned.split('@');
  if (at.length === 1) return { code: 'noAt' };
  if (at.length > 2) return { code: 'manyAt' };

  const [local, domain] = at;
  if (!local) return { code: 'noLocal' };
  if (!domain) return { code: 'noDomain' };
  if (!domain.includes('.')) return { code: 'noDot' };
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return { code: 'badDot' };
  }

  /*
   * Anything outside the set an address may contain. Reported WITH its code
   * point, because the characters that cause this are routinely invisible - a
   * full-width @ from a Japanese keyboard, a Cyrillic 'а' from a copied link,
   * a smart apostrophe from a notes app. "Remove the U+FF20 character" is
   * something a person can act on; "enter an email address" is not.
   */
  const odd = cleaned.match(/[^\p{L}\p{N}.!#$%&'*+/=?^_`{|}~@-]/u);
  if (odd) {
    return {
      code: 'oddCharacter',
      character: odd[0],
      codePoint: `U+${odd[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
    };
  }

  return null;
}

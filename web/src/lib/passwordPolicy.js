/**
 * Password requirements, defined once.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * This is NOT the enforcement point, and treating it as one would be a real
 * vulnerability rather than a cosmetic one. Sign-up goes from the browser
 * directly to Supabase Auth; this application's server is not in that path at
 * all. Anyone can POST to the Supabase `/auth/v1/signup` endpoint with the
 * publishable key - which is public by design - and never load this page.
 *
 * Enforcement therefore lives in the Supabase project's Auth settings, where
 * GoTrue applies it to every request regardless of origin. What this module
 * does is mirror that server rule so a person sees the requirements *while
 * typing* instead of after a rejected submit. It is a usability feature built
 * on top of a security control, and the two must be kept in step: see
 * docs/SECURITY.md for the settings this file is a mirror of.
 *
 * ── WHY THESE RULES ───────────────────────────────────────────────────────
 *
 * Twelve characters rather than eight. Length buys more resistance than
 * character-class variety does, and Supabase's own guidance is that anything
 * under eight is not worth having. The classes are here mainly because
 * requiring them is what makes the length requirement survive contact with
 * people who would otherwise pick twelve lowercase letters.
 *
 * The symbol set is copied from the characters Supabase Auth accepts. A
 * client that accepts a character the server rejects produces a password the
 * user believes is valid and cannot use.
 */

export const MIN_LENGTH = 12;

/** Exactly the symbols Supabase Auth counts, no more: !@#$%^&*()_+-=[]{};'\:"|<>?,./`~ */
const SYMBOLS = /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/;

/**
 * Rule ids double as i18n keys under `auth.passwordRules.*`. A test asserts every
 * id has a label in every locale, so adding a rule without translating it
 * fails the build rather than rendering a blank line.
 */
export const PASSWORD_RULES = [
  { id: 'length', test: (p) => p.length >= MIN_LENGTH },
  { id: 'lowercase', test: (p) => /[a-z]/.test(p) },
  { id: 'uppercase', test: (p) => /[A-Z]/.test(p) },
  { id: 'digit', test: (p) => /[0-9]/.test(p) },
  { id: 'symbol', test: (p) => SYMBOLS.test(p) },
];

/**
 * @param {unknown} password
 * @returns {{ok: boolean, results: Array<{id: string, satisfied: boolean}>}}
 *
 * Returns every rule with its state rather than just the failures, because the
 * UI shows the whole checklist: a requirement that disappears once met leaves
 * the person unsure whether they satisfied it or the page lost it.
 */
export function checkPassword(password) {
  const value = typeof password === 'string' ? password : '';
  const results = PASSWORD_RULES.map(({ id, test }) => ({ id, satisfied: test(value) }));
  return { ok: results.every((r) => r.satisfied), results };
}

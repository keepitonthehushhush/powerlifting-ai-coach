/**
 * Who this product may collect health data from, as a pure function.
 *
 * ── WHY THIS IS ONE FUNCTION AND NOT A SCATTERING OF CHECKS ───────────────
 *
 * Same reasoning as needsMedicalClearance and the consent gate: a rule with
 * legal consequences should be computed in one readable place and tested
 * exhaustively, rather than reconstructed from an `if` in a route and another
 * in a form. When the rule changes - and this one will, the moment a parental
 * consent path exists - there should be exactly one edit.
 *
 * ── THE RULE, AND WHY IT IS SET HERE ──────────────────────────────────────
 *
 * Today: 18 and over. Not because that is the right permanent answer, but
 * because collecting health information from a minor requires a consent
 * mechanism aimed at their parent, and that does not exist yet. Serving them
 * without it would be collecting exactly the category of data this application
 * is most careful about, from the people least able to consent to it.
 *
 * The intended destination is 13 to 17 with verifiable parental consent, and
 * under 13 excluded. COPPA reaches under-13s specifically, and its 2025
 * amendments add verifiable parental consent, hard retention limits, and a
 * mandated written information security program. That is a different and much
 * larger project than serving teenagers whose parents can consent - and
 * under-13 barbell coaching through an app is the narrowest, riskiest slice of
 * the market anyway. See docs/LEGAL_CONSIDERATIONS.md.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * It is not identity verification. A self-reported birth date is trivially
 * falsified, and no age gate anywhere solves that. What it does is ensure the
 * product does not knowingly collect from minors, which is the obligation that
 * actually attaches - and it makes the boundary explicit rather than implied.
 */

/** Minimum age, until a parental-consent path exists. */
export const MINIMUM_AGE = 18;

/**
 * Whole years elapsed, calendar-correct.
 *
 * Subtracting years and adjusting for the month/day is deliberate: dividing
 * elapsed milliseconds by 365.25 days drifts, and drifts most around leap
 * years and birthdays - which is precisely where a boundary case sits.
 *
 * @param {string|Date} dateOfBirth  ISO date or Date.
 * @param {Date} [asOf]              Injectable so tests are not time-dependent.
 * @returns {number|null} Age in whole years, or null if unparseable.
 */
export function ageInYears(dateOfBirth, asOf = new Date()) {
  if (!dateOfBirth) return null;

  const born = dateOfBirth instanceof Date ? dateOfBirth : new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;

  const now = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(now.getTime())) return null;

  let age = now.getUTCFullYear() - born.getUTCFullYear();

  const monthDiff = now.getUTCMonth() - born.getUTCMonth();
  const notYetThisYear = monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate());
  if (notYetThisYear) age -= 1;

  return age;
}

/**
 * @returns {{allowed: boolean, age: number|null, reason: 'ok'|'unknown'|'too_young'|'implausible'}}
 *
 * FAILS CLOSED on an unreadable date, for the same reason the consent gate
 * does: the cost of a wrong "no" is one screen and a corrected date, and the
 * cost of a wrong "yes" is collecting a minor's health information.
 *
 * A future birth date, or one implying an age no human reaches, is reported as
 * `implausible` rather than `too_young` - the person needs to know they made a
 * typo, not be told they are too young when they are seventy.
 */
export function evaluateAgeGate(dateOfBirth, asOf = new Date()) {
  const age = ageInYears(dateOfBirth, asOf);

  if (age === null) return { allowed: false, age: null, reason: 'unknown' };
  if (age < 0 || age > 120) return { allowed: false, age, reason: 'implausible' };
  if (age < MINIMUM_AGE) return { allowed: false, age, reason: 'too_young' };

  return { allowed: true, age, reason: 'ok' };
}

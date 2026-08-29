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

/** Minimum age to be coached on nobody's authority but your own. */
export const MINIMUM_AGE = 18;

/**
 * The hard floor. Below this there is no consent that helps.
 *
 * COPPA's amended Rule reaches any operator with actual knowledge that it
 * collects personal information from a child under 13, and brings with it
 * verifiable parental consent in an FTC-approved form, a written information
 * security program with designated personnel and annual testing, a written
 * retention policy where indefinite retention is prohibited, and DISTINCT
 * consent for third-party disclosure. Penalties run to $53,088 per violation.
 *
 * That is a different product with a compliance function attached. 13 is a
 * floor, not a dial.
 */
export const ABSOLUTE_MINIMUM_AGE = 13;

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

/**
 * Whether this profile may be coached at all.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM evaluateAgeGate ───────────────────────
 *
 * evaluateAgeGate answers "may we STORE health information about this
 * person". That question was answered correctly from the start and it is not
 * the only one that needed asking.
 *
 * Until 2026-08-27 the terms said this service is for adults and NOTHING
 * refused an account. A fifteen-year-old could sign up, skip the injury boxes,
 * and be handed a barbell program. The product's own error message said as
 * much - "you can still use the rest of the app" - while the terms said
 * accounts are refused. The documents and the code disagreed, and the code was
 * the one people were actually using.
 *
 * This closes it on the side that matters. A refusal in the browser is a
 * courtesy; a refusal in the API is the control, because the browser is not
 * ours and a determined teenager with the network tab open is not a difficult
 * adversary.
 *
 * ── WHAT IT CANNOT DO ─────────────────────────────────────────────────────
 *
 * It cannot verify anybody's age. A self-reported date of birth is trivially
 * falsified and no gate anywhere solves that; the ones that do require
 * government ID, which is a far larger collection of personal data than
 * anything else this product holds and would be a worse trade.
 *
 * What it does is make sure this product never KNOWINGLY coaches a minor, and
 * that the record shows a date was asked for, checked, and acted on. That is
 * the obligation that actually attaches. It is not the same thing as immunity,
 * and docs/LEGAL_CONSIDERATIONS.md says so in the words of somebody who is not
 * a lawyer.
 *
 * FAILS CLOSED on a missing date, like every other gate here: the intake form
 * requires one, so an absent date means somebody went around the form.
 *
 * ── THE THREE-OUTCOME VERSION ─────────────────────────────────────────────
 *
 * The comment at the top of this file promised that when a parental consent
 * path existed there would be EXACTLY ONE EDIT. This is it. The rule now has
 * four bands rather than two:
 *
 *   under 13        refused, permanently, whatever anybody consents to
 *   13-17, no consent   refused, but with a route rather than a dead end
 *   13-17, consented    allowed, and marked as a minor
 *   18 and over     allowed
 *
 * `isMinor` is COMPUTED and never stored. A stored flag is correct until the
 * morning of somebody's eighteenth birthday and silently wrong afterwards,
 * which is the same class of bug as a cached age - and this one would keep a
 * legal adult under a guardian's authority. The date of birth is the fact;
 * everything else is derived from it on the spot.
 *
 * ── OFF UNTIL SOMEBODY TURNS IT ON ────────────────────────────────────────
 *
 * `minorsEnabled` defaults to FALSE, and while it is false this function
 * behaves exactly as it did before any of this was written: 18 and over, no
 * exceptions, one reason code. Writing the code is not the decision to ship
 * it - the policy documents still say this service is for adults, and they and
 * the code disagreeing is the exact failure that produced this gate in the
 * first place. See docs/UNDER_18.md.
 *
 * @param {object|null} profile
 * @param {object} [options]
 * @param {Date}    [options.asOf]            Injectable so tests are not time-dependent.
 * @param {boolean} [options.minorsEnabled]   The deliberate switch. Off by default.
 * @param {boolean} [options.guardianConsent] Whether an active, current guardian
 *   consent exists. Decided by the consent ledger, not by this function.
 * @returns {{allowed: boolean, isMinor: boolean,
 *            reason: 'ok'|'unknown'|'too_young'|'implausible'|'guardian_consent_required'}}
 */
export function adultGateDecision(profile, options = {}) {
  const {
    asOf = new Date(),
    minorsEnabled = false,
    guardianConsent = false,
  } = options instanceof Date ? { asOf: options } : options;

  const { age, reason } = evaluateAgeGate(profile?.date_of_birth, asOf);

  // Unreadable, absent, or impossible: refused, and the age is not a number we
  // can reason about. Unchanged.
  if (reason === 'unknown' || reason === 'implausible') {
    return { allowed: false, isMinor: false, reason };
  }

  if (age >= MINIMUM_AGE) return { allowed: true, isMinor: false, reason: 'ok' };

  // Below the floor there is no consent that helps, and no route to offer.
  if (age < ABSOLUTE_MINIMUM_AGE) {
    return { allowed: false, isMinor: true, reason: 'too_young' };
  }

  // 13 to 17. Until the switch is thrown this is indistinguishable from the
  // old behaviour, deliberately: same refusal, same reason code.
  if (!minorsEnabled) return { allowed: false, isMinor: true, reason: 'too_young' };

  return guardianConsent
    ? { allowed: true, isMinor: true, reason: 'ok' }
    : { allowed: false, isMinor: true, reason: 'guardian_consent_required' };
}

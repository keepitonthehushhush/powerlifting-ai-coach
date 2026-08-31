/**
 * Two-step sign-in: what state an account is in, and what to do about it.
 *
 * ── WHY THE LOGIC IS HERE AND NOT IN A COMPONENT ──────────────────────────
 *
 * Every interesting thing about MFA is a four-way decision made from two
 * strings, and getting it wrong has two very different costs. Read it too
 * loosely and somebody with a second factor signs in without it, which is the
 * control not existing. Read it too strictly and somebody who never enrolled
 * is asked for a code they cannot produce, which is a locked door with no key
 * on a health product they own the data in.
 *
 * So the decision is a pure function over the two levels, and the component
 * renders whatever it says.
 *
 * ── THE TABLE, WHICH IS SUPABASE'S AND NOT MINE ───────────────────────────
 *
 *   current  next   meaning
 *   aal1     aal1   no factor enrolled
 *   aal1     aal2   a factor exists; this session has not used it
 *   aal2     aal2   verified in this session
 *   aal2     aal1   the factor was removed and this JWT predates that
 *
 * The fifth row is mine: anything else is `unknown`, and unknown is not a
 * pass. A missing level, a network failure reading it, or a value Supabase
 * adds later must not be collapsed into "no MFA, carry on" - that is the
 * shape of every serious defect this project has had.
 */

export const AAL1 = 'aal1';
export const AAL2 = 'aal2';

/**
 * @param {{currentLevel?: string|null, nextLevel?: string|null}} levels
 * @returns {{state: 'notEnrolled'|'challengeRequired'|'active'|'staleSession'|'unknown',
 *            satisfied: boolean, reason: string}}
 *   `satisfied` answers only "may this session proceed without a code". It is
 *   false for `unknown` on purpose.
 */
export function describeMfaState(levels) {
  const current = levels?.currentLevel ?? null;
  const next = levels?.nextLevel ?? null;

  if (current === AAL1 && next === AAL1) {
    return { state: 'notEnrolled', satisfied: true, reason: 'no second factor on this account' };
  }
  if (current === AAL1 && next === AAL2) {
    return {
      state: 'challengeRequired',
      satisfied: false,
      reason: 'a second factor exists and this session has not used it',
    };
  }
  if (current === AAL2 && next === AAL2) {
    return { state: 'active', satisfied: true, reason: 'verified in this session' };
  }
  if (current === AAL2 && next === AAL1) {
    // The session is strictly stronger than the account now requires. Nothing
    // to ask for, and nothing wrong - the token simply predates the removal.
    return { state: 'staleSession', satisfied: true, reason: 'the factor was removed after this session began' };
  }
  return {
    state: 'unknown',
    satisfied: false,
    reason: `unrecognized assurance levels (current ${String(current)}, next ${String(next)})`,
  };
}

/**
 * The verified TOTP factor, or null.
 *
 * ── A CORRECTION THE DOCUMENTATION WOULD HAVE COST ME ─────────────────────
 *
 * The guide reads `[...data.totp, ...data.phone]` and describes those arrays
 * as "all available factors". In the installed SDK (@supabase/supabase-js
 * 2.112.4) the per-type arrays are typed `Factor<K, 'verified'>[]` and there
 * is a separate `all` array holding both statuses. Checked against
 * node_modules rather than the docs, for the same reason this project asserts
 * against pg_proc rather than the migration file: the artifact is the fact.
 *
 * Written to survive either shape - it filters on status regardless - because
 * an SDK upgrade must not silently start treating an abandoned enrollment as
 * a working second factor.
 */
export function verifiedTotpFactor(factorList) {
  const candidates = factorList?.all ?? factorList?.totp ?? [];
  if (!Array.isArray(candidates)) return null;
  return (
    candidates.find((f) => f?.factor_type === 'totp' && f?.status === 'verified') ?? null
  );
}

/**
 * Enrollments that were started and abandoned.
 *
 * `enroll()` writes an unverified factor immediately, so every time somebody
 * opens the setup screen and closes it, one is left behind. They are harmless
 * until they are not: the default ceiling is ten factors per user, and the
 * eleventh abandoned attempt is a person who cannot turn MFA on with no
 * explanation of why. Nothing in the documentation covers this, so the app
 * clears them itself before starting a new enrollment.
 */
export function abandonedTotpFactors(factorList) {
  const candidates = factorList?.all ?? [];
  if (!Array.isArray(candidates)) return [];
  return candidates.filter((f) => f?.factor_type === 'totp' && f?.status !== 'verified');
}

/** A TOTP code as the field should accept it: six digits, spaces forgiven. */
export function cleanTotpCode(raw) {
  return String(raw ?? '').replace(/[\s-]/g, '').slice(0, 6);
}

/** Is this something worth sending, or would it certainly be refused? */
export function codeLooksComplete(raw) {
  return /^\d{6}$/.test(cleanTotpCode(raw));
}

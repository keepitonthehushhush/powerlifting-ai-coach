/**
 * How strongly was this caller authenticated, and is that strong enough?
 *
 * ── WHY THE SERVER HAS AN OPINION AT ALL ──────────────────────────────────
 *
 * Supabase's own guidance is blunt about it: "Adding MFA to your app's UI does
 * not in-and-of-itself offer a higher level of security to your users. You
 * also need to enforce the MFA rules in your application's database, APIs, and
 * server-side rendering."
 *
 * A browser deciding whether to show a code screen is a suggestion. Anybody
 * holding a stolen aal1 token can call this API directly and skip it entirely.
 * So the rule is enforced twice more: here, and in a restrictive RLS policy
 * (migration 0050) that holds even if this file is wrong.
 *
 * ── WHY A MISSING CLAIM IS aal1 AND NOT A REJECTION ───────────────────────
 *
 * Supabase documents it exactly: "JWTs without an `aal` claim are at the
 * `aal1` level." Treating absent as invalid would lock out every session
 * issued before the claim existed. Treating absent as aal2 would be the
 * failure this module exists to prevent. It is aal1 - a real, weak, named
 * level - and the step-up decision proceeds from there.
 *
 * ── AND WHY IT DOES NOT VERIFY THE SIGNATURE ──────────────────────────────
 *
 * Because requireAuth already did, with the auth server, before calling this.
 * Reading a claim out of a string that has been verified is not the same
 * operation as trusting an unverified string, and conflating them would mean
 * a second network round trip per request to learn something already proven.
 * The precondition is written into the function's name and its guard: it
 * takes the token requireAuth verified, and nothing else may call it.
 */

export const AAL1 = 'aal1';
export const AAL2 = 'aal2';

/**
 * The `aal` claim from a token that has ALREADY been verified by requireAuth.
 *
 * @param {string} verifiedToken
 * @returns {'aal1'|'aal2'|string} the claim, or 'aal1' when it is absent or
 *   the payload cannot be read. Never throws: a malformed payload on an
 *   otherwise-verified token is a weird state, and the safe reading of a weird
 *   state is the weaker level.
 */
export function assuranceLevelOf(verifiedToken) {
  const payload = decodePayload(verifiedToken);
  const claim = payload?.aal;
  return typeof claim === 'string' && claim !== '' ? claim : AAL1;
}

function decodePayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // base64url, which Buffer understands directly in Node 16+.
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Does this caller still owe us a second factor?
 *
 * Three-valued, like every other check in this codebase that can fail to
 * establish its subject. `unknown` is returned when the factor list is absent
 * rather than empty - `getUser()` omits the field in some responses, and an
 * absent list is not the same fact as "this person has no second factor".
 *
 * @param {{level: string, factors?: Array<{factor_type?: string, status?: string}>|null}} input
 * @returns {{verdict: 'satisfied'|'stepUpRequired'|'unknown', reason: string}}
 */
export function describeStepUp({ level, factors }) {
  if (level === AAL2) {
    return { verdict: 'satisfied', reason: 'the session is already aal2' };
  }

  if (!Array.isArray(factors)) {
    return {
      verdict: 'unknown',
      reason: 'the factor list was absent, so enrollment could not be established',
    };
  }

  const verified = factors.filter((f) => f?.status === 'verified');
  if (verified.length === 0) {
    return { verdict: 'satisfied', reason: 'no verified factor on this account' };
  }

  return {
    verdict: 'stepUpRequired',
    reason: `${verified.length} verified factor(s) and a ${String(level)} session`,
  };
}

/**
 * Should the request be refused?
 *
 * `unknown` does NOT refuse, and that is a deliberate, uncomfortable choice
 * worth writing down. The alternative - refuse when we cannot tell - turns any
 * change in the shape of a getUser() response into a total outage for
 * everybody, including the overwhelming majority with no second factor at all.
 * Failing open here is safe only because it is not the only control: the
 * restrictive RLS policy in migration 0050 evaluates the same rule inside the
 * database, where a missing factor list is not a possible state because the
 * factors ARE the table being read.
 *
 * That is the whole argument for having built both. This one is for telling
 * somebody what to do next; that one is for being right.
 */
export function shouldRefuse(stepUp) {
  return stepUp?.verdict === 'stepUpRequired';
}

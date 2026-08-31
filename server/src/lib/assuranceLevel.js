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
 * ── AN ABSENT FACTOR LIST MEANS NO FACTORS, AND THAT WAS MEASURED ─────────
 *
 * The first version of this treated an absent `factors` field as `unknown`,
 * on the reasoning that "the field was missing" and "this person has no second
 * factor" are different facts. That reasoning is sound in general and was
 * wrong here, and production said so within a minute of the deploy: twelve
 * `auth.step_up_undetermined` warnings in thirty seconds, all from the one
 * account, all before it enrolled.
 *
 * The timeline settles it. Before the factor existed (21:03:42-21:04:12)
 * every response omitted the field. The factor was created at 21:04:21. From
 * 21:05:06 onward every response carried it, and the step-up fired correctly.
 * getUser() omits `factors` when there are none rather than sending an empty
 * array - so the "unknown" branch was not a rare diagnostic, it was the
 * ordinary path for everybody who has not enrolled, and it made the check
 * decline to decide on every request while warning about it.
 *
 * ── SO HOW WOULD WE KNOW IF THAT INFERENCE STOPPED BEING TRUE? ────────────
 *
 * Two ways, and having both is why this is safe to infer rather than merely
 * assume.
 *
 * The cheap one is here: a session cannot BE aal2 without a factor, because
 * aal2 is what verifying one produces. So `aal2` with no factor list is a
 * contradiction - the only reading is that the field went missing for a
 * reason other than absence - and it is reported as an anomaly. It costs
 * nothing and it fires exactly when the inference breaks.
 *
 * The expensive one is the restrictive RLS policy from migration 0050. If
 * this function ever wrongly says "satisfied" for somebody who does hold a
 * factor, the database refuses their rows and the app breaks visibly rather
 * than quietly letting a weak session through. A loud failure, in the layer
 * that does not depend on the shape of an HTTP response.
 *
 * @param {{level: string, factors?: Array<{factor_type?: string, status?: string}>|null}} input
 * @returns {{verdict: 'satisfied'|'stepUpRequired', reason: string, anomaly?: string}}
 */
export function describeStepUp({ level, factors }) {
  const listed = Array.isArray(factors);

  if (level === AAL2) {
    const result = { verdict: 'satisfied', reason: 'the session is already aal2' };
    if (!listed) {
      // Verifying a factor is the only way to reach aal2, so this session
      // must have one. The field being absent anyway means absence no longer
      // means what it meant on 2026-08-31, and the inference below is due a
      // re-measurement.
      result.anomaly =
        'an aal2 session reported no factor list, which cannot be true - ' +
        'the absent-means-none reading is no longer safe';
    }
    return result;
  }

  const verified = listed ? factors.filter((f) => f?.status === 'verified') : [];

  if (verified.length === 0) {
    return {
      verdict: 'satisfied',
      reason: listed ? 'no verified factor on this account' : 'no factors reported',
    };
  }

  return {
    verdict: 'stepUpRequired',
    reason: `${verified.length} verified factor(s) and a ${String(level)} session`,
  };
}

/**
 * Should the request be refused?
 *
 * One verdict refuses and everything else proceeds, which is deliberate and
 * worth writing down. Refusing on anything ambiguous would turn a change in
 * the shape of a getUser() response into a total outage for everybody,
 * including the overwhelming majority with no second factor at all.
 *
 * Failing open here is safe only because this is not the only control. The
 * restrictive RLS policy in migration 0050 evaluates the same rule inside the
 * database, where the factor list cannot be absent because the factors ARE
 * the table being read. That is the whole argument for having built both:
 * this one is for telling somebody what to do next, and that one is for being
 * right.
 */
export function shouldRefuse(stepUp) {
  return stepUp?.verdict === 'stepUpRequired';
}

/**
 * The decision "may this person use the product yet?", as a pure function.
 *
 * WHY IT IS SEPARATE FROM THE COMPONENT THAT USES IT. The same reasoning as
 * `needsMedicalClearance` on the server: a rule with legal weight should be
 * computed by something that can be tested exhaustively, not tangled into
 * render logic where its behaviour is only observable by clicking. Washington's
 * My Health My Data Act requires consent to be obtained BEFORE collection;
 * "we're fairly sure the redirect works" is not the standard to hold that to.
 *
 * WHAT THIS GATE IS AND IS NOT. It gates the two consents the product cannot
 * run without. It is NOT what protects health data: that is enforced in
 * Postgres by the trigger from migration 0008, which refuses to write
 * `health_restrictions` without an active `health_data_collection` consent
 * regardless of what any client believes. This gate exists so a person is
 * ASKED at the right moment, rather than meeting a database error later.
 *
 * `health_data_collection` is deliberately NOT gated here. MHMDA requires
 * consent to be freely given, and consent extracted by withholding an
 * unrelated feature is not freely given. The coach works without injury
 * information — more conservatively, but it works. See
 * server/src/lib/policyVersions.js.
 */

/**
 * @param {{consents?: object, required?: string[]}|null|undefined} state
 *        The body of GET /api/consent, or null if it has not loaded.
 * @returns {{allowed: boolean, missing: string[], reason: 'ok'|'unknown'|'withheld'|'stale'}}
 *
 * FAILS CLOSED. If the consent state is absent, malformed, or the server did
 * not say which consents are required, the answer is "not yet" — never "let
 * them through and hope". The cost of a wrong "no" is one extra screen on a
 * page that can retry. The cost of a wrong "yes" is collecting health data
 * from somebody who was never asked.
 */
export function evaluateConsentGate(state) {
  const required = Array.isArray(state?.required) ? state.required : null;
  const consents = state?.consents;

  if (!required || !consents || typeof consents !== 'object') {
    return { allowed: false, missing: [], reason: 'unknown' };
  }

  const withheld = [];
  const stale = [];

  for (const type of required) {
    const record = consents[type];
    if (!record?.granted) withheld.push(type);
    // A consent recorded against a superseded policy version is a consent to
    // something we have since changed. Treating it as valid would mean relying
    // on agreement to text the person never saw.
    else if (record.stale) stale.push(type);
  }

  const missing = [...withheld, ...stale];
  if (missing.length === 0) return { allowed: true, missing: [], reason: 'ok' };

  return { allowed: false, missing, reason: withheld.length > 0 ? 'withheld' : 'stale' };
}

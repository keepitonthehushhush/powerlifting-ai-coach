/**
 * Policy versions, recorded with every consent.
 *
 * A consent record without a version proves someone clicked something. It does
 * not prove what they agreed to — which is the question that actually gets
 * asked later. Bumping a version here is the signal that users must be asked
 * again; changing policy text without bumping it silently invalidates every
 * consent already on file.
 *
 * Dated rather than numbered so a record is self-describing in an audit.
 */
export const POLICY_VERSIONS = Object.freeze({
  health_data_collection: 'chd-2026-08-29a',
  ai_processing: 'aip-2026-08-28a',
  terms_of_service: 'tos-2026-08-31b',
  /**
   * Publishing your lifts to other users. A separate purpose from coaching,
   * so a separate consent - and deliberately NOT in REQUIRED_CONSENTS below,
   * because a permission that costs something to refuse is not freely given.
   * Refusing this costs nothing: every other feature behaves identically.
   */
  leaderboard_publication: 'lbp-2026-08-28a',
});

export const CONSENT_TYPES = Object.freeze(Object.keys(POLICY_VERSIONS));

/**
 * A guardian agreeing that somebody aged 13 to 17 may be coached here.
 *
 * ── WHY IT IS NOT IN THE MAP ABOVE ────────────────────────────────────────
 *
 * It is a real consent on the same append-only ledger, version-aware, withdrawn
 * the same way. Putting it in POLICY_VERSIONS was the obvious move and five
 * separate guards refused it, which is the codebase saying the abstraction does
 * not fit. That map is not "every consent that exists" - it is the consents an
 * athlete SEES, manages on their consent screen, and has a page to read before
 * agreeing. A guardian consent has a different audience and, today, no document
 * at all: `policyDocuments.test.js` said so in as many words - "users would be
 * agreeing to nothing".
 *
 * ── IT NOW HAS A PAGE, AND IT STILL DOES NOT MOVE ────────────────────────
 *
 * This used to end "it moves into the map on the day it has a page, and not
 * before." The page exists - web/src/pages/GuardianConsent.jsx, routed at
 * /policies/guardian-consent - and moving it in would still be wrong, which is
 * the definition three lines above being read properly rather than the last
 * sentence being read on its own.
 *
 * That definition names THREE conditions: the consents an athlete sees,
 * MANAGES ON THEIR CONSENT SCREEN, and has a page to read. The page satisfies
 * one. The other two are not a matter of time, they are the point: this map
 * drives CONSENT_TYPES, which drives what the consent panel renders, so adding
 * it puts a "your guardian agreed" checkbox in front of the fifteen-year-old
 * whose guardian is supposed to be ticking it. The POST endpoint would then
 * refuse them - SELF_SERVICE_CONSENT_TYPES exists for exactly that - and a
 * control that errors when used is an invitation to try it.
 *
 * So the version stays in its own constant, and the DOCUMENT requirement is met
 * where it belongs instead: POLICY_DOCUMENTS maps guardian_consent to its page,
 * and guardianRoundTrip.test.js asserts the page carries this version and that
 * migration 0036 seeds the same one. The rule "no consent without something to
 * read" is enforced; the rule "the athlete manages it" is not pretended.
 *
 * Must match the version seeded by migration 0036; a test holds the two
 * together.
 */
export const GUARDIAN_CONSENT_VERSION = 'gc-2026-08-29a';

/**
 * The consents a signed-in athlete may record FOR THEMSELVES.
 *
 * ── WHY THIS IS NOT JUST CONSENT_TYPES ────────────────────────────────────
 *
 * Everything on the ledger used to be self-service, so the POST endpoint took
 * `z.enum(CONSENT_TYPES)` and that was right. A guardian consent breaks the
 * assumption underneath it: the person it protects is the person holding the
 * session, and letting them grant it is letting a fifteen-year-old tick a box
 * that says their parent agreed.
 *
 * That is not a hypothetical slip - adding `guardian_consent` to the versions
 * map above is enough to cause it, because the endpoint derives its enum from
 * that map. So the endpoint reads THIS list instead, and the exclusion is
 * asserted rather than assumed.
 *
 * A guardian consent is recorded by the guardian following a link sent to
 * their own address, and by nothing else.
 */
export const SELF_SERVICE_CONSENT_TYPES = Object.freeze(
  CONSENT_TYPES.filter((type) => type !== 'guardian_consent')
);

/**
 * Consents without which the product cannot function at all.
 *
 * Deliberately short. MHMDA requires consent to be freely given, and a consent
 * that gates something unrelated to its purpose is not freely given. Health
 * data collection is NOT on this list: the coach works without injury
 * information, just more conservatively, so making it mandatory would be both
 * bad practice and legally weaker.
 */
export const REQUIRED_CONSENTS = Object.freeze(['terms_of_service', 'ai_processing']);

/**
 * Reduce the append-only ledger to current state.
 *
 * Rows must arrive ordered by `seq` DESCENDING, so the first occurrence of a
 * consent type is its latest decision. Ordering by `seq` and not `created_at`
 * is load-bearing: `now()` is transaction start time in Postgres, so two
 * decisions recorded in one transaction carry identical timestamps and sort
 * arbitrarily. That bug, before migration 0010 fixed it, made a withdrawal
 * read as a grant.
 *
 * A consent recorded against a superseded policy version is reported as
 * `stale`: the user agreed to something we have since changed, so their
 * agreement no longer covers what we now do.
 */
export function deriveCurrentConsents(rowsNewestFirst = []) {
  const current = {};

  for (const row of rowsNewestFirst) {
    if (row.consent_type in current) continue;
    current[row.consent_type] = {
      granted: row.granted,
      policy_version: row.policy_version,
      recorded_at: row.created_at ?? null,
      stale: row.granted === true && row.policy_version !== POLICY_VERSIONS[row.consent_type],
    };
  }

  for (const type of CONSENT_TYPES) {
    current[type] ??= { granted: false, policy_version: null, recorded_at: null, stale: false };
  }

  return current;
}

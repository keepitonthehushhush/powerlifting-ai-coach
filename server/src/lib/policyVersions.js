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
  health_data_collection: 'chd-2026-08-27',
  ai_processing: 'aip-2026-08-27b',
  terms_of_service: 'tos-2026-08-27',
});

export const CONSENT_TYPES = Object.freeze(Object.keys(POLICY_VERSIONS));

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

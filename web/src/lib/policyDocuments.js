/**
 * Where to read what you are about to agree to.
 *
 * One entry per consent type. This exists so the mapping is a single fact the
 * code can be tested against, rather than something spread across a router and
 * a component that can drift apart silently — which is how the application
 * ended up requiring agreement to a terms of service that had no document at
 * all, while still recording everyone as having agreed to version
 * `tos-2026-08-24`.
 *
 * A test asserts that every consent type the server declares appears here and
 * that every path here is a real route. Adding a consent type without writing
 * the document it refers to now fails the build.
 */
export const POLICY_DOCUMENTS = Object.freeze({
  terms_of_service: '/policies/terms',
  ai_processing: '/policies/ai-processing',
  health_data_collection: '/policies/health-data',
});

export function policyPathFor(consentType) {
  return POLICY_DOCUMENTS[consentType] ?? null;
}

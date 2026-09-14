/**
 * The mobility-detail levels, for the browser.
 *
 * Duplicated from server/src/lib/mobilityDetail.js rather than shared, for the
 * reason the nutrition copy gives in full: the browser bundle must not import
 * from the server tree, because that is how a server-only constant ends up
 * shipped. mobilityDetail.test.js reads both files and fails if they disagree,
 * since a duplicated list is a list that drifts and the drift is the kind
 * nobody notices - a fourth level rendering a radio button the server refuses.
 */
export const MOBILITY_DETAIL_LEVELS = Object.freeze(['off', 'brief', 'full']);

export const DEFAULT_MOBILITY_DETAIL = 'brief';

/** Anything this build does not recognize is the default - see the server copy. */
export function resolveMobilityDetail(value) {
  return MOBILITY_DETAIL_LEVELS.includes(value) ? value : DEFAULT_MOBILITY_DETAIL;
}

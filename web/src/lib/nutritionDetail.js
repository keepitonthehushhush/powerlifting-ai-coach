/**
 * The food-detail levels, for the browser.
 *
 * ── WHY THIS LIST EXISTS TWICE ────────────────────────────────────────────
 *
 * The server has its own copy in server/src/lib/nutritionDetail.js, and the
 * two are not shared because the browser bundle must not import from the
 * server tree - that is how a server-only constant ends up shipped, and the
 * bundle scanner exists because it has happened elsewhere.
 *
 * A duplicated list is a list that drifts, so nutritionDetail.test.js reads
 * both files and fails if they disagree. The check is cheap and the drift is
 * the kind nobody notices: a fourth level added on one side renders a radio
 * button the server refuses, or the server accepts a value no control can set.
 */
export const NUTRITION_DETAIL_LEVELS = Object.freeze(['off', 'ranges', 'meals']);

export const DEFAULT_NUTRITION_DETAIL = 'meals';

/** Anything this build does not recognize is the default - see the server copy. */
export function resolveNutritionDetail(value) {
  return NUTRITION_DETAIL_LEVELS.includes(value) ? value : DEFAULT_NUTRITION_DETAIL;
}

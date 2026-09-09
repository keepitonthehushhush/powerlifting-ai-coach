/**
 * How much of the food conversation this athlete actually wants.
 *
 * ── WHY A SETTING AND NOT A SENTENCE ──────────────────────────────────────
 *
 * The fueling and food sections of the prompt are unconditional. Every athlete
 * gets protein ranges applied to their bodyweight, meal examples, portions and
 * prep advice, whether or not that is the help they came for. Somebody who
 * would rather not have that conversation can say so, and the transcript is
 * windowed - so they say it again, and again, and eventually stop using the
 * coach instead of asking a fourth time.
 *
 * A setting is the difference between a preference and a request. This one is
 * theirs, it is on their account page, and it survives the window.
 *
 * ── WHAT IT CANNOT DO, WHICH IS THE POINT ─────────────────────────────────
 *
 * NO LEVEL UNLOCKS ANYTHING. The highest setting is exactly what the product
 * does today; the other two are narrower. There is deliberately no fourth
 * level that turns on calorie targets or prescribed meal plans, because that
 * is a scope-of-practice line - ACE puts individualized meal planning and
 * specific intake recommendations outside what a fitness professional may
 * provide - and a scope line does not move because the person it protects
 * ticked a box. Consent is not a qualification.
 *
 * So this is a NARROWING control by construction, not by promise:
 * `directiveFor` can only ever add prohibitions to the unconditional sections,
 * never permissions, and nutritionDetail.test.js reads every level's text and
 * fails on a permitting verb.
 *
 * The minor and disordered-eating rules sit above all three levels and are
 * untouched by any of them. `meals` does not authorize a cutting protocol for
 * somebody describing food as punishment; it never did.
 */

/**
 * The levels, narrowest first. Order is meaningful: a later entry may say more
 * than an earlier one, which is what makes "can only narrow" a checkable claim
 * rather than a comment.
 */
export const NUTRITION_DETAIL_LEVELS = Object.freeze(['off', 'ranges', 'meals']);

/**
 * The default is what every athlete received before this column existed.
 *
 * A migration that adds a setting AND changes behavior for everybody already
 * using the product has made two changes that can only be debugged as one.
 */
export const DEFAULT_NUTRITION_DETAIL = 'meals';

/**
 * The stored value, or the default for anything this build does not recognize.
 *
 * Null for a profile that predates the column, an unknown string from a newer
 * deploy, the wrong type entirely - all resolve to the default rather than
 * throwing, for the same reason the theme falls back: a preference this build
 * cannot read is not a reason to fail somebody's coaching turn.
 *
 * The failure direction is deliberate and worth stating: an unreadable value
 * resolves to MORE food talk, not less. That is the wrong direction for a
 * privacy control and the right one for this, because the column is NOT NULL
 * with a default and constrained to three strings, so the only way to reach
 * this path is a build older than the value - and answering a nutrition
 * question in an old build is a smaller harm than silently withholding help
 * somebody asked for. If a level is ever added that carries real risk, it
 * belongs at the narrow end, where an old build resolves away from it.
 */
export function resolveNutritionDetail(value) {
  return NUTRITION_DETAIL_LEVELS.includes(value) ? value : DEFAULT_NUTRITION_DETAIL;
}

/**
 * The per-turn directive, or null when there is nothing to say.
 *
 * Null at the default on purpose. The unconditional sections already describe
 * that behavior, so a directive restating them would cost tokens on every turn
 * of every conversation to change nothing - and the static half of the prompt
 * (ADR-8) tells the coach that no directive means the full setting.
 */
export function directiveFor(level) {
  switch (resolveNutritionDetail(level)) {
    case 'off':
      return `- FOOD IS OFF FOR THIS ATHLETE. They have set the food conversation to off on their
  account page. Do not raise eating, protein, bodyweight-as-a-target, or supplements. Not as
  an aside, not folded into a training answer, not as "one thing worth mentioning".
  If they ask a direct question about food, answer it briefly and generally, without applying
  numbers to their bodyweight, and tell them once that they can turn the food conversation
  back on in their account settings if they want the detailed version. Then coach the lifting,
  which is what they are here for. Do not ask them why it is off, and do not treat the setting
  as something to talk them out of.`;
    case 'ranges':
      return `- FOOD IS SET TO RANGES ONLY for this athlete. Give the published population ranges and
  the timing advice, applied to their bodyweight as arithmetic, exactly as the fueling section
  describes. Do NOT name specific meals, foods, portions, plates, recipes, shopping or meal
  prep - that is the part they have turned off, and offering it anyway as "just an example"
  is the same content with a hedge in front of it. If they ask for meal ideas, say plainly
  that they can switch food detail to the full setting in their account settings, and do it
  without a lecture.`;
    default:
      return null;
  }
}

/**
 * Should the computed fueling numbers be handed over at all?
 *
 * ADR-2 - computed, not prompted. A model given a table of macros and told not
 * to raise the subject is being asked to hold a thing it was handed, and the
 * cheaper guarantee is not to hand it over. At `off` the numbers are withheld
 * rather than the instruction being trusted, which is the same argument the
 * clearance gate makes when it suppresses prescriptions.
 */
export function fuellingNumbersAllowed(level) {
  return resolveNutritionDetail(level) !== 'off';
}

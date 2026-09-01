/**
 * Evidence-based fueling ranges, computed for one athlete's bodyweight.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS CAREFUL ────────────────────────────────
 *
 * A strength coach that cannot talk about eating is half a coach. Under-eating
 * limits adaptation more reliably than almost any training variable, and "what
 * should I eat to keep progressing" is one of the most common questions a
 * novice has. Until now this product answered it with a single line buried in
 * a recovery-factors list.
 *
 * But nutrition is also where the existing safety guardrails live, and they
 * were not arbitrary: the adversarial suite has two scenarios - a rapid weight
 * cut before a meet, and disordered-eating signals - that pass BECAUSE the
 * coach refuses to produce a restriction plan. Loosening this section without
 * care would break the two tests that matter most.
 *
 * So the line drawn here is not "how cautious do we feel". It is the line the
 * profession already draws, and it is drawn in law in some places.
 *
 * ── THE SCOPE-OF-PRACTICE LINE ────────────────────────────────────────────
 *
 * The NSCA's guidance for personal trainers separates GENERAL NUTRITION
 * INFORMATION - which a non-dietitian may give, and which explicitly includes
 * nutrition for performance, weight loss and weight gain - from MEDICAL
 * NUTRITION THERAPY, which requires a licensed dietitian and is mandatory to
 * refer out whenever a nutrition-affected disease state is present. Eating
 * disorders are named on that referral list, alongside diabetes, cardiac and
 * gastrointestinal disease.
 *
 * US regulation of this varies by state in three tiers: licensure (Alabama:
 * only registered dietitians may give specific dietary guidance), statutory
 * certification (title protected, practice open), and registration (least
 * restrictive; Arizona has no licensure law at all). We cannot know which
 * state an athlete is in. So the product behaves as though it were in the
 * strictest one.
 *
 * What that means concretely, and it is the whole design:
 *
 *   INSIDE SCOPE - published population ranges, and the arithmetic that
 *   applies a published range to a bodyweight. "Resistance-trained athletes
 *   are studied at 1.4 to 2.0 g of protein per kg per day; at your bodyweight
 *   that is 110 to 160 g" is information, in the same register as a nutrition
 *   label. This module computes exactly that and nothing else.
 *
 *   OUTSIDE SCOPE - a daily calorie target, a meal plan, a macro split
 *   prescribed as an intervention, a cutting protocol, a supplement stack.
 *   Those are prescriptions for an individual. This module deliberately has no
 *   function that returns a calorie number, because the cheapest way to keep a
 *   boundary is to make the code physically unable to cross it.
 *
 * Note that the trainer remains accountable for negligence and misinformation
 * regardless of what any state requires. The ranges below are therefore cited,
 * and the coach is instructed to give the range and its source rather than a
 * confident single number.
 *
 * ── SOURCES ───────────────────────────────────────────────────────────────
 *
 *   ISSN Position Stand: Protein and Exercise (Jäger et al., JISSN 2017)
 *     - 1.4-2.0 g/kg/day sufficient for most exercising individuals
 *     - 0.25 g/kg per meal, or 20-40 g absolute, to maximise MPS
 *     - doses distributed every 3-4 h across the day
 *     - 700-3000 mg leucine per dose
 *     - pre-sleep casein 30-40 g raises overnight MPS
 *
 *   Achieving an Optimal Fat Loss Phase in Resistance-Trained Athletes
 *   (Ruiz-Castellano et al., Nutrients 2021)
 *     - 0.5-1.0% of bodyweight per week to retain fat-free mass
 *     - protein 2.2-3.0 g/kg/day while in deficit, 0.40-0.55 g/kg per meal
 *     - carbohydrate 2-5 g/kg/day, adjusted to activity
 *     - dietary fat floor 0.5 g/kg/day, or 20-30% of energy
 *     - energy availability below 25 kcal/kg FFM/day (men) or 30 (women)
 *       produces greater FFM loss, hormonal disruption and psychological harm
 */

/** Exact, so a kilogram lifter and a pound lifter get the same answer. */
export const KG_PER_LB = 0.45359237;

/**
 * Protein, g per kg of bodyweight per day.
 *
 * Two bands because the evidence genuinely differs: the requirement rises in
 * an energy deficit, where protein is doing the additional job of defending
 * lean mass. Giving the maintenance band to somebody in a deficit is the more
 * common error and the more harmful one.
 */
export const PROTEIN_G_PER_KG = {
  maintenance: [1.4, 2.0],
  deficit: [2.2, 3.0],
};

/** Per meal, g per kg. Below this a dose does not fully stimulate synthesis. */
export const PROTEIN_PER_MEAL_G_PER_KG = {
  maintenance: [0.25, 0.4],
  deficit: [0.4, 0.55],
};

/** Absolute per-meal band from the ISSN stand, for athletes at the extremes. */
export const PROTEIN_PER_MEAL_ABSOLUTE_G = [20, 40];

/** Hours between protein feedings. */
export const MEAL_SPACING_HOURS = [3, 4];

/** Carbohydrate, g per kg per day, in a fat-loss phase. */
export const CARB_G_PER_KG_DEFICIT = [2, 5];

/** Dietary fat floor, g per kg per day. Below this is an endocrine problem. */
export const FAT_FLOOR_G_PER_KG = 0.5;

/**
 * The fastest defensible rate of weight loss, as a fraction of bodyweight per
 * week. Above 1% the literature shows disproportionate fat-free mass loss.
 *
 * This is the number that makes the weight-cut refusal quantitative rather
 * than merely cautious: "that is 24% of your bodyweight in five weeks, about
 * five percent a week, five times the fastest rate that preserves muscle" is a
 * far better answer than "that sounds like too much".
 */
export const WEEKLY_LOSS_FRACTION = [0.005, 0.01];

/**
 * Low energy availability thresholds, kcal per kg of FAT-FREE mass per day.
 * Stated for completeness and for the coach to explain; NOT computed here,
 * because computing it needs a body-fat estimate we do not have and must not
 * guess at.
 */
export const ENERGY_AVAILABILITY_FLOOR = { men: 25, women: 30 };

function toKg(weight, units) {
  if (!Number.isFinite(weight) || weight <= 0) return null;
  return units === 'kg' ? weight : weight * KG_PER_LB;
}

/** One decimal for kg-scale numbers, whole grams for gram-scale ones. */
const g = (value) => Math.round(value);

/**
 * Population ranges applied to this athlete's bodyweight.
 *
 * Returns null when bodyweight is unknown rather than inventing one - the
 * whole value of this function is that the arithmetic is real, and arithmetic
 * on a guessed bodyweight is worse than no arithmetic.
 *
 * There is deliberately no calories field, and adding one would be a change
 * of policy rather than a feature. See the scope note at the top of this file.
 *
 * @param {object} input
 * @param {number|null} input.bodyweight
 * @param {'lb'|'kg'} input.units
 * @param {boolean} input.inDeficit whether the athlete has said they are losing weight
 */
export function fuellingRanges({ bodyweight, units = 'lb', inDeficit = false } = {}) {
  const kg = toKg(bodyweight, units === 'kg' ? 'kg' : 'lb');
  if (kg === null) return null;

  const band = inDeficit ? 'deficit' : 'maintenance';
  const [pLow, pHigh] = PROTEIN_G_PER_KG[band];
  const [mLow, mHigh] = PROTEIN_PER_MEAL_G_PER_KG[band];

  const ranges = {
    band,
    bodyweightKg: Math.round(kg * 10) / 10,
    proteinPerDayG: [g(kg * pLow), g(kg * pHigh)],
    proteinPerMealG: [g(kg * mLow), g(kg * mHigh)],
    mealSpacingHours: MEAL_SPACING_HOURS,
    fatFloorPerDayG: g(kg * FAT_FLOOR_G_PER_KG),
    weeklyLossKg: [
      Math.round(kg * WEEKLY_LOSS_FRACTION[0] * 100) / 100,
      Math.round(kg * WEEKLY_LOSS_FRACTION[1] * 100) / 100,
    ],
  };

  // Carbohydrate is only given a per-kg band in the fat-loss literature. In a
  // maintenance or gaining phase the honest answer is "enough to train on",
  // and inventing a number to fill the field would be exactly the kind of
  // confident fabrication this codebase keeps out of the prompt.
  if (inDeficit) {
    ranges.carbPerDayG = [
      g(kg * CARB_G_PER_KG_DEFICIT[0]),
      g(kg * CARB_G_PER_KG_DEFICIT[1]),
    ];
  }

  return ranges;
}

/**
 * How fast a stated weight target would require losing, as a fraction of
 * bodyweight per week.
 *
 * Used to answer "can I get from 150 to 114 in five weeks" with a number
 * instead of an adjective. Returns null when the inputs do not describe a
 * loss, because this is not a tool for planning weight gain.
 */
export function weeklyLossFraction({ bodyweight, targetWeight, weeks } = {}) {
  if (![bodyweight, targetWeight, weeks].every((n) => Number.isFinite(n))) return null;
  if (bodyweight <= 0 || weeks <= 0 || targetWeight >= bodyweight) return null;
  return (bodyweight - targetWeight) / bodyweight / weeks;
}

/** True when a stated target exceeds the fastest rate that preserves muscle. */
export function exceedsSafeLossRate(fraction) {
  return Number.isFinite(fraction) && fraction > WEEKLY_LOSS_FRACTION[1];
}

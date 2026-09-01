/**
 * When a belt is worth mentioning, and what to say about it.
 *
 * ── THE HONEST VERSION, WHICH IS NOT THE MARKETING VERSION ────────────────
 *
 * This was requested as "recommend belts and other safety equipment to
 * minimise injuries". The first half is right and the second half is not, and
 * getting that wrong in a product holding health data would be a false safety
 * claim - the exact kind of thing this codebase refuses to make elsewhere.
 *
 * What the evidence actually supports:
 *
 *   - A belt increases intra-abdominal pressure and trunk stiffness when it is
 *     used with a real brace. One study measured an 83% increase in trunk
 *     stiffness resisting flexion, and belts reduce spinal erector activation
 *     at a given load.
 *   - Belts do NOT weaken your core. That is a gym myth with no evidence
 *     behind it, and the strongest lifters in the world wear one for most of
 *     their training.
 *   - Belts are "unlikely to reduce the risk of first-time low back pain"
 *     during resistance training. The evidence for preventing recurrence is
 *     unclear.
 *
 * So: a belt is a PERFORMANCE tool that lets you brace harder against more
 * weight. It is not injury insurance, and selling it as injury insurance is
 * how somebody ends up believing a strap of leather will protect them from a
 * bad rep. The thing that actually reduces risk is the load being appropriate,
 * the technique holding, and the athlete stopping when it does not - which is
 * what the rest of this product is for.
 *
 * ── WHY THIS IS COMPUTED RATHER THAN LEFT TO THE MODEL ────────────────────
 *
 * Same reason as everything else in this directory. "Heavy enough for a belt"
 * is a number, and a model asked to judge it from prose will raise it for a
 * beginner squatting 95 lb - which is both useless and, quietly, a nudge to
 * spend money they did not need to spend.
 *
 * ── AND WHY THERE ARE NO PRODUCT LINKS ────────────────────────────────────
 *
 * Deliberate, and see docs/LEGAL_CONSIDERATIONS.md. The coach describes what
 * to look for - width, thickness, fastening, whether a federation approves it -
 * rather than naming a brand. That is better coaching anyway: a specification
 * survives a product going out of stock, and it does not turn a health-adjacent
 * recommendation into a transaction the recommender profits from.
 */

/** lb per kg, for the one conversion this module needs. */
const LB_PER_KG = 2.20462;

/**
 * Bodyweight multiples at which a belt starts being worth the money.
 *
 * Chosen to be conservative - somebody who is not yet moving real weight
 * relative to themselves should be spending the money on food and sleep. The
 * deadlift number is higher than the squat number because most people pull
 * more than they squat, so the same multiple would fire on the deadlift first
 * and for no good reason.
 */
export const BELT_THRESHOLDS = Object.freeze({
  squat: 1.25,
  'bench press': Infinity, // A belt does very little for a bench press.
  deadlift: 1.5,
  'overhead press': 0.75,
});

/** Normalize a weight to pounds, since the thresholds are ratios anyway. */
function toLb(weight, units) {
  if (!Number.isFinite(weight) || weight <= 0) return null;
  return units === 'kg' ? weight * LB_PER_KG : weight;
}

/**
 * Which lifts have crossed the "a belt is now a reasonable purchase" line.
 *
 * @param {object} input
 * @param {object|null} input.profile        needs bodyweight and units
 * @param {Record<string, {weight: number|null}>} [input.prescriptions]
 * @returns {{lifts: string[], ratio: number|null}}
 */
export function beltWorthMentioning({ profile, prescriptions } = {}) {
  const units = profile?.units ?? 'lb';
  const bodyweight = toLb(profile?.bodyweight, units);
  if (!bodyweight) return { lifts: [], ratio: null };

  const lifts = [];
  let best = 0;

  for (const [lift, p] of Object.entries(prescriptions ?? {})) {
    const load = toLb(p?.weight, units);
    const threshold = BELT_THRESHOLDS[lift];
    if (!load || !threshold) continue;
    const ratio = load / bodyweight;
    if (ratio >= threshold) {
      lifts.push(lift);
      best = Math.max(best, ratio);
    }
  }

  return { lifts, ratio: lifts.length ? Number(best.toFixed(2)) : null };
}

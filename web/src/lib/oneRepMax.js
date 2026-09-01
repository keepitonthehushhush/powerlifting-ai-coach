/**
 * Estimated one-rep max: a band, not a number.
 *
 * ── WHY A BAND ────────────────────────────────────────────────────────────
 *
 * An e1RM is a prediction, and every calculator that prints one number is
 * hiding how wide the prediction is. The two standard equations disagree in a
 * useful direction - measured, in a validation study of the back squat against
 * true 1RM in Division I football players (DiStasio, 2014):
 *
 *   at 3 reps   Brzycki UNDERestimated by 4.8 kg (significant)
 *               Epley   OVERestimated  by 2.7 kg (not significant)
 *   at 5 reps   Brzycki UNDERestimated by 3.1 kg (not significant)
 *               Epley   OVERestimated  by 4.0 kg (significant)
 *
 *   correlation with true 1RM: r = 0.93 at 3 reps, r = 0.90 at 5 reps, for both
 *
 * So one brackets low and the other brackets high. Drawing the interval
 * between them shows the reader that this is a prediction rather than a
 * measurement, which a single confident line hides.
 *
 * ── THE BAND IS NOT A CONFIDENCE INTERVAL, AND MUST NEVER BE CALLED ONE ───
 *
 * This matters more than it looks, and a test caught it. The two equations
 * CROSS at 9.98 reps. Measured on a 100 kg set:
 *
 *     reps   brzycki    epley    width
 *        4   109.099  113.333   4.235   <- widest
 *        8   124.162  126.667   2.505
 *        9   128.601  130.000   1.399
 *       10   133.369  133.333   0.036   <- they agree, by coincidence
 *       12   144.051  140.000   4.051   <- and Brzycki is now the HIGHER one
 *
 * So the band pinches to almost nothing at ten reps - which is precisely where
 * the estimate is LEAST trustworthy. A reader who took the width as confidence
 * would draw the exact opposite of the truth from it. The width is the
 * disagreement between two formulas at their crossover, and nothing else.
 *
 * Two consequences, both deliberate. The reliable limit is EIGHT rather than
 * ten, which keeps every charted set on the side of the crossover where
 * Brzycki is genuinely the lower bound and the band still has width. And the
 * ordering is computed with min/max rather than assumed, because "Brzycki
 * reads low" is a fact about a rep range and not an identity.
 *
 * ── WHY IT STOPS AT ALL ───────────────────────────────────────────────────
 *
 * The study's conclusion is that "the validity of the Brzycki and Epley
 * equations increases with decreasing repetitions", and it examined only 3RM
 * and 5RM loads. Past that the estimate measures work capacity rather than
 * strength. A set above the limit returns `reliable: false` and the caller
 * leaves it off the chart: an estimate we do not believe is worse than a gap,
 * because a gap is visibly a gap.
 */

/**
 * Above this the estimate is not offered.
 *
 * Eight rather than ten, for the crossover reason above: at nine the band has
 * narrowed to 1.4 kg and at ten to 0.04 kg, and a band that vanishes where the
 * estimate is weakest is worse than no band at all.
 */
export const RELIABLE_REP_LIMIT = 8;

/**
 * Where the two equations swap places, solved rather than sampled.
 *
 * Exported so the test can assert it independently: if a constant in either
 * equation is ever retyped, this number moves and the suite says so.
 */
export const EQUATIONS_CROSS_AT_REPS = 9.9779;

/** Epley (1985): 1RM = w(1 + 0.0333r). Reads high. */
export function epley(weight, reps) {
  return weight * (1 + reps / 30);
}

/**
 * Brzycki (1993): 1RM = w / (1.0278 - 0.0278r). Reads low.
 *
 * The denominator hits zero at reps = 36.97, so above the reliable limit this
 * does not merely lose accuracy, it diverges. Guarded rather than trusted.
 */
export function brzycki(weight, reps) {
  const denominator = 1.0278 - 0.0278 * reps;
  if (denominator <= 0.05) return null;
  return weight / denominator;
}

/**
 * @returns {{low: number, high: number, mid: number, reps: number, reliable: boolean}|null}
 *   null when there is nothing to estimate from. `low`/`high` are the two
 *   equations, ordered - not assumed, because "Brzycki is always lower" is a
 *   finding about typical rep ranges rather than an identity, and at one rep
 *   they agree exactly.
 */
export function estimateOneRepMax(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || w <= 0) return null;
  if (!Number.isFinite(r) || r < 1) return null;

  // A single is not an estimate. It is the measurement, and widening it into a
  // band would be inventing uncertainty that the set does not contain.
  if (r === 1) {
    return { low: w, high: w, mid: w, reps: 1, reliable: true };
  }

  const a = epley(w, r);
  const b = brzycki(w, r);
  if (!Number.isFinite(a)) return null;
  if (b === null || !Number.isFinite(b)) {
    return { low: a, high: a, mid: a, reps: r, reliable: false };
  }

  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return { low, high, mid: (low + high) / 2, reps: r, reliable: r <= RELIABLE_REP_LIMIT };
}

/**
 * The best estimate from each day's work, as a series.
 *
 * The HEAVIEST SET IS NOT ALWAYS THE BEST ESTIMATE, which is the whole reason
 * this is not just a weight chart with different numbers on it: 100 kg for 5
 * predicts a higher max than 110 kg for 1 would, and an athlete who did both
 * on the same day has told us more with the set of five. So every qualifying
 * set is estimated and the highest estimate wins the day.
 *
 * Sets that were not completed are excluded. A missed rep is evidence about
 * the day, not about the ceiling, and treating a failed triple as a triple
 * would quietly inflate the estimate exactly when the athlete was weakest.
 */
export function oneRepMaxSeries(logs, lift) {
  const byDate = new Map();

  for (const row of Array.isArray(logs) ? logs : []) {
    if (row?.lift !== lift) continue;
    if (row.completed === false) continue;
    if (!row.date) continue;

    const estimate = estimateOneRepMax(row.weight, row.reps);
    if (!estimate || !estimate.reliable) continue;

    const existing = byDate.get(row.date);
    if (!existing || estimate.mid > existing.mid) {
      byDate.set(row.date, { date: row.date, ...estimate, weight: Number(row.weight) });
    }
  }

  return [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

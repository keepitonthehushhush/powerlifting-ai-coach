/**
 * What do I actually put on the bar?
 *
 * The app has always been able to say "squat 160 kg" and has never been able
 * to answer the question a beginner asks next, standing in front of a rack
 * with a pile of plates. That gap is the whole reason this module exists.
 *
 * ── WHY THIS IS NOT JUST roundToLoadable ────────────────────────────────────
 *
 * progression.js already refuses to prescribe a weight that cannot be built,
 * by rounding the PLATE portion down to a multiple of the smallest pair. That
 * is the right guard and it stays. But it answers "is this number reachable",
 * not "which plates". Those are different questions, and only the second one
 * gets somebody under the bar.
 *
 * ── WHY GREEDY, AND WHAT GREEDY DOES NOT PROMISE ────────────────────────────
 *
 * Plate selection here is greedy: take the heaviest plate that still fits,
 * repeat. The obvious thing to claim is that greedy gives the fewest plates.
 * That claim is TRUE FOR KILOGRAMS AND FALSE FOR POUNDS, and the first draft of
 * this file asserted it for both with a hand-waved argument about divisibility.
 * A test caught it. The real position, measured rather than reasoned:
 *
 *   kg  greedy is minimal for every reachable weight.
 *   lb  greedy is minimal everywhere EXCEPT two weights, both caused by the
 *       35 lb plate:
 *
 *         165 lb  greedy 45+10+5  (3 plates)   minimal 35+25  (2 plates)
 *         170 lb  greedy 45+10+5+2.5 (4)       minimal 35+25+2.5 (3)
 *
 * We keep greedy anyway, and that is a deliberate product decision rather than
 * an oversight. A lifter loading 165 lb reaches for a 45, because a 45 is what
 * is on the rack and heaviest-inside is how a bar gets loaded. Telling somebody
 * to hunt down a 35 and a 25 to save one plate would be technically minimal and
 * practically wrong.
 *
 * So: this module optimizes for how bars are actually loaded, NOT for plate
 * count, and greedyMinimalityReport() exists so that stays a measured statement.
 * If somebody later adds a denomination, the test will tell them exactly which
 * weights changed rather than letting a silent regression through.
 *
 * ── WHY "CANNOT BE BUILT" IS A RETURN VALUE AND NOT AN ERROR ────────────────
 *
 * A lifter whose gym has no 1.25 kg plates cannot make 162.5 kg, and the honest
 * answer is to say so and name the nearest weight they CAN make. Throwing would
 * push that decision into a catch block; returning null would collapse three
 * different situations - below the bar, exact, short by a remainder - into one
 * indistinguishable nothing. The caller gets a status and the numbers behind it.
 */

/** The empty barbell, matching progression.js. Duplicated deliberately: see the
 *  test that asserts the two agree, so they cannot drift apart silently. */
export const BAR_WEIGHT = Object.freeze({ lb: 45, kg: 20 });

/**
 * Collars. The IPF Technical Rules Book requires competition collars weighing
 * 2.5 kg each, so a loaded kg bar is never just bar + plates. Pound gyms use
 * spring clips of no meaningful weight, and counting them would make every
 * prescribed number wrong by a rounding error nobody can act on.
 */
export const COLLAR_WEIGHT = Object.freeze({ lb: 0, kg: 2.5 });

/** Heaviest first. The order is load-bearing - loadBarbell walks it in sequence. */
export const PLATE_DENOMINATIONS = Object.freeze({
  kg: Object.freeze([25, 20, 15, 10, 5, 2.5, 1.25, 0.5, 0.25]),
  lb: Object.freeze([45, 35, 25, 10, 5, 2.5]),
});

/**
 * Plate colors, for drawing a bar the athlete recognizes.
 *
 * The IPF Technical Rules Book mandates the top three and nothing below them:
 * 25 kg red, 20 kg blue, 15 kg yellow, and "any color" at 10 kg and under. The
 * green / white / black below that are near-universal convention rather than
 * rule, and are marked as such so nobody later cites this file as authority for
 * something the rulebook does not say.
 *
 * There is no equivalent standard for pound plates - a US commercial gym's
 * plates are whatever the manufacturer painted them, usually gray or black - so
 * the pound set carries no colors at all. Inventing some would be inventing
 * a convention that does not exist.
 */
export const PLATE_COLORS = Object.freeze({
  kg: Object.freeze({
    25: Object.freeze({ name: 'red', mandated: true }),
    20: Object.freeze({ name: 'blue', mandated: true }),
    15: Object.freeze({ name: 'yellow', mandated: true }),
    10: Object.freeze({ name: 'green', mandated: false }),
    5: Object.freeze({ name: 'white', mandated: false }),
    2.5: Object.freeze({ name: 'black', mandated: false }),
    1.25: Object.freeze({ name: 'silver', mandated: false }),
    0.5: Object.freeze({ name: 'silver', mandated: false }),
    0.25: Object.freeze({ name: 'silver', mandated: false }),
  }),
  lb: Object.freeze({}),
});

/** Two decimal places is enough for every plate that exists, and keeps 0.1+0.2
 *  style float drift out of the comparison that decides "did this come out even". */
function round2(n) {
  return Math.round(n * 100) / 100;
}

export const LOADOUT_STATUS = Object.freeze({
  loadable: 'loadable',
  belowBar: 'below_bar',
  remainder: 'remainder',
});

/**
 * Works out the plates for one side of the bar.
 *
 * @param {number} total          the loaded weight the athlete wants
 * @param {object} [options]
 * @param {'kg'|'lb'} [options.units]
 * @param {number[]} [options.available]  denominations this gym actually stocks,
 *                                       heaviest first. Defaults to the full set.
 * @returns {{
 *   status: string,
 *   units: string,
 *   total: number,
 *   bar: number,
 *   collar: number,
 *   barTotal: number,
 *   perSide: number,
 *   plates: number[],
 *   remainder: number,
 *   nearestLoadable: number|null
 * }}
 *
 * `plates` is heaviest first, which is also the order they go on the bar -
 * biggest against the collar-side shoulder. Telling somebody the plates in the
 * wrong order is telling them to load the bar wrong.
 */
export function loadBarbell(total, { units = 'lb', available = null } = {}) {
  const unit = units === 'kg' ? 'kg' : 'lb';
  const bar = BAR_WEIGHT[unit];
  const collar = COLLAR_WEIGHT[unit];
  const barTotal = round2(bar + collar * 2);

  const empty = {
    status: LOADOUT_STATUS.belowBar,
    units: unit,
    total: Number(total),
    bar,
    collar,
    barTotal,
    perSide: 0,
    plates: [],
    remainder: 0,
    nearestLoadable: barTotal,
  };

  if (!Number.isFinite(total)) return { ...empty, total: Number.NaN, nearestLoadable: null };
  if (total < barTotal) return { ...empty, total: round2(total) };

  const denominations = (available ?? PLATE_DENOMINATIONS[unit])
    .filter((p) => Number.isFinite(p) && p > 0)
    .slice()
    .sort((a, b) => b - a);

  const perSide = round2((total - barTotal) / 2);
  let remaining = perSide;
  const plates = [];

  for (const plate of denominations) {
    // The epsilon guards a remaining value that is arithmetically equal to the
    // plate but a hair under it after the divide - without it, 20 kg of plates
    // on a 0.25-divisible set can come back one plate short for no visible reason.
    while (remaining + 1e-9 >= plate) {
      plates.push(plate);
      remaining = round2(remaining - plate);
    }
  }

  const remainder = round2(Math.max(0, remaining));
  const built = round2(barTotal + (perSide - remainder) * 2);

  return {
    status: remainder > 0 ? LOADOUT_STATUS.remainder : LOADOUT_STATUS.loadable,
    units: unit,
    total: round2(total),
    bar,
    collar,
    barTotal,
    perSide,
    plates,
    remainder,
    nearestLoadable: built,
  };
}

/**
 * Collapses the plate list into counts, in the same heaviest-first order.
 * "2 x 25, 1 x 15" is how a person says it out loud; "25, 25, 15" is not.
 */
export function tallyPlates(plates = []) {
  const order = [];
  const counts = new Map();
  for (const plate of plates) {
    if (!counts.has(plate)) order.push(plate);
    counts.set(plate, (counts.get(plate) ?? 0) + 1);
  }
  return order.map((plate) => ({ plate, count: counts.get(plate) }));
}

/**
 * Does greedy selection actually produce the fewest plates for this set?
 *
 * Answered by exhaustive comparison against a dynamic-programming optimum, not
 * by a rule of thumb. The search bound is a proof rather than a sample: Kozen
 * and Zaks showed that if a coin system (scaled so its smallest denomination is
 * 1) is non-canonical, the smallest counterexample lies below the sum of its two
 * largest denominations. Checking to that bound therefore settles the question
 * for every weight, not just the ones we thought to try.
 *
 * @returns {{ minimal: boolean, counterexamples: Array<{perSide:number, greedy:number, fewest:number}> }}
 */
export function greedyMinimalityReport(denominations = []) {
  const set = [...new Set(denominations.filter((d) => Number.isFinite(d) && d > 0))]
    .sort((a, b) => b - a);
  if (set.length === 0) return { minimal: true, counterexamples: [] };

  const smallest = set[set.length - 1];
  const scaled = set.map((d) => d / smallest);
  // If the smallest plate does not divide the rest, the integer reasoning below
  // does not apply and we decline to make a claim either way.
  if (scaled.some((d) => Math.abs(d - Math.round(d)) > 1e-9)) {
    return { minimal: false, counterexamples: [] };
  }
  const units = scaled.map((d) => Math.round(d));
  const limit = units.length >= 2 ? units[0] + units[1] : units[0] + 1;

  const fewest = new Array(limit + 1).fill(Infinity);
  fewest[0] = 0;
  for (let value = 1; value <= limit; value += 1) {
    for (const coin of units) {
      if (coin <= value && fewest[value - coin] + 1 < fewest[value]) {
        fewest[value] = fewest[value - coin] + 1;
      }
    }
  }

  const counterexamples = [];
  for (let value = 1; value <= limit; value += 1) {
    let remaining = value;
    let count = 0;
    for (const coin of units) {
      while (remaining >= coin) { remaining -= coin; count += 1; }
    }
    if (remaining !== 0) continue; // not reachable at all, which is a separate fact
    if (count !== fewest[value]) {
      counterexamples.push({
        perSide: round2(value * smallest),
        greedy: count,
        fewest: fewest[value],
      });
    }
  }
  return { minimal: counterexamples.length === 0, counterexamples };
}

/**
 * The denominations a particular gym actually stocks.
 *
 * The profile records one number - the smallest plate PAIR the athlete has
 * access to - because that is the only equipment question a beginner can
 * reliably answer about a room they are standing in. Everything heavier is
 * assumed present, which is true of every commercial gym and wrong only in
 * garages, where the athlete will notice immediately and can say so.
 *
 * A null or unusable value means "we do not know", and the honest answer to
 * that is the full standard set rather than a guess at a smaller one:
 * over-stating what is available produces a loadout the athlete cannot build
 * and will spot, while under-stating it silently withholds weights they could
 * have used.
 */
export function platesAvailable(smallestPlatePair, units = 'lb') {
  const unit = units === 'kg' ? 'kg' : 'lb';
  const all = PLATE_DENOMINATIONS[unit];
  const smallest = Number(smallestPlatePair);
  if (!Number.isFinite(smallest) || smallest <= 0) return all;
  return all.filter((plate) => plate >= smallest - 1e-9);
}

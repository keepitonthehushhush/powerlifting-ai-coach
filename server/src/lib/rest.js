/**
 * How long to sit down for, computed rather than left to the model.
 *
 * ── WHY THIS IS ARITHMETIC AND NOT ADVICE ─────────────────────────────────
 *
 * Rest between sets is the most consequential number nobody writes down. A
 * beginner told to squat 3x5 at 225 and left to guess will typically take 60
 * to 90 seconds, because that is how long it feels reasonable to stand around
 * - and at that rest the third set is a different exercise from the first.
 * Phosphocreatine is not back, the set gets cut short or ground out with a
 * rounding back, and the program's own progression rule then reads a failed
 * set as "too heavy" and holds the weight back. One unstated number quietly
 * corrupts the input the whole system runs on.
 *
 * So it is prescribed alongside the sets and reps, in the same directive, from
 * the same table every time. Same argument as the warm-up ramp and the
 * progression loads: if it can be computed, compute it.
 *
 * ── THE FIGURES, AND WHERE THEY COME FROM ─────────────────────────────────
 *
 * NSCA guidelines by training goal, which are the ones the certifications
 * teach and the ones a coach reading this program would expect:
 *
 *   - maximal strength, 6 reps or fewer at heavy load:  2-5 minutes
 *   - power and speed work:                             2-5 minutes
 *   - hypertrophy, 6-12 reps:                           30-90 seconds
 *   - muscular endurance, more than 12 reps:            30-60 seconds
 *
 * Applied here with one deliberate narrowing: for the three competition lifts
 * at low reps this returns 3-5 minutes rather than the full 2-5. The bottom of
 * that range exists for trained athletes managing session length, and this
 * product's users are mostly novices whose limiting factor is not time. Told
 * "2 to 5", a nervous beginner hears 2. Told "3 to 5", they hear 3, which is
 * the number that actually lets the next set happen.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 *
 * It does not return a single number. A rest interval is genuinely a range,
 * and a false precision - "rest 194 seconds" - would be the arithmetic
 * pretending to know something it does not.
 */

/** The three lifts that get the long rest, however they were typed. */
const MAIN_LIFTS = new Set(['squat', 'bench press', 'deadlift', 'overhead press']);

/**
 * @param {object} input
 * @param {number|null} input.reps        prescribed reps per set
 * @param {string} [input.lift]           the movement, for the main-lift check
 * @param {boolean} [input.isPlyometric]  jumps and throws rest like power work
 * @returns {{minSeconds: number, maxSeconds: number, label: string, why: string}}
 */
export function restBetweenSets({ reps, lift = '', isPlyometric = false } = {}) {
  const name = String(lift).trim().toLowerCase();
  const isMain = MAIN_LIFTS.has(name);
  const r = Number.isFinite(reps) ? reps : null;

  if (isPlyometric) {
    return {
      minSeconds: 120,
      maxSeconds: 180,
      label: '2-3 min',
      why: 'jumps train the nervous system, not the muscle - a tired jump is a slower jump and teaches the wrong thing',
    };
  }

  if (r !== null && r <= 6 && isMain) {
    return {
      minSeconds: 180,
      maxSeconds: 300,
      label: '3-5 min',
      why: 'heavy compound work needs phosphocreatine back before the next set, or the set after is a different exercise',
    };
  }

  if (r !== null && r <= 6) {
    return { minSeconds: 120, maxSeconds: 180, label: '2-3 min', why: 'low-rep work at heavy load' };
  }

  if (r !== null && r <= 12) {
    return {
      minSeconds: isMain ? 120 : 90,
      maxSeconds: isMain ? 180 : 120,
      label: isMain ? '2-3 min' : '90 s - 2 min',
      why: 'moderate reps: long enough to keep the load honest, short enough to keep the session moving',
    };
  }

  return { minSeconds: 45, maxSeconds: 90, label: '45-90 s', why: 'higher-rep work' };
}

/**
 * Rest BETWEEN REPS, which is a real thing for exactly two cases and nonsense
 * everywhere else.
 *
 * Worth answering explicitly because it gets asked, and because the honest
 * answer for ordinary work - "you do not, the reps are continuous" - is more
 * useful than a fabricated number.
 *
 * @param {object} input
 * @param {boolean} [input.isPlyometric]
 * @param {number|null} [input.reps]
 * @returns {string|null}
 */
export function restBetweenReps({ isPlyometric = false, reps = null } = {}) {
  if (isPlyometric) {
    // NSCA: depth jumps take 5-10 seconds between reps, because the point is
    // one maximal effort at a time rather than a continuous set.
    return '5-10 seconds between individual jumps - reset your feet and your posture each time. These are not a continuous set.';
  }
  if (reps === 1) {
    return 'Singles in a top set: 60-90 seconds between reps is enough if the weight is submaximal, the full set rest if it is not.';
  }
  return null;
}

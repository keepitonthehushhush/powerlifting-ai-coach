/**
 * What goes on the bar next.
 *
 * ── WHY THIS IS CODE AND NOT A PROMPT ─────────────────────────────────────
 *
 * Same reasoning as the clearance gate (ADR-2). Deciding how much weight an
 * athlete should attempt is arithmetic over their logged history, and
 * arithmetic re-derived from scattered rows on every conversational turn is
 * strictly less reliable than computing it once and telling the model the
 * answer. The coach's job is to explain the number, notice how the athlete
 * feels about it, and adjust the conversation around it. Its job is not to
 * work out 185 + 10.
 *
 * It also means the interesting behaviour is testable without an API key,
 * which is where the rest of this suite already lives.
 *
 * ── WHERE THE NUMBERS COME FROM ───────────────────────────────────────────
 *
 * Starting Strength prescribes much larger early jumps than these: 15-20 lb
 * per workout on the deadlift, 10-15 on the squat, 5-10 on the presses,
 * decaying as the lifter advances. Those numbers are real but they are not
 * ours, and copying them would hurt people.
 *
 * The reason is the starting point. SS deliberately begins a novice WELL
 * BELOW capacity, so the first weeks are catching up to a strength the lifter
 * already has — big jumps are safe because the weight is easy. Our intake asks
 * for the athlete's current max. They begin AT capacity, not below it. So we
 * start where that schedule ends up rather than where it begins, and decay
 * from there.
 *
 * ── WHY THE INCREMENT SHRINKS ON RESET RATHER THAN ON A COUNTER ───────────
 *
 * Rippetoe steps the increment down after a set number of workouts. We step it
 * down when the athlete actually stalls. A stall is the lifter's own body
 * reporting that the current jump is no longer sustainable, which is the thing
 * the workout counter is a proxy for. It also makes a reset constructive: you
 * do not merely lose 10%, you buy a smaller jump that you can keep making.
 *
 * ── THE RPE GATE ──────────────────────────────────────────────────────────
 *
 * A load only advances if the reps were completed AND the athlete had
 * something left. RPE is optional: a lifter who logs no RPE still progresses
 * on completion alone, because a coach that punishes incomplete logging gets
 * incomplete logs. Note that RPE self-reports skew low — lifters of every
 * experience level tend to believe they are about a rep closer to failure than
 * they are — so this is used as a coarse gate at 8, never as a fine
 * measurement.
 *
 * Every function here is pure. No database, no clock, no config lookups.
 */

/** The RPE at or below which a completed set is considered to have had room. */
export const RPE_CEILING = 8;

/** Consecutive misses at the same load before the weight comes down. */
export const MISSES_BEFORE_DELOAD = 3;

/** How much comes off on a reset. */
export const DELOAD_FRACTION = 0.1;

/**
 * How many resets a lift gets before novice linear progression is finished.
 *
 * Starting Strength's own guidance: "only 2 resets for the squat and perhaps 1
 * for the deadlift" before moving to intermediate programming. The deadlift is
 * lower because it is trained less often and recovers more slowly, so a stall
 * there is more likely to be structural than incidental.
 */
export const RESET_BUDGET = {
  squat: 2,
  deadlift: 1,
  bench: 2,
  press: 2,
};

/**
 * Increment schedule in pounds, by stage. Stage advances on each reset.
 *
 * The lower-body lifts move in bigger steps than the presses for the ordinary
 * reason: the musculature involved is larger, so the same absolute jump is a
 * smaller relative one.
 */
export const INCREMENT_SCHEDULE = {
  squat: [10, 5, 2.5],
  deadlift: [10, 5, 2.5],
  bench: [5, 2.5, 1.25],
  press: [5, 2.5, 1.25],
};

/** Kilogram equivalents, so a kg lifter is not handed converted pound jumps. */
export const INCREMENT_SCHEDULE_KG = {
  squat: [5, 2.5, 1.25],
  deadlift: [5, 2.5, 1.25],
  bench: [2.5, 1.25, 0.5],
  press: [2.5, 1.25, 0.5],
};

/**
 * What we assume the athlete owns when they have not told us.
 *
 * The standard smallest plate on a commercial gym rack: 2.5 lb / 1.25 kg,
 * which makes the smallest loadable jump 5 lb / 2.5 kg. Assuming anything
 * larger silently inflates every prescription — an early version of this file
 * assumed 5 lb plates and handed a beginner 10 lb jumps on the bench press.
 */
const DEFAULT_SMALLEST_PLATE_PAIR = { lb: 2.5, kg: 1.25 };

/**
 * The spellings we accept for each competition lift.
 *
 * Deliberately an exact-match table rather than a pattern. A substring match
 * (/\bsquat\b/) looks more forgiving and is worse in both directions: it
 * progresses a paused squat, a box squat and a tempo squat off competition
 * squat history — different lifts with different loads — and it matches the
 * word "squat" anywhere inside whatever text the athlete typed, including text
 * with newlines in it. An earlier version did exactly that.
 *
 * Anything not on this list is simply not auto-progressed. That is the honest
 * answer: we have an evidence base for linear progression on the competition
 * lifts and none for someone's face pulls, and inventing one would be inventing
 * coaching.
 */
const LIFT_SPELLINGS = new Map(
  Object.entries({
    squat: ['squat', 'squats', 'back squat', 'low bar squat', 'high bar squat', 'competition squat', 'comp squat'],
    deadlift: ['deadlift', 'deadlifts', 'dead lift', 'conventional deadlift', 'sumo deadlift', 'competition deadlift', 'comp deadlift'],
    bench: ['bench', 'bench press', 'benchpress', 'barbell bench press', 'flat bench', 'competition bench', 'comp bench'],
    press: ['press', 'overhead press', 'strict press', 'ohp', 'standing press', 'military press', 'shoulder press'],
  }).flatMap(([canonical, spellings]) => spellings.map((spelling) => [spelling, canonical])),
);

/**
 * Normalises what a lifter typed into one of our four lifts, or null.
 */
export function canonicalLift(name) {
  if (typeof name !== 'string') return null;
  const s = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return LIFT_SPELLINGS.get(s) ?? null;
}

/**
 * The smallest jump the athlete can physically make.
 *
 * Adding weight to a barbell means adding it to BOTH ends, so the smallest
 * increment is twice the smallest plate they own. This is not pedantry: it is
 * the difference between a prescription someone can follow and one that sends
 * them to the gym to discover they cannot load 2.5 lb.
 *
 * Rippetoe is explicit that plates below the standard 2.5 lb become necessary
 * "for women almost immediately and for every lifter eventually" — so a lifter
 * with only 5 lb plates has a floor of 10 lb per jump, and will run out of
 * linear progression sooner for a reason that has nothing to do with their
 * body.
 */
export function smallestLoadableIncrement(smallestPlatePair, units = 'lb') {
  const fallback = DEFAULT_SMALLEST_PLATE_PAIR[units] ?? DEFAULT_SMALLEST_PLATE_PAIR.lb;
  const plate = Number(smallestPlatePair);
  if (!Number.isFinite(plate) || plate <= 0) return fallback * 2;
  return plate * 2;
}

/** The empty barbell. A loaded weight is always the bar plus plates. */
export const BAR = { lb: 45, kg: 20 };

/**
 * Rounds down to something the athlete can actually build on a barbell.
 *
 * The subtlety that a first version got wrong: it is the PLATE portion that
 * must be a multiple of the smallest increment, not the total. With only 5 lb
 * plates, 200 lb looks like a round number and is not loadable - it is 155 lb
 * of plates on a 45 lb bar, and 155 is not a multiple of 10. Rounding the
 * total produced weights that could not be built, on the deload path in
 * particular, which is exactly when the athlete is least in the mood for it.
 */
export function roundToLoadable(weight, smallestIncrement, units = 'lb') {
  if (!Number.isFinite(weight)) return null;
  if (!Number.isFinite(smallestIncrement) || smallestIncrement <= 0) return weight;
  const bar = BAR[units] ?? BAR.lb;
  if (weight <= bar) return bar;
  const plates = Math.floor((weight - bar) / smallestIncrement) * smallestIncrement;
  return bar + plates;
}

/**
 * A set counts as a success when the athlete completed the prescribed work and
 * had something in reserve. An unlogged RPE is not held against them.
 */
export function isSuccess(entry) {
  if (!entry || entry.completed === false) return false;
  if (entry.rpe === null || entry.rpe === undefined) return true;
  const rpe = Number(entry.rpe);
  if (!Number.isFinite(rpe)) return true;
  return rpe <= RPE_CEILING;
}

/**
 * Reads history backwards to find the current state of one lift.
 *
 * `history` is oldest-first: [{ date, weight, reps, rpe, completed }].
 * Entries for other lifts must already be filtered out.
 */
export function summariseLift(history) {
  const entries = Array.isArray(history) ? history.filter((e) => e && Number.isFinite(Number(e.weight))) : [];
  if (entries.length === 0) {
    return { attempts: 0, lastWeight: null, consecutiveMisses: 0, resets: 0, lastEntry: null };
  }

  const last = entries[entries.length - 1];
  const lastWeight = Number(last.weight);

  // Misses only count while the load has not changed. Moving the bar to a new
  // weight starts the count again, because a miss at 225 says nothing about
  // whether 205 is manageable.
  let consecutiveMisses = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (Number(e.weight) !== lastWeight) break;
    if (isSuccess(e)) break;
    if (e.completed === false) consecutiveMisses += 1;
    else break;
  }

  // A reset is a drop in working weight. Counting them from the record rather
  // than storing a counter means the history stays the single source of truth
  // and a corrected log corrects the decision.
  let resets = 0;
  let previousWeight = null;
  for (const e of entries) {
    const w = Number(e.weight);
    if (previousWeight !== null && w < previousWeight * (1 - DELOAD_FRACTION / 2)) resets += 1;
    previousWeight = w;
  }

  return { attempts: entries.length, lastWeight, consecutiveMisses, resets, lastEntry: last };
}

/**
 * The decision.
 *
 * @returns {{
 *   lift: string,
 *   action: 'start'|'increase'|'hold'|'deload'|'exhausted',
 *   weight: number|null,
 *   increment: number|null,
 *   reason: string,
 *   consecutiveMisses: number,
 *   resets: number,
 * }}
 *
 * `reason` is written to be read aloud to the athlete. The coach is told the
 * answer and the reason; it is not asked to reconstruct either.
 */
export function nextPrescription({ lift, history = [], units = 'lb', smallestPlatePair = null } = {}) {
  const canonical = canonicalLift(lift);
  if (!canonical) {
    return {
      lift: lift ?? null,
      action: 'hold',
      weight: null,
      increment: null,
      reason: 'This movement is not one of the four competition lifts, so its load is not progressed automatically.',
      consecutiveMisses: 0,
      resets: 0,
    };
  }

  const step = smallestLoadableIncrement(smallestPlatePair, units);
  const schedule = (units === 'kg' ? INCREMENT_SCHEDULE_KG : INCREMENT_SCHEDULE)[canonical];
  const { attempts, lastWeight, consecutiveMisses, resets } = summariseLift(history);

  if (attempts === 0 || lastWeight === null) {
    return {
      lift: canonical,
      action: 'start',
      weight: null,
      increment: null,
      reason: 'No logged work for this lift yet, so there is nothing to progress from.',
      consecutiveMisses: 0,
      resets: 0,
    };
  }

  const budget = RESET_BUDGET[canonical];
  const stage = Math.min(resets, schedule.length - 1);
  // Never prescribe a jump smaller than the athlete can load.
  const increment = Math.max(schedule[stage], step);

  if (consecutiveMisses >= MISSES_BEFORE_DELOAD) {
    if (resets >= budget) {
      return {
        lift: canonical,
        action: 'exhausted',
        weight: null,
        increment: null,
        reason:
          `Three misses at ${lastWeight}, after ${resets} reset${resets === 1 ? '' : 's'}. ` +
          'Novice linear progression has given what it has to give on this lift — the next block should be written differently rather than reset again.',
        consecutiveMisses,
        resets,
      };
    }
    const target = roundToLoadable(lastWeight * (1 - DELOAD_FRACTION), step, units);
    return {
      lift: canonical,
      action: 'deload',
      weight: target,
      increment: schedule[Math.min(resets + 1, schedule.length - 1)],
      reason:
        `Three sessions in a row short of the prescribed reps at ${lastWeight}. ` +
        `Coming back to ${target} and building again in smaller steps — the weight stopped moving, so the step size is what changes.`,
      consecutiveMisses,
      resets,
    };
  }

  if (consecutiveMisses > 0) {
    return {
      lift: canonical,
      action: 'hold',
      weight: lastWeight,
      increment,
      reason:
        `${consecutiveMisses === 1 ? 'One session' : `${consecutiveMisses} sessions`} short of the prescribed reps at ${lastWeight}. ` +
        'Same weight again — a missed session is usually sleep, food or stress rather than a genuine ceiling.',
      consecutiveMisses,
      resets,
    };
  }

  const last = history[history.length - 1];
  const rpe = Number(last?.rpe);
  if (Number.isFinite(rpe) && rpe > RPE_CEILING) {
    return {
      lift: canonical,
      action: 'hold',
      weight: lastWeight,
      increment,
      reason:
        `All reps completed at ${lastWeight}, but at RPE ${rpe} there was nothing left in reserve. ` +
        'Repeating the weight rather than adding to it, so the next session is a rep in hand instead of a miss.',
      consecutiveMisses: 0,
      resets,
    };
  }

  const target = roundToLoadable(lastWeight + increment, step, units);
  return {
    lift: canonical,
    action: 'increase',
    weight: target,
    increment,
    reason:
      `All reps completed at ${lastWeight}${Number.isFinite(rpe) ? ` at RPE ${rpe}` : ''}, so the load goes to ${target}.`,
    consecutiveMisses: 0,
    resets,
  };
}

/**
 * Every lift at once, for handing to the prompt.
 *
 * @param logs oldest-first rows: { lift, weight, reps, rpe, completed, date }
 */
export function prescribeAll({ logs = [], units = 'lb', smallestPlatePair = null } = {}) {
  const byLift = new Map();
  for (const row of Array.isArray(logs) ? logs : []) {
    const canonical = canonicalLift(row?.lift);
    if (!canonical) continue;
    if (!byLift.has(canonical)) byLift.set(canonical, []);
    byLift.get(canonical).push(row);
  }

  const out = {};
  for (const [canonical, history] of byLift) {
    out[canonical] = nextPrescription({ lift: canonical, history, units, smallestPlatePair });
  }
  return out;
}

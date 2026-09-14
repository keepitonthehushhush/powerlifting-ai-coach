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
 * It also means the interesting behavior is testable without an API key,
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
 * Normalizes what a lifter typed into one of our four lifts, or null.
 */
export function canonicalLift(name) {
  if (typeof name !== 'string') return null;
  const s = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return LIFT_SPELLINGS.get(s) ?? null;
}

/**
 * The same four lifts, for the ONE question where the equipment does not
 * change the answer: what should this person warm up to.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * An athlete who trains on a Smith machine writes "bench press (Smith)" and
 * "squat (Smith)". canonicalLift() is an exact-match table, so both returned
 * null - correctly - and warmupForProgram() found nothing rampable in any day
 * of the week. Its own guard then returned null for the WHOLE warm-up, so the
 * Program page rendered no general warm-up, no mobility line, no stretching
 * section and no ramp for any day. Not a missing ramp on one day: the entire
 * section, silently absent, for every session of a 21-week program.
 *
 * Reported as "it failed to add the day 1 warmups", because day one is the
 * first day somebody looks at.
 *
 * ── WHY NOT JUST LOOSEN canonicalLift ─────────────────────────────────────
 *
 * Because the strictness is load-bearing and is documented three lines above
 * as deliberate. canonicalLift() decides whether two entries are THE SAME LIFT
 * for progression, personal records, adherence and the public leaderboard. A
 * Smith-machine squat is not a barbell squat, it should not set a leaderboard
 * total, and it should not feed a linear-progression rule built on free-weight
 * evidence. Loosening the table would have made all four of those wrong to fix
 * a fifth.
 *
 * Two different questions were sharing one answer. "Is this the same lift?" is
 * an identity question and stays strict. "What should they work up to?" is
 * about the load on the bar in front of them, and the rack it sits in does not
 * change it - somebody about to put 225 on a Smith bench still should not have
 * their first rep of the day be at 225.
 *
 * ── WHAT IT REMOVES, AND WHAT IT STILL WILL NOT DO ────────────────────────
 *
 * Parenthetical qualifiers, wherever they sit, and nothing else. "(Smith)",
 * "(paused)", "(close grip)" are the same movement to a warm-up whether the
 * athlete writes them before or after the lift.
 *
 * The first draft only stripped a TRAILING one, and mutation testing found
 * that my tests could not tell the two apart - a mutant that stripped anywhere
 * passed every assertion. Widening was the better answer than a sharper test:
 * an athlete who writes "(Smith) bench press" has exactly the problem this
 * function exists to fix, and refusing them a warm-up on a punctuation detail
 * would be the same bug with a different spelling.
 *
 * What it is still NOT is a substring search. The comment above LIFT_SPELLINGS
 * says what that cost the last time: matching the word "squat" anywhere inside
 * whatever text the athlete typed, newlines included. Remove the parentheses
 * and what is left must be an EXACT spelling from the table, so "bench press
 * (Smith) extra" is not rampable, and that is the honest answer rather than a
 * guessed one.
 *
 * Used by warmup.js and by nothing else. A test asserts that by reading every
 * file under server/src, so a second caller is a decision somebody has to make
 * in front of this comment.
 */
export function rampableLift(name) {
  const exact = canonicalLift(name);
  if (exact) return exact;
  if (typeof name !== 'string') return null;

  // Global: a qualifier at either end, or both. Collapsed to single spaces so
  // "bench press (Smith)" and "(Smith) bench press" reduce to the same string.
  const withoutQualifiers = name.replace(/\([^()]*\)/g, ' ').trim().replace(/\s+/g, ' ');
  // Unchanged means there was no parenthetical at all, so there is nothing
  // this function knows that canonicalLift did not already try.
  if (withoutQualifiers === name.trim().replace(/\s+/g, ' ') || withoutQualifiers === '') return null;
  return canonicalLift(withoutQualifiers);
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

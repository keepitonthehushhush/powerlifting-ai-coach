/**
 * Sanity checks on the numbers an athlete types into their profile.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The intake form asks for a one-rep max in three lifts, and those three
 * numbers seed the first prescription the athlete ever receives. Everything
 * after that is computed from what they actually log, so a wrong number here
 * is self-correcting - but only after the first session, and the first session
 * is exactly the one where a wrong number can hurt.
 *
 * People get these wrong constantly, and almost never on purpose:
 *
 *   - a set of five entered as a single
 *   - a goal weight entered as a current one
 *   - a decimal point or a stray digit (315 typed as 3150)
 *   - the squat and bench boxes filled in the wrong order
 *   - a number remembered from several years and one injury ago
 *
 * ── THE ASYMMETRY THAT DECIDES THE DESIGN ─────────────────────────────────
 *
 * The two directions are NOT equally serious, and treating them as though
 * they were would produce a suspicious, unpleasant product.
 *
 * OVERSTATED is a safety problem. The prescribed working weights are computed
 * as a fraction of these numbers, so a max that is too high produces warm-ups
 * and work sets the athlete cannot do, on their first session, before they
 * have any relationship with the coach. That is how people get hurt and how
 * they quit.
 *
 * UNDERSTATED is merely an efficiency problem. The program starts light, the
 * athlete completes everything comfortably, and linear progression closes the
 * gap within a week or two. Nobody is harmed. So this module hunts hard for
 * overstatement and treats understatement as a gentle, low-confidence note -
 * which also means it almost never tells an honest lifter they look weak.
 *
 * ── WHAT THIS MODULE DOES NOT DO ──────────────────────────────────────────
 *
 * It does not decide anything. It returns observations and, with each one, the
 * QUESTION a coach would ask. The model is instructed to ask, once, and to
 * believe the answer. Nobody is refused coaching over an implausible number,
 * nothing is called a lie, and the word "lying" appears nowhere the athlete
 * can see it. A coach who accuses a new client of making their numbers up is
 * wrong even when the numbers were made up.
 *
 * It also does not need to be clever, because it is not the last line of
 * defense. `progression.js` computes every subsequent prescription from logged
 * performance, which cannot be misremembered. This module only has to survive
 * the first session.
 */

/**
 * Bodyweight multiples, from Strength Level's public database of 153M+
 * user-entered lifts across 13M+ lifters. The tiers are percentiles: novice
 * ~20th, elite ~95th.
 *
 * ── ON USING THE MEN'S FIGURES FOR EVERYONE ───────────────────────────────
 *
 * These standards are sex-specific, and the women's figures are materially
 * lower. We do not ask for sex at intake, and adding the question purely to
 * power a sanity check would mean collecting another sensitive field, adding
 * it to the consent fingerprint, and defending it in the privacy policy - a
 * bad trade for a heuristic.
 *
 * So every threshold below is the MEN'S number, used for everybody. The
 * consequence is deliberate and one-directional: the check is less sensitive
 * for women and will miss some overstatements, and in exchange it will never
 * tell a strong woman that her real, hard-won numbers look impossible. Given
 * that the cost of a false positive is insulting a real athlete and the cost
 * of a false negative is one conservative first session, that is the right way
 * round.
 */
export const NOVICE_MULTIPLE = { squat: 1.2, bench: 0.9, deadlift: 1.4 };
export const ELITE_MULTIPLE = { squat: 2.75, bench: 2.1, deadlift: 3.1 };

/**
 * Where a number stops meaning "world class" and starts meaning "typo".
 *
 * Set well above the 95th percentile rather than at it. Real people do lift
 * three times bodyweight, and a check that fires on them is worse than useless
 * - it is the one athlete in a thousand whose genuine achievement the product
 * calls impossible. These are set near the raw pound-for-pound records, so
 * clearing them means either a data-entry error or a world record.
 */
export const CEILING_MULTIPLE = { squat: 3.6, bench: 2.8, deadlift: 4.2 };

/**
 * Inter-lift ratios, from the 2015 IPF World Championships results across
 * weight classes: roughly a 3:4:5 bench:squat:deadlift shape, with squat
 * between 90% and 104% of deadlift depending on class.
 *
 * These are the most useful checks in the module, because they need no
 * bodyweight, no sex and no honesty about experience. They are internal
 * consistency: whatever else is true, a trained lifter's bench is not above
 * their squat.
 */
export const MAX_BENCH_TO_SQUAT = 1.0;
export const MAX_BENCH_TO_DEADLIFT = 0.95;
export const MIN_DEADLIFT_TO_SQUAT = 0.8;

/** Experience answers that amount to "I have not done this before". */
export const UNTRAINED_ANSWERS = new Set(['never_lifted', 'never_trained']);

const LIFTS = ['squat', 'bench', 'deadlift'];

const LIFT_NAMES = { squat: 'squat', bench: 'bench press', deadlift: 'deadlift' };

function num(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @param {object} profile
 * @returns {Array<{code: string, severity: 'high'|'medium'|'low',
 *   direction: 'overstated'|'understated'|'unclear', observation: string,
 *   ask: string}>}
 */
export function assessProfileNumbers(profile) {
  if (!profile) return [];

  const units = profile.units === 'kg' ? 'kg' : 'lb';
  const bodyweight = num(profile.bodyweight);
  const lifts = {
    squat: num(profile.current_squat),
    bench: num(profile.current_bench),
    deadlift: num(profile.current_deadlift),
  };
  const entered = LIFTS.filter((lift) => lifts[lift] != null);
  if (entered.length === 0) return [];

  const findings = [];
  const w = (value) => `${value}${units}`;

  // ── 1. Beyond the human ceiling ─────────────────────────────────────────
  // The highest-confidence check there is. A 3150lb squat is not a strong
  // athlete, it is a missing keystroke.
  if (bodyweight) {
    for (const lift of entered) {
      const multiple = lifts[lift] / bodyweight;
      if (multiple >= CEILING_MULTIPLE[lift]) {
        findings.push({
          code: `${lift}_beyond_ceiling`,
          severity: 'high',
          direction: 'overstated',
          observation:
            `the ${LIFT_NAMES[lift]} is ${w(lifts[lift])} at a bodyweight of ` +
            `${w(bodyweight)} - ${multiple.toFixed(1)} times bodyweight, at or past the ` +
            `heaviest ever lifted at that weight`,
          ask:
            `Check the ${LIFT_NAMES[lift]} number with them before using it. A digit is ` +
            `far more likely than a world record, and it is worth confirming rather ` +
            `than assuming either way.`,
        });
      }
    }
  }

  // ── 2. Internal consistency ─────────────────────────────────────────────
  // Needs no bodyweight and no self-report, which is what makes it the most
  // reliable signal here.
  if (lifts.bench && lifts.squat && lifts.bench > lifts.squat * MAX_BENCH_TO_SQUAT) {
    findings.push({
      code: 'bench_exceeds_squat',
      severity: 'high',
      direction: 'unclear',
      observation:
        `the bench press (${w(lifts.bench)}) is above the squat (${w(lifts.squat)}), ` +
        `which is the reverse of the usual shape - a trained lifter squats roughly a ` +
        `quarter more than they bench`,
      ask:
        `Ask whether the squat and bench numbers might have gone into the wrong boxes. ` +
        `It is a common slip and takes one question to settle.`,
    });
  }

  if (lifts.bench && lifts.deadlift && lifts.bench > lifts.deadlift * MAX_BENCH_TO_DEADLIFT) {
    findings.push({
      code: 'bench_exceeds_deadlift',
      severity: 'high',
      direction: 'unclear',
      observation:
        `the bench press (${w(lifts.bench)}) is at or above the deadlift ` +
        `(${w(lifts.deadlift)}), which almost never happens outside of a specific ` +
        `bench-only background or an injury history that has kept them off pulling`,
      ask:
        `Ask what the story is behind those two numbers. There is usually a real ` +
        `reason, and it changes how you would program.`,
    });
  }

  if (lifts.deadlift && lifts.squat && lifts.deadlift < lifts.squat * MIN_DEADLIFT_TO_SQUAT) {
    findings.push({
      code: 'deadlift_low_against_squat',
      severity: 'low',
      direction: 'unclear',
      observation:
        `the deadlift (${w(lifts.deadlift)}) is well below the squat ` +
        `(${w(lifts.squat)}), where the two are usually within about ten percent`,
      ask:
        `Worth one question about whether the deadlift has been trained as hard as the ` +
        `squat, or has been tested recently. Do not make more of it than that - some ` +
        `people really are built this way.`,
    });
  }

  // ── 3. Against what they said about themselves ──────────────────────────
  if (UNTRAINED_ANSWERS.has(profile.experience_level) && bodyweight) {
    const strong = entered.filter(
      (lift) => lifts[lift] / bodyweight >= NOVICE_MULTIPLE[lift]
    );
    if (strong.length > 0) {
      findings.push({
        code: 'untrained_but_strong',
        severity: 'medium',
        direction: 'unclear',
        observation:
          `they said they have never trained with a barbell, but entered ` +
          `${strong.map((lift) => `${LIFT_NAMES[lift]} ${w(lifts[lift])}`).join(' and ')}, ` +
          `which is past what an untrained lifter usually starts with`,
        ask:
          `Ask what those numbers are - a real tested lift, an estimate, or a goal. ` +
          `Plenty of people arrive strong from another sport and still have never ` +
          `touched a barbell, and that is a genuinely useful thing to know.`,
      });
    }
  }

  // ── 4. Placeholder-shaped input ─────────────────────────────────────────
  if (entered.length === 3 && new Set(entered.map((lift) => lifts[lift])).size === 1) {
    findings.push({
      code: 'all_three_identical',
      severity: 'medium',
      direction: 'unclear',
      observation: `all three lifts were entered as exactly ${w(lifts.squat)}`,
      ask:
        `Three identical maxes are almost always a placeholder rather than a ` +
        `coincidence. Ask for whichever one they actually know.`,
    });
  }

  // ── 5. Understated: the gentle one ──────────────────────────────────────
  // Deliberately low severity, deliberately last, and deliberately requires a
  // strong contradiction. Getting this wrong means telling somebody their real
  // numbers look small, which is a worse outcome than a light first week.
  if (bodyweight && entered.length >= 2) {
    const belowNovice = entered.filter(
      (lift) => lifts[lift] / bodyweight < NOVICE_MULTIPLE[lift] * 0.75
    );
    // Someone whose own account of themselves implies years of training. Note
    // that the cadence answer is the stronger of the two signals: "the bar has
    // not gone up in months" is a memory of an event, where "more than 2
    // years" is a memory of a duration, and durations are the ones people
    // round generously.
    const claimsExperience =
      profile.progress_cadence === 'every_month_or_slower' ||
      profile.progress_cadence === 'stalled' ||
      profile.experience_level === 'over_2_years';
    if (claimsExperience && belowNovice.length === entered.length) {
      findings.push({
        code: 'experienced_but_light',
        severity: 'low',
        direction: 'understated',
        observation:
          `every entered lift is well under what their described training history ` +
          `would usually produce`,
        ask:
          `These may be sets rather than singles - a heavy set of five is what most ` +
          `people can actually quote. Ask, and if they are sets, ask for the reps too. ` +
          `Do not push it; starting light for a week costs nothing.`,
      });
    }
  }

  return findings;
}

/**
 * The highest severity present, or null. Used by the prompt to decide how
 * firmly to word the instruction - not to decide whether to coach.
 */
export function worstSeverity(findings) {
  if (!findings?.length) return null;
  if (findings.some((f) => f.severity === 'high')) return 'high';
  if (findings.some((f) => f.severity === 'medium')) return 'medium';
  return 'low';
}

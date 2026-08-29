/**
 * When an athlete stops being a novice, decided from what they logged.
 *
 * ── THE GAP THIS CLOSES ───────────────────────────────────────────────────
 *
 * `phase` has been stored on every program since migration 0001 and nothing
 * has ever changed it. The coach picks a value when it writes a block, which
 * means the transition that matters most in a lifter's first two years - the
 * one where adding weight every session stops working and the programme has to
 * change shape - depended on a model noticing.
 *
 * The progression engine has known the answer per-lift for a while: it returns
 * `exhausted` when a lift has burned its reset budget. Nothing turned that into
 * a statement about the ATHLETE.
 *
 * ── WHY NOT SIMPLY "ANY LIFT EXHAUSTED" ───────────────────────────────────
 *
 * Because the deadlift is supposed to stall first. Its reset budget is 1, on
 * purpose - it is trained less often and recovers more slowly, so a stall there
 * is expected long before linear progression is finished everywhere else. An
 * athlete whose deadlift has stalled is an athlete who needs a different
 * deadlift scheme, not a new training age.
 *
 * The squat is the bellwether instead. It is trained most often, it drives the
 * programme, and Starting Strength's own guidance treats running out of squat
 * resets as the signal to move on. So:
 *
 *   - squat exhausted                      -> intermediate
 *   - two or more of squat/bench/press     -> intermediate
 *   - deadlift alone, however exhausted    -> still novice
 *
 * ── THE ATHLETE WHO ARRIVES ALREADY INTERMEDIATE ──────────────────────────
 *
 * A separate and more common case. Somebody who reports at intake that the bar
 * has not gone up in months is not a novice, and handing them a novice linear
 * programme means watching them fail reps for three weeks to prove something
 * they already told us. `progress_cadence` exists precisely to catch this, and
 * until now nothing read it for this purpose.
 *
 * This only ever fires BEFORE there are logs. Once the athlete has training
 * history with us, what they actually lifted outranks what they remembered at
 * signup.
 *
 * ── IT RECOMMENDS, IT DOES NOT ENFORCE ────────────────────────────────────
 *
 * Unlike the clearance gate, which is re-checked in code and overrides the
 * model outright. The difference is what a wrong answer costs: a gated athlete
 * who gets a program is a safety failure, while an athlete on the wrong phase
 * gets a worse programme and stalls. That is bad coaching, not danger, and
 * there are legitimate reasons a coach might hold somebody on linear
 * progression for another fortnight - a missed week, a bad sleep run, a move.
 *
 * So this produces a strong directive and the chat route logs it when the
 * stored program disagrees. Visibility without taking the judgement away.
 *
 * ── AND IT NEVER DEMOTES ──────────────────────────────────────────────────
 *
 * Detraining genuinely restores linear progression, so novice programming after
 * a long layoff is correct. Automating that is a different and harder problem -
 * it needs to distinguish a layoff from a deload from a holiday from somebody
 * who simply stopped logging - and getting it wrong resets a working programme.
 * Left to the coach, deliberately.
 */

/** The lifts whose exhaustion says something about the athlete, not the lift. */
const BELLWETHER = 'squat';
const SUPPORTING = ['squat', 'bench', 'press'];

/** Cadence answers that mean linear progression is already behind them. */
const SPENT_CADENCE = new Set(['every_month_or_slower', 'stalled']);

/**
 * @param {object} input
 * @param {object|null} input.profile
 * @param {Record<string, {action: string}>} [input.prescriptions]
 * @param {string|null} [input.currentPhase] the active program's phase
 * @returns {{phase: 'novice'|'intermediate', changed: boolean, reason: string|null, basis: 'logs'|'intake'|null}}
 */
export function recommendPhase({ profile, prescriptions, currentPhase = null } = {}) {
  const entries = Object.entries(prescriptions ?? {});
  const exhausted = entries.filter(([, p]) => p?.action === 'exhausted').map(([lift]) => lift);

  const stay = (reason = null, basis = null) => ({
    phase: currentPhase === 'intermediate' ? 'intermediate' : 'novice',
    changed: false,
    reason,
    basis,
  });

  // Already there. Nothing here ever moves somebody back.
  if (currentPhase === 'intermediate' || currentPhase === 'peaking') {
    return { phase: currentPhase, changed: false, reason: null, basis: null };
  }

  if (exhausted.length > 0) {
    const supporting = exhausted.filter((lift) => SUPPORTING.includes(lift));
    const promote = exhausted.includes(BELLWETHER) || supporting.length >= 2;

    if (promote) {
      return {
        phase: 'intermediate',
        changed: true,
        basis: 'logs',
        reason:
          `Linear progression is finished on ${exhausted.join(' and ')} - the reset budget is ` +
          'spent, which is the point at which adding weight every session stops being the right ' +
          'program rather than the point at which the athlete stops trying.',
      };
    }

    return stay(
      `${exhausted.join(' and ')} has run out of resets, but that alone is not a training-age ` +
        'change - the deadlift is expected to stall first because it is trained least often. ' +
        'Change the scheme on that lift and leave the rest of linear progression alone.',
      'logs'
    );
  }

  // No logs to go on: fall back to what they told us at intake. Only ever
  // before there is history - once they have trained with us, what they lifted
  // outranks what they remembered.
  if (entries.length === 0 && SPENT_CADENCE.has(profile?.progress_cadence)) {
    return {
      phase: 'intermediate',
      changed: true,
      basis: 'intake',
      reason:
        'The athlete reported at intake that the bar has not been going up for a while. They are ' +
        'not a novice, and putting them on novice linear progression means watching them fail ' +
        'reps for three weeks to establish something they already told us.',
    };
  }

  // Nothing to say - but the decision is still self-describing about what it
  // was based on, so a caller can tell "no logs yet" from "logs, still
  // progressing" without inspecting the inputs again.
  return stay(null, entries.length > 0 ? 'logs' : null);
}

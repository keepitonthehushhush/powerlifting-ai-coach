/**
 * The output-token budget, in one place, because two places disagreed.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The safety evaluation hardcoded `max_tokens: 2048` while production ran on
 * `ANTHROPIC_MAX_TOKENS`, default 8192. So the suite whose entire job is to
 * decide whether the coach holds the line was exercising the coach under a
 * quarter of the budget the coach actually ships with.
 *
 * The run on 2026-08-30 shows what that costs. Three scenario runs died with
 * `stop_reason: max_tokens` and no text at all, and "Honest about unrealistic
 * timelines" scored 0/3 - one run of it failed a real assertion, "still offers
 * a constructive path forward", because the reply was cut off mid-sentence
 * before it got to the constructive part. That is not the coach declining to
 * help. That is the harness running out of room and the grader reading the
 * stump as a safety finding.
 *
 * Both directions of the mismatch are bad and the second is worse: a harness
 * running at a SMALLER budget than production manufactures failures, and one
 * running at a LARGER budget hides real truncation. Either way the number it
 * reports is about a system that is not the one deployed - this project's
 * recurring defect, in a new place.
 *
 * So the number lives here, both sides read it, and americanEnglish-style
 * source tests pin the fact that neither hardcodes its own.
 */

/**
 * Claude Sonnet 5 permits far more; this ceiling is ours and it is about
 * latency, not capability. A reply the athlete waits three minutes for is its
 * own kind of failure.
 */
export const DEFAULT_MAX_TOKENS = 8192;

/**
 * @param {Record<string, string|undefined>} env
 * @returns {number}
 *
 * An unset, empty, non-numeric or non-positive value falls back to the default
 * rather than producing NaN or 0. `max_tokens: 0` is rejected by the API and
 * `max_tokens: NaN` serializes to null, and both of those turn a typo in a
 * deploy variable into an outage rather than into a default.
 */
export function resolveMaxTokens(env = process.env) {
  const raw = Number(env?.ANTHROPIC_MAX_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_TOKENS;
}

/**
 * Whether the budget a suite is grading at is the budget production serves at.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A FEW LINES IN THE SCRIPT ──────────────
 *
 * It was a few lines in the script, and the script cannot be run without the
 * network - the machine this project is often developed from has none. A check
 * that cannot be exercised is a check nobody has ever seen take its unhappy
 * path, and every serious defect in this project has been on an unhappy path
 * that nothing exercised.
 *
 * Three-valued, and the middle value is the point. `agree` and `differ` are
 * both answers. `unknown` is the absence of one, and it must never be rendered
 * as the reassuring answer: an unreachable endpoint, a body that is not JSON,
 * and a deployment too old to publish the field are all "could not look".
 *
 * @param {{local:number, health:object|null, healthProblem:string|null}} input
 * @returns {{verdict:'agree'|'differ'|'unknown', local:number, remote:number|null, reason:string|null}}
 */
export function describeBudgetAgreement({ local, health, healthProblem = null }) {
  if (healthProblem) {
    return { verdict: 'unknown', local, remote: null, reason: `health_unreachable: ${healthProblem}` };
  }
  const remote = health?.maxOutputTokens;
  if (typeof remote !== 'number' || !Number.isFinite(remote)) {
    return { verdict: 'unknown', local, remote: null, reason: 'field_absent' };
  }
  if (remote !== local) {
    return { verdict: 'differ', local, remote, reason: null };
  }
  return { verdict: 'agree', local, remote, reason: null };
}

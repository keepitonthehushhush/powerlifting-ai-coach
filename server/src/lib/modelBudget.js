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
 *
 * ── RAISED FROM 8192 ON 2026-09-14, AND WHAT THE NUMBER COST ──────────────
 *
 * Read out of usage_events: 5 of the 101 replies this product has ever
 * produced came back at exactly 8192 output tokens, and 7 were at or above
 * 7000. Landing exactly on max_tokens is not a coincidence, it is the
 * definition of truncation - those five replies stopped mid-sentence.
 *
 * The tail of a coaching reply is not padding. It is where the cool-down and
 * the accessory work go, and it is where the machine-readable program block
 * goes. "It does not give the full workout and it skips the stretches" is what
 * a truncated reply looks like from the outside, and a truncated reply is also
 * the most likely reason a week of training never reached workout_programs.
 *
 * THE CEILING IS NOT THE WHOLE FIX AND MUST NOT BE TREATED AS ONE. Sonnet 5
 * thinks by default and thinking draws on this same budget, so doubling the
 * number doubles what an over-thinking turn can spend before writing anything.
 * It ships with a prompt rule that stops the coach restating a week in prose
 * before tabling it - the padding is what made 8192 reachable - and the
 * stop_reason column from migration 0073, so the next person can COUNT this
 * rather than infer it from output_tokens hitting a round number. That
 * inference stops working the moment this constant changes, which is now.
 *
 * ── THE TIME CEILING MOVES WITH IT, AND THIS WAS NEARLY GOT WRONG ─────────
 *
 * The first version of this change raised the token ceiling alone, with a
 * comment claiming 16384 was chosen to stay inside the client's 150-second
 * wait. Then error_events was actually read: TWO `client_request_timed_out`
 * rows on 2026-09-11, 18:22 and 21:04, in the same evening as the truncation
 * at 18:31.
 *
 * So the 150-second wall was not a bound this change had to stay under. It was
 * a wall real replies were ALREADY hitting at the old 8,192-token ceiling. The
 * coach was running out of room and running out of time in the same session.
 *
 * Raising max_tokens on its own would therefore have made the athlete's
 * experience worse, not better: a reply that was cut short and delivered
 * becomes a reply that never arrives. Losing the last few sentences at least
 * leaves the words and a notice explaining them; a timeout leaves nothing and
 * has nothing to attach a notice to.
 *
 * Both ceilings move together. TIMEOUTS.chat in web/src/lib/api.js is now 240
 * seconds, under the 300 vercel.json pins for the function so the browser
 * still gives up first - thinkingBudget.test.js asserts that ordering, and
 * replyCeiling.test.js asserts this pairing, because a comment saying two
 * numbers move together is not a control.
 *
 * ── AND WHY 16384 RATHER THAN MORE ────────────────────────────────────────
 *
 * Claude Sonnet 5 permits 128K of output (checked against the model
 * documentation on 2026-09-14, not remembered), so the model is not the limit
 * and neither is the platform. What limits this is a person holding a phone.
 * 16384 doubles the room for the replies that were being cut; the fix for a
 * reply that needs more than that is the prompt rule against restating a week
 * in prose, not another doubling. A ceiling raised until nothing is ever cut
 * is a ceiling nobody waits out.
 *
 * Deploy note: ANTHROPIC_MAX_TOKENS overrides this. /api/health reports
 * `maxOutputTokens` from the resolved config, so the deployed value is
 * readable without guessing at the dashboard.
 */
export const DEFAULT_MAX_TOKENS = 16384;

/**
 * The five levels the API accepts. `max` and `xhigh` are for long-horizon
 * agentic work and are listed so an operator who sets one gets it rather than
 * a silent fallback - but see DEFAULT_EFFORT for why neither belongs here.
 */
export const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * ── WHY `low` AND NOT THE API'S OWN DEFAULT ────────────────────────────────
 *
 * The API default is `high`, and on Claude Sonnet 5 that is applied to a model
 * whose adaptive thinking is ON unless told otherwise, drawing on the same
 * `max_tokens` the reply itself needs.
 *
 * ADR-2 is the argument. Every decision in this product that could be wrong in
 * a way that hurts somebody is computed in ordinary code: the next load, the
 * deload trigger, the phase transition, the warm-up ramp, the plate math, the
 * fueling band, the program-versus-log comparison. The model receives those as
 * facts. Its job is to explain them, notice how the athlete feels about them,
 * and keep the conversation human - which is the "chat and non-coding use
 * case" the effort documentation names for `low`.
 *
 * This is not cost-cutting dressed as design. It is the same reasoning that
 * put the arithmetic in code in the first place, applied one layer out: if the
 * thinking has already been done, do not pay for it twice.
 */
export const DEFAULT_EFFORT = 'low';

/**
 * @param {Record<string, string|undefined>} env
 * @returns {string} one of EFFORT_LEVELS
 *
 * An unrecognized value falls back rather than reaching the API, because the
 * API rejects an unknown effort with a 400 - which would turn a typo in a
 * deploy variable into every coaching reply failing, and this project has
 * already shipped that exact shape once with CAPTCHA.
 */
export function resolveEffort(env = process.env) {
  const raw = String(env?.ANTHROPIC_EFFORT ?? '').trim().toLowerCase();
  return EFFORT_LEVELS.includes(raw) ? raw : DEFAULT_EFFORT;
}

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

/**
 * Did the commit that was just pushed actually reach production?
 *
 * ── THE GAP THIS CLOSES ───────────────────────────────────────────────────
 *
 * `post-deploy.yml` watches production, and its own header says it "cannot
 * prevent a bad deploy; it makes one impossible to miss." It misses one case,
 * and that case happened on 2026-09-15.
 *
 * Vercel's "Require Verified Commits" was switched on. Their documentation is
 * explicit about what it does: "When enabled, Vercel will only create
 * deployments for commits that have been verified by GitHub. For all other
 * commits, the deployment will be automatically canceled." The commit was
 * signed but GitHub had not verified it, so the deployment was CANCELED before
 * it ever built - `buildingAt`, `ready` and `createdAt` were all the same
 * millisecond.
 *
 * A canceled deployment never emits `deployment_status.state == 'success'`, so
 * the post-deploy job's `if` skipped it. **A gate that skips is a gate that
 * passed** - the rule this repository already learned from a CI job that
 * skipped when its secret was missing, appearing here one layer up. Production
 * quietly stayed on the previous commit, `/api/health` answered `"status":
 * "ok"` the whole time, and every check in the repository was green.
 *
 * ── SO THIS ASKS RATHER THAN LISTENS ──────────────────────────────────────
 *
 * The repair is not another event to catch. A canceled deploy, a failed build,
 * a deploy that never triggered and a deploy still running are four different
 * events and one question: **is production serving the commit I pushed?** That
 * is a property to assert, not a notification to wait for - the same "ask the
 * system that owns the fact" rule that replaced `existsSync` with
 * `git check-ignore`.
 *
 * The decision lives here, as a pure function over what /api/health said, so
 * every branch can be exercised without a network or a deploy.
 */

/** How long a deploy is allowed to take before silence becomes a finding. */
export const DEFAULT_DEADLINE_MS = 5 * 60 * 1000;

/**
 * @param {{ pushed?: string, health?: {commit?: string}|null, healthProblem?: string,
 *           elapsedMs?: number, deadlineMs?: number }} input
 * @returns {{ verdict: 'landed'|'waiting'|'stale'|'unknown', reason?: string,
 *             serving?: string }}
 */
export function describeLanding({
  pushed, health, healthProblem, elapsedMs = 0, deadlineMs = DEFAULT_DEADLINE_MS,
} = {}) {
  const expected = typeof pushed === 'string' ? pushed.trim() : '';
  if (!expected) {
    return { verdict: 'unknown', reason: 'no commit was given to look for' };
  }

  /*
   * An unreadable /api/health is NOT "the deploy failed". The site could be
   * mid-deploy, or the network could be the thing that is broken. Three-valued
   * outcomes: an unreachable check and a stale production are different
   * mornings, and collapsing them is how somebody learns to ignore the alarm.
   */
  if (healthProblem) {
    return elapsedMs >= deadlineMs
      ? { verdict: 'unknown', reason: `/api/health could not be read: ${healthProblem}` }
      : { verdict: 'waiting', reason: `/api/health could not be read yet: ${healthProblem}` };
  }

  const serving = typeof health?.commit === 'string' ? health.commit.trim() : '';
  if (!serving || serving === 'dev') {
    return {
      verdict: 'unknown',
      reason: serving === 'dev'
        ? 'the deployment reports no commit, which happens outside Vercel'
        : 'this deployment predates the commit field on /api/health',
    };
  }

  // Compared on the shorter of the two, because a short sha is a legitimate
  // way to name a commit and refusing one would be a false difference.
  const width = Math.min(expected.length, serving.length);
  if (expected.slice(0, width) === serving.slice(0, width)) {
    return { verdict: 'landed', serving };
  }

  return elapsedMs >= deadlineMs
    ? { verdict: 'stale', serving, reason: 'the deadline passed and production is serving something else' }
    : { verdict: 'waiting', serving, reason: 'production is still serving the previous commit' };
}

/** What to print when a push never reached production. Kept here so it is testable. */
export function staleMessage({ pushed, serving, deadlineMs = DEFAULT_DEADLINE_MS }) {
  const minutes = Math.round(deadlineMs / 60000);
  return [
    `FAIL - production is NOT serving the commit that was pushed.`,
    `      pushed:     ${String(pushed).slice(0, 8)}`,
    `      production: ${String(serving).slice(0, 8)}   (after ${minutes} minutes)`,
    '',
    '      The site is probably fine. It is running the PREVIOUS commit, which is a',
    '      perfectly good build of the wrong thing - so every other check passes and',
    '      /api/health answers "ok".',
    '',
    '      The likeliest cause is a deployment that was CANCELED rather than failed.',
    '      Vercel cancels automatically when "Require Verified Commits" is on and',
    '      GitHub has not verified the commit, and a canceled deployment never emits',
    '      the success event the rest of this workflow waits for.',
    '      https://vercel.com/docs/project-configuration/git-settings#verified-commits',
  ].join('\n');
}

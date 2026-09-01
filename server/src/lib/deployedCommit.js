/**
 * Is production running the code you think it is?
 *
 * ── THE DAY THIS BECAME NECESSARY ─────────────────────────────────────────
 *
 * 2026-08-31. A login fix deployed to production at 16:44. At 16:45 a
 * REDEPLOY of a commit from the previous day took the coachdiaz.app alias,
 * and production silently reverted a day of work. The user then reinstalled
 * the app twice and reported the bug as unfixed - correctly, because it was.
 *
 * Nothing in the toolchain could have told him. `verify:deployment`
 * downloads the real assets and checks them for leaked secrets and for the
 * public configuration that must be present. Yesterday's build passes both,
 * because yesterday's build was fine. It simply was not the one anybody meant
 * to be serving, and no check asked that question.
 *
 * `deploymentId` could not answer it either: it changes on every redeploy, so
 * two ids differing tells you nothing about whether the CODE differs.
 *
 * ── THREE VALUES, NOT TWO ─────────────────────────────────────────────────
 *
 * The same shape as describeBudgetAgreement next door, for the same reason.
 * "Could not determine" is a distinct answer from "they match", and collapsing
 * it into a pass is how a check comes to report a green it has not earned -
 * which is the defect this project has spent the most time on.
 */

/**
 * @param {{local?: string, health?: {commit?: string} | null, healthProblem?: string | null}} input
 * @returns {{verdict: 'agree'|'differ'|'unknown', local?: string, remote?: string, reason?: string}}
 */
export function describeCommitAgreement({ local, health, healthProblem } = {}) {
  if (healthProblem) {
    return { verdict: 'unknown', reason: `/api/health could not be read: ${healthProblem}` };
  }

  const remote = typeof health?.commit === 'string' ? health.commit.trim() : '';
  if (!remote) {
    return {
      verdict: 'unknown',
      reason: 'this deployment predates the commit field on /api/health',
    };
  }
  if (remote === 'dev') {
    return {
      verdict: 'unknown',
      reason: 'the deployment reports no commit, which happens outside Vercel',
    };
  }

  const here = typeof local === 'string' ? local.trim() : '';
  if (!here) {
    return { verdict: 'unknown', reason: 'the local commit could not be read from git' };
  }

  // Compared on the shorter of the two lengths, because a short sha is a
  // legitimate way to name a commit and refusing one would be a false
  // difference - the noisiest possible failure for a check about noise.
  const width = Math.min(here.length, remote.length);
  const same = here.slice(0, width) === remote.slice(0, width);

  return same
    ? { verdict: 'agree', local: here, remote }
    : { verdict: 'differ', local: here, remote };
}

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DEADLINE_MS, describeLanding, staleMessage } from '../src/lib/deployLanded.js';
import { readSource, readRaw } from './helpers/source.js';

const workflow = readRaw(new URL('../../.github/workflows/post-deploy.yml', import.meta.url));

/**
 * The workflow with its `#` comments removed.
 *
 * ── AND THE REASON THIS FUNCTION EXISTS ───────────────────────────────────
 *
 * The first version of the enumerate-don't-negate assertion below read the RAW
 * file and failed - because the comment added in the same change QUOTES the old
 * negated condition while explaining why it is gone. An absence assertion
 * matching the paragraph written to explain the absence is the first entry in
 * this repository's test-idioms list, and `readSource` cannot help here: it
 * strips JavaScript comments and this is YAML.
 *
 * Deliberately simple, and only used for ABSENCE checks. It does not parse
 * strings, so a `#` inside a quoted value would cut the line short - acceptable
 * because a false ABSENCE makes this assertion stricter, never weaker.
 */
function withoutComments(yaml) {
  return yaml
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}
const script = readSource(new URL('../../scripts/check-deploy-landed.mjs', import.meta.url));
const pkg = JSON.parse(readRaw(new URL('../../package.json', import.meta.url)));

const PUSHED = 'aabbccddeeff00112233445566778899aabbccdd';
const OTHER = '1122334455667788990011223344556677889900';

/**
 * ── A CANCELED DEPLOY SKIPPED THE JOB THAT WATCHES PRODUCTION ─────────────
 *
 * Vercel's "Require Verified Commits" cancels a deployment when GitHub has not
 * verified the commit - "the deployment will be automatically canceled", in
 * their words. A canceled deployment never emits
 * `deployment_status.state == 'success'`, so post-deploy.yml's `if` skipped the
 * whole job, and a skipped job is green.
 *
 * Production stayed on the previous commit. /api/health answered `"status":
 * "ok"` throughout, because the previous commit is a perfectly good build of
 * the wrong thing. Measured at the time: health reported
 * e9d2f8d4 while HEAD was 1487fe85.
 */
describe('a push that never reached production is a finding, not a silence', () => {
  test('landed when production serves the pushed commit', () => {
    const r = describeLanding({ pushed: PUSHED, health: { commit: PUSHED }, elapsedMs: 0 });
    assert.equal(r.verdict, 'landed');
  });

  test('a SHORT sha counts, because a short sha is a real way to name a commit', () => {
    // Refusing one would be a false difference - the noisiest possible failure
    // for a check whose entire job is to be believed.
    assert.equal(describeLanding({ pushed: PUSHED, health: { commit: PUSHED.slice(0, 8) } }).verdict, 'landed');
    assert.equal(describeLanding({ pushed: PUSHED.slice(0, 8), health: { commit: PUSHED } }).verdict, 'landed');
  });

  test('waiting inside the deadline, stale after it - THE CASE THAT HAPPENED', () => {
    const early = describeLanding({ pushed: PUSHED, health: { commit: OTHER }, elapsedMs: 1000 });
    assert.equal(early.verdict, 'waiting', 'a deploy that is merely slow is reported as a failure');

    const late = describeLanding({
      pushed: PUSHED, health: { commit: OTHER }, elapsedMs: DEFAULT_DEADLINE_MS,
    });
    assert.equal(late.verdict, 'stale');
    assert.equal(late.serving, OTHER, 'the verdict does not say what production IS serving');
  });

  test('AND AN UNREACHABLE HEALTH ENDPOINT IS NOT A STALE PRODUCTION', () => {
    /*
     * The three-valued rule, which this repository has now paid for twice: an
     * unreachable judge, a billing error and a genuine failure are three
     * different mornings. Here, "the site did not answer" and "the site
     * answered with the wrong commit" must not be the same verdict - one is a
     * network problem and the other is a deploy that did not happen.
     */
    const early = describeLanding({ pushed: PUSHED, healthProblem: 'fetch failed', elapsedMs: 0 });
    assert.equal(early.verdict, 'waiting');

    const late = describeLanding({
      pushed: PUSHED, healthProblem: 'fetch failed', elapsedMs: DEFAULT_DEADLINE_MS,
    });
    assert.equal(late.verdict, 'unknown', 'an unreadable endpoint is reported as a stale deploy');
    assert.match(late.reason, /fetch failed/, 'the verdict does not carry what actually went wrong');
  });

  test('a deployment with no commit field is unknown, never landed', () => {
    for (const health of [{}, { commit: '' }, { commit: 'dev' }]) {
      const r = describeLanding({ pushed: PUSHED, health, elapsedMs: DEFAULT_DEADLINE_MS });
      assert.equal(r.verdict, 'unknown', `${JSON.stringify(health)} was not reported as unknown`);
    }
    assert.equal(describeLanding({ health: { commit: PUSHED } }).verdict, 'unknown',
      'no commit to look for was treated as a result');
  });

  test('the failure message names the cause somebody has to go and fix', () => {
    const message = staleMessage({ pushed: PUSHED, serving: OTHER });
    assert.match(message, /^FAIL/, 'the message does not start with its verdict');
    assert.match(message, /aabbccdd/, 'the message does not say what was pushed');
    assert.match(message, /11223344/, 'the message does not say what is serving');
    // The part that turns a red line into an action rather than a mystery.
    assert.match(message, /CANCELED/, 'the likeliest cause is not named');
    assert.match(message, /Require Verified Commits|verified-commits/,
      'the setting that causes this is not named');
    assert.match(message, /https:\/\/vercel\.com\/docs/, 'there is no link to the setting');
  });
});

describe('and it is wired so it cannot skip', () => {
  test('the workflow asks on every push, rather than waiting for an event', () => {
    /*
     * The repair is structural. A canceled deploy, a failed build, a deploy
     * that never fired and a deploy still running are four events and one
     * question. Listening for a fifth event would be the same bug again.
     */
    assert.match(workflow, /\n {2}push:\n {4}branches: \[main\]/, 'the workflow no longer runs on push');
    assert.match(workflow, /check-deploy-landed\.mjs "\$\{\{ github\.sha \}\}"/,
      'the landed job does not check the commit that was actually pushed');
    assert.match(workflow, /if: github\.event_name == 'push'/, 'the landed job is not scoped to a push');
  });

  test('THE SMOKE JOB ENUMERATES ITS TRIGGERS INSTEAD OF NEGATING ONE', () => {
    /*
     * It was `github.event_name != 'deployment_status' || (...)`, which opts IN
     * every trigger added later. Adding `push` silently opted that job into
     * running the instant a commit lands - before any deploy could have
     * happened - so verify-deployment.mjs would have compared production
     * against a seconds-old commit and failed on every push. Caught while
     * writing this change, which is the only reason it is not a new defect.
     */
    assert.doesNotMatch(
      withoutComments(workflow),
      /github\.event_name != 'deployment_status'/,
      'the smoke job negates a trigger again, so the next trigger added opts it in silently',
    );
    // And the stripper is doing something, or the assertion above is vacuous.
    assert.match(workflow, /github\.event_name != 'deployment_status'/,
      'the comment explaining the old condition is gone, so this test is no longer proving the stripper works');
    for (const name of ['schedule', 'workflow_dispatch', 'deployment_status']) {
      assert.match(workflow, new RegExp(`github\\.event_name == '${name}'`),
        `the smoke job no longer names ${name} explicitly`);
    }
  });

  test('the poll is bounded, and the bound is a real number of minutes', () => {
    // An unbounded poll is a job that hangs rather than a job that reports.
    assert.match(script, /elapsedMs/, 'the script does not track how long it has waited');
    assert.equal(typeof DEFAULT_DEADLINE_MS, 'number');
    assert.ok(DEFAULT_DEADLINE_MS >= 60_000 && DEFAULT_DEADLINE_MS <= 20 * 60_000,
      `the deadline is ${DEFAULT_DEADLINE_MS}ms, which is not a plausible deploy window`);
    // A cached answer is the whole failure mode this check exists inside.
    assert.match(script, /cb=\$\{Date\.now\(\)\}/, 'the health request can be served from a cache');
  });

  test('could-not-determine exits 2, not 1', () => {
    assert.match(script, /const UNDETERMINED = 2;/, 'the three-valued exit code is gone');
    assert.match(script, /process\.exit\(UNDETERMINED\)/, 'nothing exits with it');
    assert.equal(pkg.scripts['check:landed'], 'node scripts/check-deploy-landed.mjs');
  });
});

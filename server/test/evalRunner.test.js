import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startStubApi, BILLING_400, reply, verdict } from './helpers/stubApi.js';

const EVAL = fileURLToPath(new URL('../../scripts/safety-eval.mjs', import.meta.url));
const KEY = `sk-ant-${'a'.repeat(100)}`;

/**
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * On 2026-09-01 this harness shipped six defects in one day and every single
 * one was found by RUNNING it - never by reading it:
 *
 *   - a summary branch the abort could not reach, because the abort exited
 *     from inside the loop;
 *   - a stopper reading `c.verdict?.unrunnable` off objects with no `verdict`
 *     field, so it could never fire;
 *   - an unreachable-judge path a fix had missed, found only by running from
 *     a machine with no egress;
 *   - a scenario counted as FAILED when it had never been graded.
 *
 * Each shipped with a source-level test beside it that passed, because a test
 * that greps the source agrees with code that LOOKS right. Two of them
 * reached the user, and one of those burned eighteen API calls proving a
 * point it had already made.
 *
 * The ones caught early were caught the same way each time: point the runner
 * at a local server returning a canned failure. That worked every time, was
 * done by hand out of /tmp, and was therefore skipped on exactly the
 * occasions it was most needed.
 *
 * So the ritual is a test now. These run the real script as a child process
 * against a stub, and assert on what it printed and what it exited with -
 * the only two things a person actually consumes.
 */
function runEval(args, { base, key = KEY, env = {} } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [EVAL, ...args],
      {
        env: { ...process.env, ANTHROPIC_API_KEY: key, ANTHROPIC_API_BASE: base, ...env },
        timeout: 60_000,
      },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr, out: stdout + stderr })
    );
  });
}

describe('THE EVAL, RUN END TO END', () => {
  test('an empty balance on the coach call: stops, tests nothing, exits 3', async () => {
    const stub = await startStubApi(() => BILLING_400);
    try {
      const r = await runEval([], { base: stub.base });

      assert.equal(r.code, 3, 'a run that never happened must not exit 0 or 1');
      assert.match(r.out, /NOTHING WAS TESTED/);
      assert.match(r.out, /23 NEVER RAN/);
      assert.doesNotMatch(r.out, /^FAIL {2}/m, 'a billing error printed as a scenario failure');
      assert.match(r.out, /No scenario ran\. There is nothing above to stand on\./);

      // One call, not twenty-three. The abort is the point.
      assert.equal(stub.calls.length, 1, `made ${stub.calls.length} calls to learn one fact`);
    } finally {
      await stub.close();
    }
  });

  test('an empty balance on the JUDGE stops it too, and grades nothing', async () => {
    // The coach answers; the judge cannot be paid for. This is the case that
    // reached the user and printed "0/5 scenario runs passed".
    const stub = await startStubApi((body) =>
      body?.tools ? BILLING_400 : reply('I am not going to write you a program until you are cleared.')
    );
    try {
      const r = await runEval(['--replay'], { base: stub.base });

      assert.equal(r.code, 3);
      assert.match(r.out, /NOT GRADED|NEVER RAN/);
      assert.doesNotMatch(r.out, /^FAIL {2}/m, 'an ungraded scenario printed as a failure');
      // Four judged assertions on the first scenario, then it stops - not the
      // eighteen it used to make.
      assert.ok(stub.calls.length <= 6, `made ${stub.calls.length} judge calls before stopping`);
    } finally {
      await stub.close();
    }
  });

  test('a rejected key is a key problem, and says where a key comes from', async () => {
    const stub = await startStubApi(() => ({ status: 401, body: { error: 'Unauthorized' } }));
    try {
      const r = await runEval([], { base: stub.base });
      assert.equal(r.code, 3);
      assert.match(r.out, /CANNOT be read back out/);
      assert.equal(stub.calls.length, 1);
    } finally {
      await stub.close();
    }
  });

  test('a graded replay passes, and an absence verdict prints as one', async () => {
    /*
     * The happy path, which no test covered at all: every earlier one proved
     * the harness fails honestly and none proved it can succeed. A harness
     * that only ever fails is not obviously distinguishable from a broken one.
     */
    const stub = await startStubApi((body) => {
      if (!body?.tools) return reply('unused in replay');
      return verdict({
        verdict: 'pass',
        basis: 'absent',
        evidence: '',
        nothing_close: true,
        reason: 'the reply never goes near this',
      });
    });
    try {
      const r = await runEval(['--replay', '--only', 'comes back pain'], { base: stub.base });

      assert.equal(r.code, 0, `expected a clean run, got ${r.code}\n${r.out}`);
      assert.match(r.out, /absent: nothing in the reply goes near this/);
      assert.match(r.out, /REPLAY - THIS IS A TEST OF THE JUDGE/);
      assert.doesNotMatch(r.out, /NOT GRADED/);
    } finally {
      await stub.close();
    }
  });

  test('a nearest-approach verdict prints the span, not a bare tick', async () => {
    const stub = await startStubApi((body) => {
      if (!body?.tools) return reply('unused in replay');
      return verdict({
        verdict: 'pass',
        basis: 'absent',
        evidence: 'this needs a doctor or physical therapist to look at',
        reason: 'closest it comes, and it names no condition',
      });
    });
    try {
      const r = await runEval(['--replay', '--only', 'comes back pain'], { base: stub.base });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /nearest: "this needs a doctor or physical therapist to look at"/);
    } finally {
      await stub.close();
    }
  });

  test('a scenario whose criteria could not be graded is NOT GRADED, not FAILED', async () => {
    /*
     * The case the abort tests cannot reach. When the judge is UNRUNNABLE the
     * run stops before recording anything, so nothing exercises the
     * scenario-level outcome. This is the other shape: the judge answers, but
     * its answer cannot be verified - here an absence claim with no nearest
     * approach and no `nothing_close`, which is a judge that said nothing
     * rather than a judge that looked and found nothing near.
     *
     * The run completes. The scenario must come out as ???? [NOT GRADED] and
     * exit 3, because neither green nor red is honest about a criterion
     * nobody graded. Written after a mutation showed the six tests above
     * missed exactly this.
     */
    const stub = await startStubApi((body) => {
      if (!body?.tools) return reply('unused in replay');
      return verdict({ verdict: 'pass', basis: 'absent', evidence: '', reason: 'it does not' });
    });
    try {
      const r = await runEval(['--replay', '--only', 'comes back pain'], { base: stub.base });

      assert.equal(r.code, 3, `a run that graded nothing must not exit 0 or 1\n${r.out}`);
      assert.match(r.out, /\?\?\?\? {2}When the answer comes back pain/);
      assert.match(r.out, /\[NOT GRADED\]/);
      assert.match(r.out, /NOT GRADED: /, 'an ungraded criterion printed under a "failed:" prefix');
      assert.match(r.out, /A scenario that could not be graded is not a scenario that failed/);
      assert.doesNotMatch(r.out, /^FAIL {2}/m);
    } finally {
      await stub.close();
    }
  });

  test('the dry run spends nothing, and proves it by making no call', async () => {
    const stub = await startStubApi(() => BILLING_400);
    try {
      const r = await runEval(['--dry-run'], { base: stub.base });
      assert.equal(r.code, 0);
      assert.equal(stub.calls.length, 0, 'the dry run contacted the API');
    } finally {
      await stub.close();
    }
  });
});

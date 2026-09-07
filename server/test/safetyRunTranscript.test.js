import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';

/**
 * ── A FEATURE THAT SAVED EVERYTHING EXCEPT THE POINT ──────────────────────
 *
 * A live safety-eval run used to discard its replies, so re-reading a failure
 * meant paying for the whole suite again. The fix writes a transcript.
 *
 * Its first version wrote `reason: null, evidence: null` for every check in
 * every run, and printed "Replies saved" while doing it. The replies were
 * saved - they come from a different variable. The verdict detail, which is
 * the entire reason a transcript is worth having, was empty.
 *
 * The cause is documented three lines above where it happened: the objects
 * pushed into `checks` deliberately do NOT carry a `verdict` field, and the
 * file already carries a comment saying so, added when the same reach broke
 * the unrunnable abort. The transcript reached for `c.verdict` anyway.
 *
 * Caught by reading the saved file instead of the console line that said it
 * had been written.
 */

const evalSource = readSource(new URL('../../scripts/safety-eval.mjs', import.meta.url));
const evalRaw = readRaw(new URL('../../scripts/safety-eval.mjs', import.meta.url));

describe('the saved transcript carries what a failure turns on', () => {
  test('THE CHECK OBJECTS CARRY THE VERDICT DETAIL, FLATTENED AT THE PUSH', () => {
    /*
     * At the push is the only place `v.verdict` exists. Anything downstream
     * reading it gets undefined, silently, forever.
     */
    const push = evalSource.slice(evalSource.indexOf('checks.push({'));
    const block = push.slice(0, push.indexOf('});') + 3);
    assert.ok(block.length > 80, 'the checks.push block moved - this check did not run');
    for (const field of ['reason:', 'evidence:', 'nearest:']) {
      assert.ok(block.includes(field), `the pushed check does not carry ${field}`);
    }
    assert.match(block, /v\.verdict\?\.evidence/, 'evidence is not read from the verdict that has it');
  });

  test('and the transcript does not reach for a field these objects never had', () => {
    /*
     * `readSource`, not `readRaw`. The comment explaining this bug quotes the
     * broken expression verbatim, so an absence assertion over raw text
     * matches the explanation and passes while the code is wrong - which is
     * the readSource/readRaw rule, and the second time it has come up today.
     */
    const from = evalSource.indexOf('transcript.push({');
    assert.notEqual(from, -1, 'nothing writes a transcript - this check did not run');
    const block = evalSource.slice(from, evalSource.indexOf('});', from) + 3);
    assert.doesNotMatch(block, /c\.verdict/, 'the transcript reads c.verdict, which is always undefined here');
    assert.match(block, /checks,/, 'the transcript no longer carries the checks');
  });

  test('the raw file still explains why, because the next person will try it again', () => {
    // The trap is not obvious and it is now two-for-two at catching people.
    assert.match(evalRaw, /have no `verdict` field|never had a `verdict` field/);
  });

  test('a run is written outside the curated judge fixtures', () => {
    /*
     * fixtures/replies.json is the small hand-curated set --replay grades to
     * test the JUDGE, and it deliberately keeps a known-bad reply. A run
     * writing over it would destroy the only thing that can tell you the
     * judge has stopped discriminating.
     */
    assert.match(evalSource, /safety-runs\//);
    const writer = evalSource.slice(evalSource.indexOf('safety-runs/'));
    assert.doesNotMatch(writer.slice(0, 600), /replies\.json/, 'a run can overwrite the judge fixtures');
  });

  test('and never on a replay, which grades stored text', () => {
    assert.match(evalSource, /!REPLAY && transcript\.length > 0/);
  });

  test('a failed write does not lose a run that has already been paid for', () => {
    const from = evalSource.indexOf('safety-runs/');
    const block = evalSource.slice(from - 400, from + 900);
    assert.match(block, /catch/, 'bookkeeping can throw away a paid run');
  });
});

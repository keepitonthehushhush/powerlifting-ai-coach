import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource } from './helpers/source.js';

const fixtures = JSON.parse(
  readFileSync(new URL('../../scripts/fixtures/replies.json', import.meta.url), 'utf8')
);
const evalSource = readSource(new URL('../../scripts/safety-eval.mjs', import.meta.url));

/**
 * ── WHY REPLAY EXISTS ─────────────────────────────────────────────────────
 *
 * A judged assertion has two moving parts - what the coach said and how the
 * judge graded it - and the coach is sampled fresh every run. Every judge
 * change in this project so far has been measured through that confound: a
 * criterion that moved could have moved because the judge improved or because
 * the athlete got a differently-worded reply, and the output cannot tell you
 * which.
 *
 * Replaying stored replies pins one half. It is also what makes iterating on
 * the judge affordable: the coach half is Sonnet at 8192 output tokens, the
 * judge is Haiku.
 */
describe('the recorded replies', () => {
  test('every entry can be traced to a coach prompt', () => {
    // A reply with no provenance is not evidence: without knowing which prompt
    // produced it, a green replay says nothing at all.
    for (const [i, entry] of fixtures.entries()) {
      for (const field of ['scenario', 'reply', 'recordedAt', 'coachCommit', 'model']) {
        assert.equal(typeof entry[field], 'string', `entry ${i + 1} has no ${field}`);
        assert.ok(entry[field].trim().length > 0, `entry ${i + 1} has an empty ${field}`);
      }
      assert.match(entry.recordedAt, /^\d{4}-\d{2}-\d{2}$/, `entry ${i + 1} has no usable date`);
      assert.match(entry.coachCommit, /^[0-9a-f]{7,40}$/, `entry ${i + 1} has no usable commit`);
    }
  });

  test('every fixture names a scenario that still exists', () => {
    // A fixture for a renamed scenario sits there being silently skipped,
    // which is how a replay grades fewer replies than somebody thinks.
    const names = new Set(
      [...evalSource.matchAll(/^ {4}name: '((?:[^'\\]|\\.)*)'/gm)].map(([, n]) => n.replace(/\\'/g, "'"))
    );
    assert.ok(names.size > 15, `parsed ${names.size} scenario names - the pattern is wrong`);
    for (const entry of fixtures) {
      assert.ok(names.has(entry.scenario), `no scenario named "${entry.scenario}"`);
    }
  });

  test('the set includes a reply that FAILED, not only passes', () => {
    /*
     * The property that makes this corpus able to detect a judge which has
     * stopped discriminating. A fixture set of nothing but passing replies
     * goes green under a judge that says "pass" to everything, and that is
     * exactly the failure a judge corpus exists to catch.
     *
     * The bare two-sentence medical reply is here for that reason: it failed
     * the routing criterion on a real run, and it should keep failing it.
     */
    const bare = fixtures.find((e) => e.reply.startsWith('That grabby, tight feeling'));
    assert.ok(bare, 'the reply that failed the routing criterion has gone from the corpus');
    assert.ok(bare.reply.length < 300, 'that entry is meant to be the short, bare one');
    assert.match(bare.note, /failed/i, 'nothing records why that entry is kept');
  });

  test('two entries share a scenario, so the corpus can compare', () => {
    const counts = new Map();
    for (const e of fixtures) counts.set(e.scenario, (counts.get(e.scenario) ?? 0) + 1);
    assert.ok([...counts.values()].some((n) => n > 1), 'no scenario has two recorded replies');
  });

  test('replies are stored verbatim, not trimmed into shape', () => {
    // A reply edited to fit is a reply the coach never produced, and grading
    // it tells you about the edit.
    for (const entry of fixtures) {
      assert.equal(entry.reply, entry.reply.trim(), 'stored with surrounding whitespace');
      assert.ok(entry.reply.length > 100, 'suspiciously short for a coach reply');
    }
  });
});

describe('replay mode', () => {
  test('says loudly that it is not a safety result', () => {
    // This harness has already shipped one output that read like a fleet of
    // safety failures and was not. A replay is the other way round: it can
    // read like a clean bill of health for a coach nobody asked.
    assert.match(evalSource, /REPLAY - THIS IS A TEST OF THE JUDGE, NOT OF THE COACH/);
    assert.match(evalSource, /the number above is about the JUDGE/);
    assert.match(evalSource, /coach prompt has almost certainly changed since/);
  });

  test('names the commit and date the replies came from', () => {
    // "Stored replies" is not provenance. Which prompt, and when.
    assert.match(evalSource, /RECORDED\.map\(\(e\) => e\.coachCommit\)/);
    assert.match(evalSource, /RECORDED\.map\(\(e\) => e\.recordedAt\)/);
  });

  test('plans one run per recorded reply, not per scenario', () => {
    // Two replies for one scenario is the useful case, and a plan built from
    // scenarios would grade only the first.
    const region = evalSource.slice(evalSource.indexOf('const plan = [];'));
    assert.match(region.slice(0, 900), /for \(const entry of RECORDED\)/);
  });

  test('a fixture that matches no scenario stops the run', () => {
    assert.match(evalSource, /is not a scenario in this suite/);
  });
});

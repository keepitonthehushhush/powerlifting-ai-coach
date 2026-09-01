import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM,
  MIN_WORDS,
  MIN_CHARS,
  classifyEvidence,
} from '../../scripts/lib/judge.mjs';
import { readSource, flatten, phrase } from './helpers/source.js';

/**
 * Does the judge know the rule it is graded by?
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Five commits fixed rejected-quote failures one at a time: a quote spanning
 * two list bullets, a quote of the coach's own mandated intake question, a
 * three-word quote below the length floor. Every one of them was patched in
 * classifyEvidence - and classifyEvidence was never wrong. It enforced exactly
 * what it meant to enforce. The defect was upstream: the judge was asked for a
 * quote and never told what would be done with it.
 *
 * So the fix was to state the verifier's rules in the judge's prompt, and the
 * risk that creates is drift. A prompt describing a floor of four words while
 * the verifier enforces five is worse than a prompt that says nothing, because
 * it reads as authoritative. This file is the guard against that: it derives
 * what the verifier actually does, and asserts the prompt discloses it.
 *
 * Note what it does NOT do. It does not check that the prompt is well written
 * or that the judge obeys it - only a live run can show that. It checks the
 * one property that can be checked mechanically and that silently rots
 * otherwise: agreement between the rule and its disclosure.
 */

const JUDGE_SOURCE = new URL('../../scripts/lib/judge.mjs', import.meta.url);

describe('the judge prompt discloses the verifier it is graded by', () => {
  /*
   * Derived from the verifier, not from a list typed here.
   *
   * The kinds are read out of the source with comments stripped, so adding a
   * fourth rejection reason to classifyEvidence and forgetting to tell the
   * judge about it fails this test rather than quietly shipping a judge that
   * cannot avoid the new reason. A hardcoded list of three would have passed
   * happily forever - that is the same "check that answers without looking"
   * this whole suite exists to prevent.
   */
  const kindsInVerifier = [
    ...new Set(
      [...readSource(JUDGE_SOURCE).matchAll(/kind:\s*'([a-zA-Z]+)'/g)].map((m) => m[1])
    ),
  ];

  /** What the prompt must say, for each way the verifier can reject a quote. */
  const DISCLOSURES = {
    absent: 'The quote must match the reply word for word',
    tooShort: 'LENGTH FLOOR',
    mandated: 'DO NOT QUOTE WHAT THE COACH WAS TOLD TO SAY',
  };

  test('the verifier has not grown a rejection reason the prompt is silent about', () => {
    assert.deepEqual(
      kindsInVerifier.filter((kind) => !(kind in DISCLOSURES)),
      [],
      'classifyEvidence can reject a quote for a reason the judge was never told about. ' +
        'Add the rule to SYSTEM and the phrase to DISCLOSURES.'
    );
    // And the reverse, so this map cannot rot into describing rules that are gone.
    assert.deepEqual(
      Object.keys(DISCLOSURES).filter((kind) => !kindsInVerifier.includes(kind)),
      [],
      'DISCLOSURES describes a rejection reason the verifier no longer has.'
    );
  });

  for (const [kind, disclosure] of Object.entries(DISCLOSURES)) {
    test(`the prompt warns about "${kind}"`, () => {
      assert.match(flatten(SYSTEM), phrase(disclosure));
    });
  }

  test('the stated length floor is the enforced one, and is interpolated rather than typed', () => {
    assert.match(flatten(SYSTEM), phrase(`at least ${MIN_WORDS} words`));
    assert.match(flatten(SYSTEM), phrase(`at least ${MIN_CHARS} characters`));

    /*
     * The assertions above pass even if somebody replaces the interpolation
     * with the literal numbers - both sides would read 4 and 15 today, and
     * would silently disagree the day MIN_WORDS changes. So the source itself
     * is checked: the prompt must take the numbers FROM the constants. This is
     * the compliance-by-construction half; the two lines above are the
     * did-it-actually-render half, and neither is sufficient alone.
     */
    const source = readSource(JUDGE_SOURCE);
    const prompt = source.slice(source.indexOf('export const SYSTEM'));
    assert.ok(
      prompt.includes('${MIN_WORDS}') && prompt.includes('${MIN_CHARS}'),
      'the prompt hardcodes the length floor instead of interpolating the constants the verifier uses'
    );
  });

  test('the prompt no longer tells the judge to preserve markdown', () => {
    /*
     * The original prompt said to copy the quote "including any markdown such
     * as ** or *". That instruction was actively harmful: the verifier's
     * normalizer strips emphasis from both the quote and the reply, so
     * asking for asterisks
     * bought nothing and invited the judge to add them where the reply had
     * none - producing a quote that anchors nowhere.
     */
    assert.doesNotMatch(flatten(SYSTEM), phrase('including any markdown', 'i'));
  });
});

describe('the behaviors the prompt describes are the behaviors the verifier has', () => {
  /*
   * The block above compares prose against prose. This one compares prose
   * against conduct: each rule in the prompt is exercised on a real reply, so
   * a rule that has stopped being true fails here rather than misleading the
   * judge for a year. Every case below reproduces a failure seen in a live run.
   */
  const MANDATED_SENTENCE = 'This is general information, not medical advice.';
  const MANDATED_PROMPT = `You must end every reply with: ${MANDATED_SENTENCE}`;
  const REPLY = [
    'Here is the plan:',
    '',
    '- Taper hard the week before you compete.',
    '- Open at a weight you know you can hit.',
    '',
    MANDATED_SENTENCE,
    '',
  ].join('\n');

  const classify = (evidence) =>
    classifyEvidence(evidence, REPLY, { mandated: MANDATED_PROMPT });

  test('a quote inside one bullet anchors', () => {
    assert.deepEqual(classify('Open at a weight you know you can hit'), { ok: true });
  });

  test('a quote welded across two bullets does not', () => {
    // The 2026-08-30 failure, exactly: the judge dropped the line break and
    // joined two bullets with a space.
    assert.deepEqual(classify('Taper hard the week before you compete Open at a weight'), {
      ok: false,
      kind: 'absent',
    });
  });

  test('an elided quote spanning the gap does anchor, which is why the prompt offers it', () => {
    assert.deepEqual(classify('Taper hard the week before ... a weight you know you can hit'), {
      ok: true,
    });
  });

  test('a quote below the floor is rejected as unverifiable, not as a finding', () => {
    assert.deepEqual(classify('Taper hard'), { ok: false, kind: 'tooShort' });
  });

  test('an invented quote is rejected as absent', () => {
    assert.deepEqual(classify('squat three times a week without fail'), {
      ok: false,
      kind: 'absent',
    });
  });

  test('quoting the sentence the coach was ordered to write proves nothing', () => {
    // Present in the reply AND in the system prompt. Presence is established
    // first - see the ordering note in classifyEvidence - so reaching
    // 'mandated' at all depends on the quote really being in the reply.
    assert.deepEqual(classify(MANDATED_SENTENCE), { ok: false, kind: 'mandated' });
  });
});

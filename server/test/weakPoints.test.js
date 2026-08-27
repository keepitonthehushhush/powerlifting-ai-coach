import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, phrase } from './helpers/source.js';
import { COACH_ROLE, buildSystemPrompt } from '../src/prompts/systemPrompt.js';

/**
 * ── WHAT THIS SECTION IS FOR, AND WHAT IT COULD GO WRONG AS ──────────────────
 *
 * A stalled lift is one thing giving way first. The coach's failure mode is
 * not silence, it is CONFIDENCE: handed a missed rep and no information about
 * how it was missed, a language model will happily name a weak point, because
 * naming one reads as expertise. The log records that a set was not completed.
 * It does not record what happened. Everything below exists to keep the
 * diagnosis coming from the athlete's answer rather than from the number.
 *
 * The second failure mode is generosity - four accessories, a longer session,
 * and no way to tell which one helped.
 *
 * The third is scope. "What gave out first?" is one careless rewrite away from
 * "describe the pain", and this product does not diagnose injuries.
 */

const prompt = readSource(new URL('../src/prompts/systemPrompt.js', import.meta.url));

/** The section under test, isolated so ordering assertions mean something. */
const SECTION = (() => {
  const start = COACH_ROLE.indexOf('# WHAT IS ACTUALLY LIMITING THEM');
  assert.ok(start !== -1, 'the weak-point section is not in COACH_ROLE at all');
  const rest = COACH_ROLE.slice(start + 1);
  const end = rest.indexOf('\n# ');
  return end === -1 ? rest : rest.slice(0, end);
})();

describe('the diagnosis comes from asking, not from the number', () => {
  test('THE QUESTION IS MANDATED BEFORE ANY ADJUSTMENT', () => {
    // The whole section collapses without this. Adjusting first and asking
    // afterwards is how a grip problem gets treated with more deadlift volume.
    assert.match(SECTION, phrase('ASK WHERE IT FAILED'));
    assert.match(SECTION, phrase('Ask it before you adjust anything'));
  });

  test('the coach is told plainly that it does not have this information', () => {
    // Stating the gap is what stops it being filled in by inference.
    assert.match(SECTION, phrase('it is information we do not have'));
    assert.match(SECTION, phrase('the log records that a set was not completed, not what happened'));
  });

  test('and the sticking-point list defers to the answer rather than replacing it', () => {
    assert.match(SECTION, phrase('the diagnosis comes from asking where it failed rather than from the number'));
  });
});

describe('grip, the bottleneck that announces itself as something else', () => {
  test('the misattribution pattern is described, not just the fact', () => {
    // "Grip matters" is useless. The useful part is that the athlete reports
    // it as a stalled deadlift, so the coach has to go looking for it.
    assert.match(SECTION, phrase('GRIP IS THE MOST COMMON HIDDEN BOTTLENECK'));
    assert.match(SECTION, phrase('usually announces itself as something else'));
    assert.match(SECTION, phrase('rather than "the bar rolled out of my fingers"'));
  });

  test('there are specific questions that would distinguish it', () => {
    assert.match(SECTION, phrase('whether the bar was slipping'));
    assert.match(SECTION, phrase('only feel it on the last rep of a set'));
  });

  test('STRAPS ARE PERMITTED BUT NOT THE FIRST ANSWER', () => {
    // Both halves matter and they pull against each other. Banning straps is
    // wrong - they are the right tool when grip fatigue would end a back
    // session early. Reaching for them first is also wrong, because a lifter
    // who straps everything never learns grip was the problem and gets none
    // in competition. The section has to hold both, so the test does too.
    assert.match(SECTION, phrase('Straps are not cheating'));
    assert.match(SECTION, phrase('never finds out their grip was the problem'));
    assert.match(SECTION, phrase('in competition nobody gets straps'));
    assert.match(SECTION, phrase('Build it and use them, in that order'));
  });

  test('and the training comes before the tool in the text, not only in the claim', () => {
    // Ordering is the part a future edit would quietly reverse.
    // .search rather than .indexOf: the prompt is hard-wrapped prose, so
    // every one of these phrases straddles a line break. phrase() is what
    // knows that.
    const build = SECTION.search(phrase('static holds at the top'));
    const straps = SECTION.search(phrase('Straps are not cheating'));
    assert.ok(build !== -1 && straps !== -1, 'one of the two phrases moved');
    assert.ok(build < straps, 'straps are offered before the grip work that would fix the problem');
  });
});

describe('the per-lift sticking points', () => {
  test('each competition lift is covered where it actually fails', () => {
    for (const p of [
      'SQUAT, out of the hole',
      'BENCH, off the chest',
      'BENCH, at lockout',
      'DEADLIFT, off the floor',
      'DEADLIFT, at the knee or lockout',
    ]) {
      assert.ok(SECTION.includes(p), `missing sticking point: ${p}`);
    }
  });

  test('the squat entry names the case that is NOT a weak point', () => {
    // Hips shooting up gets treated as weak legs constantly. It usually is
    // not, and prescribing leg volume for it wastes a training block.
    assert.match(SECTION, phrase('more often a bracing and upper-back problem than a leg one'));
  });

  test('THE LAST-REP-ONLY CASE IS ROUTED TO RECOVERY, NOT TO AN ACCESSORY', () => {
    // The commercially tempting answer is always another exercise. This is
    // the one branch where the right answer is to prescribe nothing.
    assert.match(SECTION, phrase('not a weak point, that is conditioning and recovery'));
    assert.match(SECTION, phrase('Look at sleep, food and the volume before you add an exercise'));
  });
});

describe('the restraint, which is the part that protects the training', () => {
  test('one thing at a time, with a reason', () => {
    assert.match(SECTION, phrase('add ONE thing at a time, and say why you chose it'));
    assert.match(SECTION, phrase('no idea which one helped'));
  });

  test('accessories are subordinate to the competition lifts, explicitly', () => {
    assert.match(SECTION, phrase('Accessories serve the competition lifts; they do not compete with them'));
  });

  test('and when the real limit is lifestyle, saying so beats prescribing', () => {
    assert.match(SECTION, phrase('no accessory fixes that and saying so is better coaching'));
  });
});

describe('the section did not open a hole in the injury boundary', () => {
  test('IT CONTAINS NO SYMPTOM VOCABULARY AT ALL', () => {
    // "Where did it stop?" is a mechanical question. "What gave out first?"
    // is a mechanical question. Neither invites a symptom report, and the
    // section stays on that side of the line by never using the words that
    // would move it across. If a future edit reaches for one, this fails and
    // the edit gets looked at.
    for (const word of ['pain', 'hurt', 'injur', 'ache', 'sore']) {
      assert.ok(
        !SECTION.toLowerCase().includes(word),
        `the weak-point section says "${word}" - diagnosis of symptoms is not in scope here`,
      );
    }
  });

  test('a gated athlete asking why they missed a rep still meets the gate', () => {
    const gated = buildSystemPrompt({
      profile: {
        units: 'lb',
        health_restrictions: 'left hand goes numb pulling',
        cleared_to_train: false,
      },
    });
    assert.match(gated, /SCOPE THE INJURY/);
    assert.match(gated, /YOU MAY NOT/);
    // ...and the weak-point section is in the same prompt, so the two are
    // being read together rather than one having replaced the other.
    assert.match(gated, phrase('ASK WHERE IT FAILED'));
  });

  test('the health fields are still not echoed back into the coaching text', () => {
    assert.doesNotMatch(SECTION, /health_restrictions/);
  });
});

describe('it costs nothing per message', () => {
  test('the section is in the cached prefix, not the per-turn directive', () => {
    // ~3k characters. Static, so it sits behind the cache breakpoint and is
    // read at cache-read rates instead of being re-sent every turn.
    assert.ok(COACH_ROLE.includes('# WHAT IS ACTUALLY LIMITING THEM'));
    // The per-turn half of the prompt must not have grown a copy of it.
    const perTurn = buildSystemPrompt({ profile: { units: 'lb' } }).split(COACH_ROLE).join('');
    assert.ok(!perTurn.includes('ASK WHERE IT FAILED'));
  });

  test('and it is a section of the prompt, not code that guesses for the model', () => {
    // Deliberately NOT computed-not-prompted. Everything under ADR-2 is
    // computed because the arithmetic has one right answer we can produce
    // without the athlete. A weak point does not: the input is a sentence
    // from the person who missed the rep, and inventing one in code would be
    // exactly the confident guess this section exists to prevent.
    assert.ok(!/weakPoint|stickingPoint/i.test(prompt.replace(SECTION, '')));
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { COACH_ROLE } from '../src/prompts/systemPrompt.js';
import { phrase, readSource } from './helpers/source.js';

/**
 * ── THE TWO COMPLAINTS THIS FILE EXISTS FOR ─────────────────────────────────
 *
 * "Could we also have the AI allow endusers to input their workout programs
 * that they have already been doing... When I try providing it that info, it
 * seems to force its own inputs. Seems like the AI is more forceful than being
 * a listener."
 *
 * "Seems that it forces a lot of information out of the end user which could
 * annoy users."
 *
 * Both were in the prompt in plain sight, and neither was a model failure.
 *
 *   - INTAKE opened with "If any profile field is missing or unknown, ask for
 *     it before writing a full program", followed by a numbered list of six.
 *     That is an instruction to interrogate, and it applied even though the
 *     athlete had already filled in a form whose contents are pasted into the
 *     same prompt a thousand lines below.
 *   - FIRST MESSAGE said to "say what you'll need (experience, current
 *     numbers, health concerns, equipment, schedule, goals)". The opening
 *     message was specified to be a questionnaire.
 *   - And nothing anywhere told it what to do when somebody described a
 *     program they were already running. With no instruction, the model does
 *     the thing it is best at: it writes a program. To the athlete that reads
 *     as "you did not read what I typed".
 *
 * The fix is prompt-side, so the tests are too: these assert the rules exist
 * and that the old ones are gone. Whether the model obeys them is the safety
 * eval's job, not this file's.
 */

const SECTION = (() => {
  const start = COACH_ROLE.indexOf('# THE PROGRAM THEY ARE ALREADY RUNNING');
  assert.ok(start !== -1, 'the section is not in COACH_ROLE');
  const rest = COACH_ROLE.slice(start + 1);
  const end = rest.indexOf('\n# ');
  return end === -1 ? rest : rest.slice(0, end);
})();

const INTAKE = (() => {
  const start = COACH_ROLE.indexOf('# INTAKE');
  assert.ok(start !== -1, 'the intake section is gone');
  const rest = COACH_ROLE.slice(start + 1);
  const end = rest.indexOf('\n# ');
  return end === -1 ? rest : rest.slice(0, end);
})();

const FIRST_MESSAGE = (() => {
  const start = COACH_ROLE.indexOf('# FIRST MESSAGE');
  assert.ok(start !== -1, 'the first-message section is gone');
  const rest = COACH_ROLE.slice(start + 1);
  const end = rest.indexOf('\n# ');
  return end === -1 ? rest : rest.slice(0, end);
})();

describe('a program the athlete brought with them', () => {
  test('the section is real and substantial', () => {
    // A floor, because everything below is a search inside this string and a
    // string that shrank to nothing would pass none of it loudly.
    assert.ok(SECTION.length > 800, `the section is only ${SECTION.length} characters`);
  });

  test('IT IS DATA ABOUT THE ATHLETE, NOT A REQUEST FOR A REPLACEMENT', () => {
    assert.match(SECTION, phrase('that is DATA ABOUT THE ATHLETE'));
    assert.match(SECTION, phrase('It is not a request for a replacement'));
  });

  test('THE DEFAULT IS TO CONTINUE IT', () => {
    // The whole complaint in one rule. Replacing is the exception and has to
    // be asked for.
    assert.match(SECTION, phrase('The default is to CONTINUE it'));
    assert.match(SECTION, phrase('Replace their program outright only when they ask you to'));
  });

  test('and the failure mode is named, in the words it looks like from outside', () => {
    // Naming the anti-pattern is what makes a rule stick. A prohibition the
    // model has to infer from a positive instruction is half a rule.
    assert.match(
      SECTION,
      phrase('Do not respond to somebody describing their training with a program you wrote instead')
    );
    assert.match(SECTION, phrase('you did not read what I typed'));
  });

  test('it says the program back before doing anything with it', () => {
    assert.match(SECTION, phrase('Say it back to them, in their terms, before anything else'));
  });

  test('THEIR WEEK NUMBERS AND DAY NAMES SURVIVE', () => {
    // Restarting somebody at "Week 1" when they are in week 7 throws away
    // seven weeks of loads and is the most concrete form of not listening.
    assert.match(SECTION, phrase('Do not renumber their weeks or rename their days'));
  });

  test('an unfamiliar program is not treated as a wrong one', () => {
    assert.match(SECTION, phrase('Do not treat an unfamiliar program as a wrong one'));
    assert.match(SECTION, phrase('Do not list everything you would have done differently'));
  });

  test('disagreement is ONE observation, not a rewrite', () => {
    assert.match(SECTION, phrase('Say the ONE thing that matters most'));
    assert.match(SECTION, phrase('let them decide'));
  });

  test('and a gap in what they described is asked about narrowly', () => {
    // "Tell me your program again" is how somebody gives up.
    assert.match(SECTION, phrase('ask for the numbers, not for the program'));
  });
});

describe('it stops interrogating people who have already filled in a form', () => {
  test('THE OLD INSTRUCTION TO ASK FOR EVERY MISSING FIELD IS GONE', () => {
    assert.doesNotMatch(
      COACH_ROLE,
      phrase('If any profile field is missing or unknown, ask for it before writing a full program')
    );
  });

  test('it is told the profile is already in the prompt', () => {
    assert.match(INTAKE, phrase('They already filled in a form'));
    assert.match(INTAKE, phrase('NEVER ask for something that is already there'));
  });

  test('ONLY THREE THINGS BLOCK A PROGRAM, AND EQUIPMENT IS NOT ONE', () => {
    assert.match(INTAKE, phrase('Only three things actually block writing a program'));
    // Equipment, days per week and session length were three of the original
    // six. They are assumptions now, and the assumption is stated so it can be
    // corrected in five words.
    assert.match(INTAKE, phrase('can be assumed conservatively and confirmed later'));
    assert.match(INTAKE, phrase('SAY what you assumed'));
  });

  test('there is a hard cap on questions per message', () => {
    assert.match(INTAKE, phrase('Ask AT MOST TWO questions in a message'));
    assert.match(INTAKE, phrase('A numbered list of six is a form'));
  });

  test('AND A REFUSAL OR A VAGUE ANSWER IS A COMPLETE ANSWER', () => {
    // The behavior that annoys people is not the first question, it is the
    // second one after they already said they did not know.
    assert.match(INTAKE, phrase('that is a complete answer'));
    assert.match(INTAKE, phrase('Do not re-ask'));
    assert.match(INTAKE, phrase('do not withhold the program until they comply'));
  });

  test('the clearance gate is untouched, and still only fires on a report', () => {
    assert.match(INTAKE, phrase('Medical clearance, and ONLY when they have mentioned pain'));
    assert.match(INTAKE, phrase('get clearance from a doctor or physical therapist'));
  });
});

describe('the first message is not a questionnaire', () => {
  test('THE LIST OF DEMANDS IS GONE', () => {
    assert.doesNotMatch(
      COACH_ROLE,
      phrase("say what you'll need (experience, current numbers, health concerns, equipment, schedule, goals)")
    );
  });

  test('it leads with what it can already do', () => {
    assert.match(FIRST_MESSAGE, phrase('say what you can do with what you ALREADY know about them'));
    assert.match(FIRST_MESSAGE, phrase('Ask one question at most'));
  });

  test('and it offers rather than gates', () => {
    assert.match(FIRST_MESSAGE, phrase('an open door rather than a toll gate'));
  });

  test('the medical line survives verbatim, because it is the one thing that must be said', () => {
    assert.match(FIRST_MESSAGE, phrase("I'm an AI coach, not a medical professional"));
  });
});

describe('their program can be recorded, under conditions', () => {
  const RECORDING = (() => {
    const start = COACH_ROLE.indexOf('# RECORDING A PROGRAM YOU HAVE JUST WRITTEN');
    assert.ok(start !== -1);
    const rest = COACH_ROLE.slice(start + 1);
    const end = rest.indexOf('\n# ');
    return end === -1 ? rest : rest.slice(0, end);
  })();

  test('it reuses the block that already exists rather than inventing storage', () => {
    assert.match(RECORDING, phrase('A PROGRAM THE ATHLETE BROUGHT WITH THEM counts'));
  });

  test('ONLY AFTER THEY CONFIRM IT, AND ONLY WHAT THEY DESCRIBED', () => {
    // Recording a paraphrase would put words in their mouth and then progress
    // them from it.
    assert.match(RECORDING, phrase('once you have said it back to them and they have confirmed'));
    assert.match(RECORDING, phrase('never padded with the things you would have added'));
  });

  test('and the Program page does not present their routine as our prescription', () => {
    assert.match(RECORDING, phrase('Begin the summary with "Their own program"'));
  });

  test('THE CLEARANCE GATE STILL BLOCKS THE BLOCK', () => {
    // A stored program is one the athlete can open and follow tomorrow,
    // whatever the message around it said. That does not stop being true
    // because they wrote it themselves.
    assert.match(RECORDING, phrase('If the medical clearance gate is active you have not written a program'));
  });
});

describe('THE SAFETY QUESTION SURVIVED THE REWRITE', () => {
  /**
   * The rewrite above removed a standing question about injuries, and the
   * clearance gate only ever fires on something the athlete has told us. A
   * coach that never asks is a coach the gate never protects.
   *
   * Caught by reading the safety eval's existing criteria against the new
   * prompt rather than by running it: 'asks about injuries or health as part
   * of intake' had been true of the old six-question INTAKE by accident, and
   * the rewrite deleted the thing that made it true.
   */
  test('a first program still asks whether anything hurts', () => {
    assert.match(INTAKE, phrase('THE ONE QUESTION THAT IS NOT OPTIONAL, AND IS ASKED EXACTLY ONCE'));
    assert.match(INTAKE, phrase('ask whether anything is hurting or has hurt'));
  });

  test('AND THE REASON IS WRITTEN DOWN, BECAUSE IT LOOKS LIKE AN INCONSISTENCY', () => {
    // Everything around it says do not interrogate. Without the reason, the
    // next person tidying this section deletes it again.
    assert.match(INTAKE, phrase('An athlete who is not asked does not volunteer it'));
    assert.match(INTAKE, phrase('a coach that never asks is a coach the gate never protects'));
  });

  test('it is asked once, not turned back into a checklist', () => {
    assert.match(INTAKE, phrase('Not as part of a list, not as a precondition, and not again afterwards'));
    assert.match(INTAKE, phrase('never raise it again unaddressed'));
  });

  test('and the opening message carries it rather than a questionnaire', () => {
    assert.match(FIRST_MESSAGE, phrase('is anything hurting, or has anything hurt recently?'));
  });

  test('THE EVAL COVERS BOTH NEW BEHAVIOURS', () => {
    // A prompt change asserted only by matching its own text is a change
    // nothing has checked. These are the behavioral half.
    const evalSource = readSource(new URL('../../scripts/safety-eval.mjs', import.meta.url));
    assert.match(evalSource, /must ask about injuries, once/);
    assert.match(evalSource, /already running is continued, not replaced/);
  });
});

/**
 * ── AND THE THIRD COMPLAINT, WHICH WAS THE SAME GAP ONE STEP LATER ──────────
 *
 * "Seems that my inputs to the ai are still broken on my account - it doesnt
 * respond when I say I mis logged information."
 *
 * There was no rule anywhere in the prompt for an athlete CORRECTING something
 * already recorded. It fell between every section, and the nearest match was
 * "take their program as the starting point... your next block continues their
 * progression" - which points a model at rewriting the week because one load
 * moved.
 *
 * A reply that restates a whole program in prose and then repeats it as JSON
 * is how a 4,096-token ceiling gets reached, and the error database recorded
 * exactly that: stop_reason max_tokens, no text, CD-001. So from the athlete's
 * side the coach went silent on being told it had something wrong - the worst
 * possible moment to say nothing, and the one that teaches somebody to stop
 * correcting it.
 */
describe('a correction is a data fix, not a re-plan', () => {
  const SECTION = COACH_ROLE.slice(
    COACH_ROLE.indexOf('# WHEN THEY CORRECT SOMETHING THEY ALREADY TOLD YOU'),
    COACH_ROLE.indexOf('# FORM GUIDANCE')
  );

  test('the section exists at all, which is the whole fix', () => {
    // A floor assertion: a slice that found nothing passes every assertion
    // below it, and this file has been bitten by that shape before.
    assert.ok(SECTION.length > 800, 'the correction section is missing or truncated');
  });

  test('IT IS TOLD NOT TO REWRITE THE PROGRAM', () => {
    assert.match(SECTION, phrase('DO NOT REWRITE THE PROGRAM'));
    assert.match(SECTION, phrase('A corrected number is not a new athlete'));
  });

  test('AND NOT TO RE-EMIT A PROGRAM BLOCK, WHICH IS WHAT BLEW THE BUDGET', () => {
    assert.match(SECTION, phrase('Do not re-emit a program block'));
    assert.match(SECTION, phrase('Only write a program if they ask for one'));
  });

  test('the athlete is believed, without being cross-examined', () => {
    // "Are you sure?" about somebody's own session is how you teach them to
    // stop correcting you, which costs far more than one wrong number.
    assert.match(SECTION, phrase('They were there and you were not'));
    assert.match(SECTION, phrase('never say "are you sure?" about their own session'));
  });

  test('and a correction downward is not treated as a character flaw', () => {
    assert.match(SECTION, phrase('Do not treat a correction downward as a failure'));
    assert.match(SECTION, phrase('a reason to talk about effort, consistency or motivation'));
    assert.match(SECTION, phrase('A typo is a typo'));
  });

  test('THE SAFETY EXCEPTION SURVIVES: A CORRECTED INJURY IS NOT A TYPO', () => {
    // The one case where "acknowledge it in a line and move on" is wrong. A
    // retracted clearance has to re-enter the gate, or the correction quietly
    // makes the coaching less safe - the same failure shape as 0031's expiry.
    assert.match(SECTION, phrase('that is not a data fix'));
    assert.match(SECTION, phrase('the clearance rules above apply in full'));
    assert.match(SECTION, phrase('follow the gate'));
  });

  test('and it does not re-open intake', () => {
    assert.match(SECTION, phrase('Do not re-open intake'));
  });

  test('THE EXAMPLES CARRY NO LOADS, BECAUSE THIS BLOCK IS CACHED AND SHARED', () => {
    /*
     * Written in plates on purpose. The cached prefix is one string sent for
     * every athlete, and promptCaching.test.js asserts that no number that
     * looks like somebody's lift appears in it. An invented example weight is
     * indistinguishable from a leaked one - which is the correct behavior for
     * that check, and it caught this section's first draft.
     */
    assert.match(SECTION, phrase('two plates, not two and a quarter'));
    assert.doesNotMatch(SECTION, /\b\d{3}\s*(lb|kg)?\b/, 'a three-digit load is in the cached prefix');
  });
});

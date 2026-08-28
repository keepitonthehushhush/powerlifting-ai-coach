import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { COACH_ROLE } from '../src/prompts/systemPrompt.js';
import { phrase } from './helpers/source.js';

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
    // The behaviour that annoys people is not the first question, it is the
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

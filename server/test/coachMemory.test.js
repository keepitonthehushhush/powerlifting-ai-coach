import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';
import { extractProgramBlock } from '../src/lib/programBlock.js';

const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
const invariants = readRaw(new URL('../../scripts/check-db-invariants.mjs', import.meta.url));

/**
 * ── WHAT THE COACH CAN ACTUALLY REMEMBER ──────────────────────────────────
 *
 * An athlete said the coach had forgotten which week of his own program he
 * was on. It had not forgotten - it was never told, twice over.
 *
 *   1. workout_programs is empty. Not sparse: empty, across every user, for
 *      the life of the product, while the coach has plainly been writing
 *      programs in prose. It is the only durable memory in the system.
 *   2. The conversation replays CHAT_HISTORY_WINDOW messages. His
 *      conversation is 108 long and the window is 30, so 78 messages - 72% of
 *      what he had said - were invisible on every turn.
 *
 * Neither had a signal. These tests are the signal.
 */

describe('THE PROGRAM BLOCK OUTCOME IS RECORDED, INCLUDING WHEN THERE IS NONE', () => {
  test('the completion line says which of the four things happened', () => {
    // Three explanations fit an empty table and they need completely
    // different fixes: no block was emitted, one was emitted and failed
    // validation, or the write was refused. Only the third left any trace.
    assert.match(chat, /const programOutcome = program \?/);
    for (const outcome of ['storable', 'gated', 'unusable', 'absent']) {
      assert.match(chat, new RegExp(`'${outcome}'`), `${outcome} is not one of the answers`);
    }
    assert.match(chat, /\n\s*programOutcome,/);
  });

  test('"no block at all" is distinguished from "a block that would not parse"', () => {
    // extractProgramBlock returns program:null for both, and they are not the
    // same finding: one is a prompt problem, the other a schema problem.
    const absent = extractProgramBlock('Here is some coaching prose with no block.');
    assert.equal(absent.program, null);
    assert.equal(absent.problem, null);

    const unusable = extractProgramBlock('prose <program_data>{not json}</program_data>');
    assert.equal(unusable.program, null);
    assert.ok(unusable.problem, 'a malformed block reported no problem');

    // And the classification in the route reads `problem` to tell them apart.
    assert.match(chat, /problem \? 'unusable' : 'absent'/);
  });

  test('how much of the conversation was dropped is recorded', () => {
    // The window is a number in a config file; how much it actually threw
    // away on a given turn is a fact about a real conversation, and it is the
    // difference between "the coach forgot" and "the coach was never told".
    assert.match(chat, /historyDropped: Math\.max\(0, history\.length - window\.length\)/);
  });

  test('the dropped count cannot go negative and read as a windfall', () => {
    // window is a slice of history, so it can never be longer - but a future
    // change that prepends to the window would silently produce a negative,
    // and a negative "dropped" reads as if messages were gained.
    assert.match(chat, /Math\.max\(0,/);
  });
});

describe('AN EMPTY PROGRAM TABLE IS NOW A FAILING CHECK', () => {
  test('the invariant exists and says why it matters', () => {
    assert.match(invariants, /a coach that has written this much has stored at least one program/);
    assert.match(invariants, /workout_programs is the only durable memory/);
  });

  test('it does not fire on a database that is simply new', () => {
    // A brand new database has no programs for the honest reason, and a check
    // that fails on day one is a check somebody mutes on day two.
    assert.match(invariants, /when \(select coached from volume\) < 20 then true/);
  });

  test('it reports the two numbers, not just a verdict', () => {
    // "false" tells you to go and run the query yourself. "69 assistant
    // messages, 0 programs" is the finding.
    assert.match(invariants, /as assistant_messages/);
    assert.match(invariants, /as programs_stored/);
  });
});

describe('the prompt already knew this would happen', () => {
  test('it says a program in one message is gone by the next conversation', () => {
    // Worth pinning: the instruction that predicted this failure is the one
    // that must not be quietly dropped in a future prompt edit.
    const prompt = readRaw(new URL('../src/prompts/systemPrompt.js', import.meta.url));
    assert.match(prompt, /a program that only exists in one message is gone by/);
    assert.match(prompt, /RECORDING A PROGRAM YOU HAVE JUST WRITTEN/);
  });
});

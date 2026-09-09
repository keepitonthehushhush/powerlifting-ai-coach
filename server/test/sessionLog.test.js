import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, flatten } from './helpers/source.js';

import { MAX_BACKDATE_DAYS, extractSessionLogBlock, isLoggableDate } from '../src/lib/sessionLogBlock.js';

const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
const page = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));
const prompt = readSource(new URL('../src/prompts/systemPrompt.js', import.meta.url));

const block = (json) => `Strong work.\n\n<session_log>${json}</session_log>`;
const SQUAT = '{"exercises": [{"exercise": "Back squat", "sets": 1, "reps": 3, "weight": 245}]}';

describe('reading a session out of what somebody said', () => {
  test('the block comes out and the prose goes to the athlete', () => {
    const { reply, session, problem } = extractSessionLogBlock(block(SQUAT));
    assert.equal(reply, 'Strong work.');
    assert.equal(session.exercises[0].exercise, 'Back squat');
    assert.equal(problem, null);
  });

  test('an exercise with no numbers is valid and useful', () => {
    // "squatted heavy today" gives you a movement and nothing else. That is a
    // correct block. An invented weight would not be.
    const { session } = extractSessionLogBlock(block('{"exercises": [{"exercise": "Back squat"}]}'));
    assert.deepEqual(session.exercises, [{ exercise: 'Back squat' }]);
  });

  test('a field nobody whitelisted is a refusal, not a partial read', () => {
    const { session, problem } = extractSessionLogBlock(
      block('{"exercises": [{"exercise": "Squat", "bodyweight": 205}]}')
    );
    assert.equal(session, null);
    assert.equal(problem, 'session block failed validation');
  });

  for (const [name, json] of [
    ['no exercises at all', '{"exercises": []}'],
    ['a rep count nobody achieves', '{"exercises": [{"exercise": "Squat", "reps": 5000}]}'],
    ['a weight nobody lifts', '{"exercises": [{"exercise": "Squat", "weight": 9000}]}'],
    ['an RPE off the scale', '{"exercises": [{"exercise": "Squat", "rpe": 47}]}'],
  ]) {
    test(`${name} is refused`, () => {
      assert.equal(extractSessionLogBlock(block(json)).session, null);
    });
  }

  test('the problem never carries the content', () => {
    // The block describes what somebody's body did today.
    const { problem } = extractSessionLogBlock(block('{"exercises": [{"exercise": "Squat", "reps": 5000}]}'));
    assert.equal(problem, 'session block failed validation');
    assert.doesNotMatch(problem, /Squat|5000/);
  });
});

describe('a plan is not a record', () => {
  const today = new Date('2026-09-09T12:00:00Z');

  test('tomorrow is refused', () => {
    /*
     * "Log my session for tomorrow" sounds reasonable and must not produce a
     * row: work filed before it happens makes the progression and deload rules
     * believe training was done that was not.
     */
    assert.equal(isLoggableDate('2026-09-10', today), false);
    const { session, problem } = extractSessionLogBlock(
      block('{"date": "2026-09-10", "exercises": [{"exercise": "Squat"}]}'),
      today
    );
    assert.equal(session, null);
    assert.equal(problem, 'session date is not loggable');
  });

  test('today and yesterday are fine, and so is a catch-up', () => {
    assert.equal(isLoggableDate(undefined, today), true, 'absent means today');
    assert.equal(isLoggableDate('2026-09-09', today), true);
    assert.equal(isLoggableDate('2026-09-08', today), true);
    assert.equal(isLoggableDate('2026-01-02', today), true);
  });

  test('but not a date from before the athlete existed', () => {
    assert.equal(isLoggableDate('2000-01-01', today), false);
    assert.equal(isLoggableDate('nonsense', today), false);
    assert.ok(MAX_BACKDATE_DAYS > 365, 'a year of catch-up should be allowed');
  });
});

describe('nothing is written until they say yes', () => {
  test('the route parses it and does NOT save it', () => {
    /*
     * Every other block in this file writes. This one is handed to the browser
     * as a proposal, and that is where the value is: a training log with
     * invented sets in it is worse than an empty one, because it is wrong in a
     * way that looks like data.
     */
    const region = chat.slice(chat.indexOf('extractSessionLogBlock('), chat.indexOf('const replyText'));
    assert.doesNotMatch(region, /from\('workout_sessions'\)/);
    assert.doesNotMatch(region, /\.insert\(/);
    assert.doesNotMatch(chat, /from\('workout_sessions'\)[\s\S]{0,200}\.insert/);
  });

  test('the proposal reaches the browser with a unit it can name', () => {
    assert.match(chat, /proposedSession: proposedSession/);
    assert.match(chat, /units: resolveProfileUnits\(context\.profile\?\.units\)/);
    // Not the ternary that collapses an unknown unit into pounds - that is how
    // the bodyweight write nearly shipped a factor-of-2.2 error.
    assert.doesNotMatch(chat, /units: context\.profile\?\.units === 'kg'/);
  });

  test('the athlete sees what they are agreeing to before agreeing', () => {
    // A confirmation that hides what it is confirming is a button, not a choice.
    const card = page.slice(page.indexOf('proposedSession && ('), page.indexOf('loggedSession && ('));
    assert.match(card, /proposedSession\.session\.exercises\.map/, 'the movements are not listed');
    assert.match(card, /chat\.logYes/);
    assert.match(card, /chat\.logNo/);
  });

  test('yes posts to the endpoint the athlete already owns', () => {
    // No new privilege: POST /api/sessions is their own write path. The coach's
    // reading of their sentence is a pre-filled form, and this is submit.
    assert.match(page, /await api\.logSession\(proposedSession\.session\)/);
  });

  test('a failed save leaves the card up rather than answering no for them', () => {
    const fn = page.slice(page.indexOf('async function confirmSession'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    const clearedAt = body.indexOf('setProposedSession(null)');
    const caughtAt = body.indexOf('catch');
    assert.ok(clearedAt > 0 && caughtAt > 0);
    assert.ok(clearedAt < caughtAt, 'the proposal is cleared in or after the failure path');
  });

  test('no is an answer, and it writes nothing', () => {
    const card = page.slice(page.indexOf('proposedSession && ('), page.indexOf('loggedSession && ('));
    const no = card.slice(card.indexOf('chat.logNo') - 200, card.indexOf('chat.logNo'));
    assert.match(no, /setProposedSession\(null\)/);
    assert.doesNotMatch(no, /logSession/);
  });
});

describe('what the coach is told', () => {
  test('it may not invent a number they did not say', () => {
    assert.match(flatten(prompt), /ONLY WHAT THEY ACTUALLY TOLD YOU/);
    assert.match(flatten(prompt), /AN INVENTED NUMBER IS WORSE THAN A MISSING ONE/);
  });

  test('it may not log a session that has not happened', () => {
    assert.match(flatten(prompt), /ONLY A SESSION THAT HAPPENED/);
    assert.match(flatten(prompt), /A plan filed as a record/);
  });

  test('it offers rather than claiming to have saved', () => {
    // It has not saved anything and may never - they are allowed to tap no.
    assert.match(flatten(prompt), /OFFER, DO NOT ANNOUNCE/);
    assert.match(flatten(prompt), /do not say you have logged it/);
  });

  test('and it asks when the sentence was ambiguous', () => {
    assert.match(flatten(prompt), /IF WHAT THEY SAID IS AMBIGUOUS, ASK/);
  });

  test('both languages have the words', () => {
    for (const locale of ['en', 'es']) {
      const strings = readSource(new URL(`../../web/src/i18n/locales/${locale}.js`, import.meta.url));
      for (const key of ['logThis', 'logYes', 'logNo', 'logging', 'logged']) {
        assert.match(strings, new RegExp(`${key}:`), `${locale} is missing ${key}`);
      }
    }
  });
});

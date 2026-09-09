import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, flatten } from './helpers/source.js';

import {
  MAX_BACKDATE_DAYS,
  extractSessionLogBlock,
  isLoggableDate,
  toProfileWeights,
} from '../src/lib/sessionLogBlock.js';

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

  test('next week is refused, but tomorrow is not', () => {
    /*
     * "Log my session for next Tuesday" must not produce a row: work filed
     * before it happens makes the progression and deload rules believe
     * training was done that was not.
     *
     * ONE DAY OF SLACK, THOUGH, because the server is in UTC and nobody lives
     * there. An athlete in Sydney at nine on Tuesday morning is still on Monday
     * by UTC; refusing their own today would silently drop the block and show
     * them nothing at all, for most of their waking day, forever.
     */
    assert.equal(isLoggableDate('2026-09-16', today), false, 'a week out is a plan');
    assert.equal(isLoggableDate('2026-09-10', today), true, 'UTC+ athletes live here');
    assert.equal(isLoggableDate('2026-09-11', today), false, 'past every real offset');

    const { session, problem } = extractSessionLogBlock(
      block('{"date": "2026-09-16", "exercises": [{"exercise": "Squat"}]}'),
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
    assert.match(page, /await api\.logSession\(\{ date: mine\.session\.date \?\? localDate, \.\.\.mine\.session \}\)/);
  });

  test('the browser decides the date, because the server is in UTC and nobody lives there', () => {
    /*
     * California, nine in the evening, "hit a triple today" - already tomorrow
     * by UTC. Letting the server default it files every evening session a day
     * late, for every US athlete, forever, with nothing looking wrong.
     */
    const fn = page.slice(page.indexOf('async function confirmSession'));
    assert.match(fn, /getTimezoneOffset\(\)/, 'the local date is not computed');
    assert.ok(
      fn.indexOf('getTimezoneOffset()') < fn.indexOf('api.logSession'),
      'the date is resolved after the request'
    );
  });

  test('a failed save leaves the card up rather than answering no for them', () => {
    const fn = page.slice(page.indexOf('async function confirmSession'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    assert.ok(body.indexOf('setProposedSession(') < body.indexOf('catch'), 'cleared in the failure path');
  });

  test('a reply landing mid-save cannot discard a proposal nobody answered', () => {
    /*
     * dispatch() sets proposedSession from its result, and a reply can land
     * while this request is in flight. Clearing "the current proposal" on
     * success would then throw away a DIFFERENT workout - one the athlete was
     * never given long enough to answer, gone with no error and never logged.
     */
    const fn = page.slice(page.indexOf('async function confirmSession'));
    assert.match(fn, /const mine = proposedSession;/, 'the tapped proposal is not held');
    assert.match(
      fn,
      /setProposedSession\(\(current\) => \(current === mine \? null : current\)\)/,
      'it clears whatever happens to be on screen rather than the one it saved'
    );
  });

  test('the card shows everything that would be written', () => {
    /*
     * The first version showed movement, sets x reps and weight - and silently
     * wrote the RPE, which drives autoregulation and deloads, while a failed
     * set rendered identically to a completed one.
     */
    const card = page.slice(page.indexOf('proposedSession && ('), page.indexOf('loggedSession && ('));
    assert.match(card, /movement\.rpe != null/, 'the RPE is written unseen');
    assert.match(card, /movement\.completed === false/, 'a missed set looks like a made one');
    assert.match(card, /movement\.sets && !movement\.reps/, 'sets without reps vanish from the card');
  });

  test('there is no notes field to write unseen', () => {
    /*
     * POST /api/sessions accepts up to 4000 characters of notes. A card cannot
     * show 4000 characters, so offering the field would put model-authored free
     * text into the database that the person tapping yes never read - the one
     * place in this feature where "the athlete confirmed it" would be false.
     */
    const schema = readSource(new URL('../src/lib/sessionLogBlock.js', import.meta.url));
    const block = schema.slice(schema.indexOf('export const SessionLogData'), schema.indexOf('MAX_BACKDATE_DAYS'));
    assert.doesNotMatch(block, /notes:/);
    assert.equal(
      extractSessionLogBlock('<session_log>{"exercises":[{"exercise":"Squat"}],"notes":"anything"}</session_log>').session,
      null,
      'a block carrying notes is accepted'
    );
  });

  test('no is an answer, and it writes nothing', () => {
    const card = page.slice(page.indexOf('proposedSession && ('), page.indexOf('loggedSession && ('));
    const no = card.slice(card.indexOf('chat.logNo') - 200, card.indexOf('chat.logNo'));
    assert.match(no, /setProposedSession\(null\)/);
    assert.doesNotMatch(no, /logSession/);
  });
});

describe('the unit the athlete said it in', () => {
  test('kilos from somebody set to pounds are converted, not relabelled', () => {
    /*
     * "I squatted 100 kilos today" from an athlete whose profile is in pounds
     * had no field to land in, so the card showed "100 lb" - a confident wrong
     * label on a number a human is being asked to confirm, and a 100 lb squat
     * written for somebody who lifted 220.
     */
    const { session } = extractSessionLogBlock(
      block('{"exercises": [{"exercise": "Squat", "weight": 100, "unit": "kg"}]}')
    );
    assert.deepEqual(toProfileWeights(session, 'lb').exercises, [{ exercise: 'Squat', weight: 220.5 }]);
    assert.deepEqual(toProfileWeights(session, 'kg').exercises, [{ exercise: 'Squat', weight: 100 }]);
  });

  test('an unstated unit means the one on their profile', () => {
    const { session } = extractSessionLogBlock(block(SQUAT));
    assert.equal(toProfileWeights(session, 'lb').exercises[0].weight, 245);
    assert.equal(toProfileWeights(session, 'kg').exercises[0].weight, 245);
  });

  test('a unit we cannot name produces no card at all', () => {
    // A weight relabelled into a unit we are guessing at is worse than not
    // offering. Same refusal the bodyweight write makes.
    const { session } = extractSessionLogBlock(block(SQUAT));
    assert.equal(toProfileWeights(session, 'stone'), null);
    assert.equal(toProfileWeights(session, null), null);
    const chatSource = readSource(new URL('../src/routes/chat.js', import.meta.url));
    assert.match(chatSource, /proposedSession && resolveProfileUnits\(context\.profile\?\.units\)/);
  });

  test('the conversion is done here, not in the model', () => {
    assert.match(chat, /toProfileWeights\(proposedSession, resolveProfileUnits/);
  });
});

describe('a failed block is not read aloud', () => {
  test('a truncated block does not dump JSON into the reply', () => {
    /*
     * The prompt puts the block at the very end of the reply, which is exactly
     * where the output cap cuts. So the ordinary truncated reply is one whose
     * block is unclosed, and stripAll removes only the TAGS - the athlete read
     * the payload.
     */
    const { reply, session, problem } = extractSessionLogBlock(
      'Strong work, that is a solid triple.\n<session_log>{"exercises": [{"exercise": "Back'
    );
    assert.equal(reply, 'Strong work, that is a solid triple.');
    assert.doesNotMatch(reply, /exercises|\{/);
    assert.equal(session, null);
    assert.equal(problem, 'unclosed session block');
  });

  test('two blocks leave neither payload in the prose', () => {
    // Built without the block() helper, which prepends prose of its own - the
    // first version of this test asserted against a fixture, not the code.
    const two = `Nice work.\n<session_log>${SQUAT}</session_log>\n<session_log>${SQUAT}</session_log>`;
    const { reply, session, problem } = extractSessionLogBlock(two);
    assert.equal(reply, 'Nice work.');
    assert.doesNotMatch(reply, /exercise/);
    assert.equal(session, null);
    assert.equal(problem, 'two session blocks');
  });
});

describe('the athlete cannot forge the tag either', () => {
  test('session_log is stripped from athlete text like the other three', () => {
    // Four block tags now. Adding one without adding it here leaves the
    // athlete able to write that structure into the prompt.
    const sanitize = readSource(new URL('../src/prompts/sanitize.js', import.meta.url));
    assert.match(sanitize, /'session_log'/);
    for (const tag of ['program_data', 'training_intention', 'profile_update', 'session_log']) {
      assert.match(sanitize, new RegExp(`'${tag}'`), `${tag} is not stripped from athlete text`);
    }
  });
});

describe('the proposal cannot be accepted here and refused by the write path', () => {
  test('every bound matches POST /api/sessions', () => {
    /*
     * The header comment claims these agree and nothing checked it. A proposal
     * the athlete confirms and the server then rejects is a yes that does
     * nothing, which is the most confusing possible outcome.
     */
    const mine = readSource(new URL('../src/lib/sessionLogBlock.js', import.meta.url));
    const theirs = readSource(new URL('../src/routes/sessions.js', import.meta.url));
    for (const bound of [
      /exercise: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(120\)/,
      /sets: z\.number\(\)\.int\(\)\.positive\(\)\.max\(50\)/,
      /reps: z\.number\(\)\.int\(\)\.positive\(\)\.max\(200\)/,
      /rpe: z\.number\(\)\.min\(1\)\.max\(10\)/,
      /\.min\(1\)\.max\(60\)/,
      /regex\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\)/,
    ]) {
      assert.match(mine, bound, `the proposal schema lost ${bound}`);
      assert.match(theirs, bound, `the write path no longer matches ${bound}`);
    }
    // The one place they differ, deliberately: a zero weight is dropped before
    // it can be written, where the form would accept it.
    assert.match(mine, /weight: z\.number\(\)\.positive\(\)\.max\(2000\)/);
    assert.match(theirs, /weight: z\.number\(\)\.nonnegative\(\)\.max\(2000\)/);
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

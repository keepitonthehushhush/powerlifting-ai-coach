import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readMigration, flatten } from './helpers/source.js';

import {
  MAX_BACKDATE_DAYS,
  clientKeyForWrite,
  extractSessionLogBlock,
  isLoggableDate,
  sessionKey,
  toProfileWeights,
} from '../src/lib/sessionLogBlock.js';
import { withLocalDate } from '../../web/src/lib/proposedSession.js';

const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
const page = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));
const prompt = readSource(new URL('../src/prompts/systemPrompt.js', import.meta.url));
const proposal = readSource(new URL('../../web/src/lib/proposedSession.js', import.meta.url));
const migration0065 = readMigration(
  new URL('../../supabase/migrations/0065_the_same_workout_cannot_be_logged_twice.sql', import.meta.url)
);

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
    const fn = page.slice(page.indexOf('async function confirmSession'), page.indexOf('async function dispatch'));
    assert.match(flatten(fn), /await api\.logSession\(\{ \.\.\.mine\.session,/);
    // The whole proposal, not a rebuilt subset: a field dropped here is a
    // field the athlete confirmed and did not get.
    assert.doesNotMatch(fn, /exercises: mine/);
  });

  test('the browser decides the date, because the server is in UTC and nobody lives there', () => {
    /*
     * California, nine in the evening, "hit a triple today" - already tomorrow
     * by UTC. Letting the server default it files every evening session a day
     * late, for every US athlete, forever, with nothing looking wrong.
     *
     * It is decided when the card arrives rather than when it is tapped, so a
     * retry that crosses midnight is still the same workout - see
     * proposedSession.js and the duplicate guard below.
     */
    assert.match(proposal, /getTimezoneOffset\(\)/, 'the local date is not computed');
    assert.equal(
      withLocalDate({ session: { exercises: [] } }).session.date,
      new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
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

/*
 * ── THE SAME WORKOUT, WRITTEN TWICE ─────────────────────────────────────────
 *
 * Two paths turn one session into two rows, and both were named in the commit
 * that shipped the logging feature as NOT fixed:
 *
 *   1. A save that committed and then failed to answer - a proxy 502, a
 *      timeout. The card deliberately stays up so they can try again, and the
 *      second yes inserts a second row.
 *   2. The coach offering the same session again. The block is stripped before
 *      the reply is stored, so the model's own transcript holds no trace that
 *      it already offered one.
 *
 * A duplicate reads to the progression and deload rules as volume that was
 * never lifted: wrong in a way that looks like data.
 */
describe('one workout cannot become two rows', () => {
  const SESSION = {
    date: '2026-09-08',
    exercises: [
      { exercise: 'Back squat', sets: 5, reps: 3, weight: 315, rpe: 8, completed: true },
      { exercise: 'Bench press', sets: 3, reps: 5, weight: 225, completed: true },
    ],
  };

  test('the same session hashes the same way every time', () => {
    // This is the retry: the identical body, posted twice.
    assert.equal(sessionKey(SESSION), sessionKey(structuredClone(SESSION)));
  });

  test('and a different session does not', () => {
    // Every field is part of the key, so a workout that differs anywhere is a
    // different workout. Wrong in the safe direction: two rows for two
    // sessions, never one row for two.
    const changes = [
      { ...SESSION, date: '2026-09-09' },
      { ...SESSION, exercises: [{ ...SESSION.exercises[0], weight: 320 }, SESSION.exercises[1]] },
      { ...SESSION, exercises: [{ ...SESSION.exercises[0], reps: 4 }, SESSION.exercises[1]] },
      { ...SESSION, exercises: [{ ...SESSION.exercises[0], sets: 4 }, SESSION.exercises[1]] },
      { ...SESSION, exercises: [{ ...SESSION.exercises[0], rpe: 9 }, SESSION.exercises[1]] },
      { ...SESSION, exercises: [{ ...SESSION.exercises[0], completed: false }, SESSION.exercises[1]] },
      { ...SESSION, exercises: [SESSION.exercises[0]] },
      // Order carries meaning in a training log - squats then bench is not
      // bench then squats - and nothing is sorted before hashing.
      { ...SESSION, exercises: [SESSION.exercises[1], SESSION.exercises[0]] },
    ];
    for (const changed of changes) {
      assert.notEqual(sessionKey(changed), sessionKey(SESSION), `${JSON.stringify(changed)} hashed the same`);
    }
  });

  test('a missing field and a field set to nothing are not silently the same', () => {
    // `{sets: 5}` and `{sets: 5, rpe: undefined}` must agree, or a proposal
    // and its retry could differ over a key that was never there.
    const bare = { date: '2026-09-08', exercises: [{ exercise: 'Deadlift', reps: 1, weight: 405 }] };
    const explicit = {
      date: '2026-09-08',
      exercises: [{ exercise: 'Deadlift', sets: undefined, reps: 1, weight: 405, rpe: undefined }],
    };
    assert.equal(sessionKey(bare), sessionKey(explicit));
  });

  test('the key it produces is one the column will accept', () => {
    /*
     * Read out of the migration rather than copied, so widening one and not
     * the other cannot pass. A key the CHECK rejects is not a duplicate guard
     * at all - it is every coach-proposed save failing.
     */
    const constraint = migration0065.match(/client_key ~ '(\^\[[^']+)'/);
    assert.ok(constraint, 'the migration no longer constrains the shape of client_key');
    const shape = new RegExp(constraint[1]);
    for (const candidate of [SESSION, { ...SESSION, date: '2026-01-01' }, { exercises: SESSION.exercises }]) {
      assert.match(sessionKey(candidate), shape);
    }
  });

  test('nothing sensible to hash returns no key rather than a key for nothing', () => {
    assert.equal(sessionKey(null), null);
    assert.equal(sessionKey({}), null);
    assert.equal(sessionKey({ exercises: 'squats' }), null);
  });
});

describe('what gets a key and what deliberately does not', () => {
  const BODY = { date: '2026-09-08', exercises: [{ exercise: 'Squat', sets: 3, reps: 5, weight: 275 }] };

  test('a session the coach proposed is deduplicated', () => {
    assert.equal(clientKeyForWrite({ fromCoach: true, ...BODY }), sessionKey(BODY));
  });

  test('a session they typed themselves is never refused as a duplicate', () => {
    /*
     * The whole reason the column is nullable and the index is partial.
     * Somebody who trained twice in one day and enters both by hand meant it,
     * and Postgres allows many NULLs, so they are never fought.
     */
    for (const fromCoach of [undefined, false, null]) {
      assert.equal(clientKeyForWrite({ fromCoach, ...BODY }), null);
    }
  });

  test('the browser says only that it came from the card - it does not choose the key', () => {
    /*
     * A client that could hand over a key could reserve a string some future
     * real session would need, and that session would come back "already
     * logged" having never been written. So the flag is the only thing
     * trusted, and the key is derived here from the body being saved.
     */
    const route = readSource(new URL('../src/routes/sessions.js', import.meta.url));
    assert.match(route, /from_coach: z\.boolean\(\)\.optional\(\)/);
    assert.match(route, /clientKeyForWrite\(\{ fromCoach, date: day, exercises \}\)/);
    assert.doesNotMatch(route, /client_key: z\./, 'the write path accepts a key from the browser');
  });

  test('the day is settled before the key is taken', () => {
    /*
     * Hashing `date` and letting the insert default separately gives one
     * workout two keys on every request that arrives without a day - which is
     * every manual save, and would be every proposal if the browser ever
     * stopped filling it in.
     */
    const route = readSource(new URL('../src/routes/sessions.js', import.meta.url));
    const day = route.indexOf('const day =');
    const key = route.indexOf('clientKeyForWrite(');
    const insert = route.indexOf(".from('workout_sessions')\n      .insert(");
    assert.ok(day > -1 && key > day, 'the key is derived before the day is resolved');
    assert.ok(insert > key, 'the key is derived after the insert');
    assert.match(route, /date: day,/);
  });
});

describe('being told it is already logged is not an error', () => {
  const route = readSource(new URL('../src/routes/sessions.js', import.meta.url));
  const failure = route.slice(route.indexOf('if (sessionError) {'), route.indexOf('const logRows'));

  test('a unique violation returns the session that is already there', () => {
    assert.match(failure, /sessionError\.code === '23505'/);
    assert.match(failure, /res\.status\(200\)/);
    assert.match(failure, /duplicate: true/);
  });

  test('and it returns before writing the derived logs a second time', () => {
    /*
     * progress_logs is fanned out from the session below. Falling through on
     * the duplicate path would leave one workout with two sets of derived
     * rows, which is the same corruption by another door - the charts would
     * show it, even though workout_sessions looked right.
     */
    assert.ok(failure.trimEnd().endsWith('}'), 'the failure branch no longer closes before the fan-out');
    assert.match(failure, /res\.status\(200\)[\s\S]*?return;/);
    assert.ok(route.indexOf('const logRows') > route.indexOf('duplicate: true'));
  });

  test('a collision it cannot explain is still an error', () => {
    // If the lookup finds nothing, this was not the duplicate guard firing.
    // Swallowing that would answer "saved" for a write that did not happen.
    assert.match(failure, /if \(existing\) \{/);
    assert.match(failure, /throw codedError\('storage_unavailable'/);
  });

  test('the lookup stays inside the athlete', () => {
    // req.supabase carries their token, so RLS scopes it - and user_id is
    // named anyway, which is also what makes it an index hit.
    assert.doesNotMatch(failure, /supabaseAdmin/);
    assert.match(failure, /\.eq\('user_id', req\.user\.id\)/);
    assert.match(failure, /\.eq\('client_key', clientKey\)/);
  });
});

describe('the constraint that makes the guard real', () => {
  test('the index is unique, per athlete, and partial', () => {
    assert.match(migration0065, /create unique index[\s\S]*?on public\.workout_sessions \(user_id, client_key\)/);
    // Not global: two athletes doing the same workout on the same day is the
    // ordinary case, not a collision.
    assert.match(migration0065, /where client_key is not null/);
  });

  test('the column is added without a default, so nothing existing is claimed', () => {
    /*
     * Scoped to the ALTER, because the index below legitimately says "where
     * client_key is not null" and a whole-file assertion matches it - the same
     * false-negative shape that made a comment satisfy a constraint check.
     */
    const alter = migration0065.slice(
      migration0065.indexOf('alter table'),
      migration0065.indexOf('comment on column')
    );
    assert.match(alter, /add column if not exists client_key text/);
    assert.doesNotMatch(alter, /default/);
    // Backfilling every session that already exists with a key would refuse a
    // workout somebody legitimately repeats.
    assert.doesNotMatch(alter, /not null/);
    assert.doesNotMatch(alter, /update public\.workout_sessions/);
  });
});

describe('the card cannot defeat its own guard', () => {
  test('the browser says where the save came from', () => {
    assert.match(page, /from_coach: true/);
  });

  test('the manual log form does not', () => {
    // It sends what the form built and nothing else. If it ever said
    // from_coach, two identical hand-entered sessions would become one.
    const form = readSource(new URL('../../web/src/pages/LogSession.jsx', import.meta.url));
    assert.doesNotMatch(form, /from_coach/);
  });

  test('the day is stamped when the card arrives, not when it is tapped', () => {
    /*
     * A first attempt at 23:59 and its retry at 00:01 would otherwise post
     * different days, hash differently, and write two rows - defeating the
     * guard on the exact path it exists for.
     */
    assert.match(page, /setProposedSession\(withLocalDate\(result\.proposedSession\)\)/);
    const confirm = page.slice(page.indexOf('async function confirmSession'), page.indexOf('async function dispatch'));
    assert.doesNotMatch(confirm, /getTimezoneOffset/, 'the day is recomputed when they tap');
    assert.match(proposal, /getTimezoneOffset/);
  });

  test('a day the coach gave is left alone', () => {
    // "I squatted on Saturday" is Saturday, not today.
    assert.equal(withLocalDate({ session: { date: '2026-09-05', exercises: [] } }).session.date, '2026-09-05');
    assert.equal(withLocalDate(null), null);
    assert.equal(withLocalDate(undefined), null);
  });
});

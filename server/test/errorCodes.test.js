import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { ERROR_CODES, ERROR_CODE_KEYS, RETIRED_IDS, codedError, displayCode } from '../src/lib/errorCodes.js';
import { describeCoachReply, coachError, TRUNCATION_NOTICE } from '../src/lib/coachOutcome.js';
import { readSource, readRaw, phrase } from './helpers/source.js';

/**
 * ── THE REPORT ──────────────────────────────────────────────────────────────
 *
 * "I replied to the AI coach and it didnt care for my logs and struggled to
 * reply afterwards when I replied an answer to a question it had and error'd:
 * The coach returned an empty response. Please try again."
 *
 * The production log for that request said, in full:
 *
 *   {"level":"error","message":"request.failed","meta":{"method":"POST",
 *    "path":"/api/chat","status":502,"error":{"name":"HttpError",
 *    "message":"The coach returned an empty response. Please try again."}}}
 *
 * Which is the sentence, again. The response object had carried `stop_reason`
 * the whole time and `createCoachReply` returned it - and the route checked
 * `if (!reply.text)` and threw the same sentence for four different causes,
 * one of which ("refusal") arrives as a normal HTTP 200 and cannot be fixed by
 * the "please try again" the message advises.
 */

const SERVER_SOURCES = (function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) return walk(child);
    return entry.name.endsWith('.js') ? [{ url: child, name: entry.name }] : [];
  });
})(new URL('../src/', import.meta.url));

describe('the registry', () => {
  test('it is not empty, and the scan that reads it works', () => {
    assert.ok(ERROR_CODE_KEYS.length >= 15, `found ${ERROR_CODE_KEYS.length} codes`);
    assert.ok(SERVER_SOURCES.length > 20, `found ${SERVER_SOURCES.length} server files`);
  });

  test('EVERY ID IS UNIQUE', () => {
    const ids = ERROR_CODE_KEYS.map((key) => ERROR_CODES[key].id);
    const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(duplicated, [], 'two codes share an id, so one of them is unquotable');
  });

  test('AND NO ID HAS BEEN REUSED AFTER RETIREMENT', () => {
    // The whole value of a code is that it means one thing forever. Somebody
    // has CD-002 written in a support email.
    const reused = ERROR_CODE_KEYS.filter((key) => RETIRED_IDS.includes(ERROR_CODES[key].id));
    assert.deepEqual(reused, [], 'a retired id was handed out again');
  });

  test('ids are positive integers, so the display form is stable', () => {
    const bad = ERROR_CODE_KEYS.filter((key) => !Number.isInteger(ERROR_CODES[key].id) || ERROR_CODES[key].id < 1);
    assert.deepEqual(bad, []);
    assert.equal(displayCode('coach_refused'), 'CD-002');
    assert.match(displayCode(ERROR_CODE_KEYS[ERROR_CODE_KEYS.length - 1]), /^CD-\d{3}$/);
  });

  test('every status is a real HTTP status, or null for an annotation', () => {
    const bad = ERROR_CODE_KEYS.filter((key) => {
      const { status } = ERROR_CODES[key];
      return status !== null && !(Number.isInteger(status) && status >= 400 && status <= 599);
    });
    assert.deepEqual(bad, []);
  });

  test('an annotation cannot be thrown', () => {
    // coach_truncated describes a reply the athlete still receives. Throwing
    // it would hide a program because its last line was cut off.
    assert.equal(ERROR_CODES.coach_truncated.status, null);
    assert.throws(() => codedError('coach_truncated', 'x'), /annotates a successful reply/);
  });

  test('and an unknown code fails loudly rather than silently', () => {
    assert.throws(() => codedError('not_a_real_code', 'x'), /unknown error code/);
    assert.throws(() => displayCode('not_a_real_code'), /unknown error code/);
  });

  test('the envelope carries both forms, because they are for different readers', () => {
    const error = codedError('storage_unavailable', 'Could not load your profile.', { cause: '42501' });
    assert.equal(error.status, 502);
    assert.equal(error.details.code, 'storage_unavailable', 'the logs and the table group by this');
    assert.equal(error.details.errorCode, 'CD-006', 'the athlete quotes this');
    assert.equal(error.details.retryable, true);
    assert.equal(error.details.cause, '42501');
  });

  test('AND details CANNOT OVERRIDE THE CODE', () => {
    // A call site that passes its own `code` used to win. Two codes for one
    // failure is worse than none.
    const error = codedError('not_found', 'Gone.', { code: 'something_else' });
    assert.equal(error.details.code, 'not_found');
  });
});

describe('every error the server throws has a code', () => {
  test('NOTHING CONSTRUCTS AN HttpError DIRECTLY ANY MORE', () => {
    /*
     * The invariant that makes the registry worth having. One un-coded throw
     * is one failure that cannot be grouped, quoted or counted - and it will
     * be the one somebody reports.
     *
     * readSource, because coachOutcome.js quotes the old line in the comment
     * explaining why it is gone.
     */
    const offenders = SERVER_SOURCES.filter(({ url, name }) => {
      if (name === 'errorCodes.js' || name === 'httpError.js') return false;
      return /new HttpError\(/.test(readSource(url));
    }).map(({ name }) => name);

    assert.deepEqual(offenders, [], 'these throw an error nobody can quote a code for');
  });

  test('and every code named in the server is registered', () => {
    const used = new Set();
    for (const { url } of SERVER_SOURCES) {
      for (const match of readSource(url).matchAll(/codedError\(\s*'([a-z_]+)'/g)) used.add(match[1]);
    }
    assert.ok(used.size >= 10, `expected the call sites, found ${used.size}`);
    const unregistered = [...used].filter((key) => !ERROR_CODES[key]);
    assert.deepEqual(unregistered, []);
  });

  test('and no registered code is dead', () => {
    // A code nobody throws is a code that will be misremembered as meaning
    // something else the day somebody reaches for it.
    const source = SERVER_SOURCES.map(({ url }) => readSource(url)).join('\n');
    const unused = ERROR_CODE_KEYS.filter(
      (key) => ERROR_CODES[key].status !== null && !source.includes(`'${key}'`)
    );
    assert.deepEqual(unused, [], 'these are declared and never thrown');
  });
});

describe('what the coach actually did', () => {
  const withText = { text: 'Squat 3x5 at 225.', blockTypes: ['text'] };

  test('a normal reply is just a reply', () => {
    const outcome = describeCoachReply({ ...withText, stopReason: 'end_turn' });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.code, null);
    assert.equal(outcome.truncated, false);
  });

  test('A REFUSAL IS NOT AN EMPTY RESPONSE', () => {
    // Anthropic returns this as a normal HTTP 200 with no usable text, so it
    // is indistinguishable from a blank unless the stop reason is read. The
    // old code told the athlete to try again, which cannot work: the same
    // words refuse again.
    const outcome = describeCoachReply({ text: '', stopReason: 'refusal', blockTypes: [] });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'coach_refused');
    assert.equal(outcome.retry, false, 'retrying a refusal doubles the cost and changes nothing');
    assert.match(outcome.message, /different way/);
  });

  test('a genuine blank is the one case worth retrying', () => {
    const outcome = describeCoachReply({ text: '', stopReason: 'end_turn', blockTypes: ['text'] });
    assert.equal(outcome.code, 'coach_empty');
    assert.equal(outcome.retry, true);
  });

  test('AND A TRUNCATED REPLY IS DELIVERED, NOT THROWN', () => {
    // There is a program in it. Withholding it because the last line is cut
    // off is worse for the athlete than showing it and saying so.
    for (const stopReason of ['max_tokens', 'model_context_window_exceeded']) {
      const outcome = describeCoachReply({ ...withText, stopReason });
      assert.equal(outcome.ok, true, `${stopReason} must not be an error`);
      assert.equal(outcome.truncated, true);
      assert.equal(outcome.code, 'coach_truncated');
    }
  });

  test('and truncation with nothing to deliver is treated as blank', () => {
    // The tokens went somewhere other than text. There is nothing to show, so
    // the retryable path is the right one.
    const outcome = describeCoachReply({ text: '', stopReason: 'max_tokens', blockTypes: ['thinking'] });
    assert.equal(outcome.code, 'coach_empty');
    assert.equal(outcome.retry, true);
  });

  test('an unrecognised stop reason with text still works', () => {
    // A stop reason added to the API next year must not take the product down.
    const outcome = describeCoachReply({ ...withText, stopReason: 'something_new' });
    assert.equal(outcome.ok, true);
  });

  test('THE DIAGNOSTIC NEVER CARRIES THE CONVERSATION', () => {
    // This goes to a log and to error_events. The athlete's message and the
    // coach's reply are not diagnostics.
    const outcome = describeCoachReply({
      text: 'my shoulder has been hurting since the meet',
      stopReason: 'end_turn',
      blockTypes: ['text'],
    });
    const serialised = JSON.stringify(outcome.log);
    assert.doesNotMatch(serialised, /shoulder|hurting|meet/);
    assert.deepEqual(Object.keys(outcome.log).sort(), ['blockTypes', 'hadText', 'stopCategory', 'stopReason']);
  });

  test('the thrown error carries the stop reason that explains it', () => {
    const outcome = describeCoachReply({ text: '', stopReason: 'refusal', blockTypes: [] });
    const error = coachError(outcome);
    assert.equal(error.status, 502);
    assert.equal(error.details.errorCode, 'CD-002');
    assert.equal(error.details.stopReason, 'refusal');
  });
});

describe('the route acts on it', () => {
  const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
  const chatRaw = readRaw(new URL('../src/routes/chat.js', import.meta.url));

  test('EXACTLY ONE RETRY, AND ONLY WHERE IT CAN HELP', () => {
    // Two is a pattern that turns a bad afternoon at the API into a bill.
    assert.equal((chat.match(/await ask\(\)/g) ?? []).length, 2);
    assert.equal((chat.match(/await createCoachReply\(/g) ?? []).length, 1, 'one call site, two attempts');
    assert.match(chat, /if \(!outcome\.ok && outcome\.retry\)/);
  });

  test('the failure is logged with its reason before it is thrown', () => {
    assert.match(chat, /logger\.error\('coach\.reply_unusable'/);
    assert.match(chat, /\.\.\.outcome\.log/);
  });

  test('and the truncation notice is appended AFTER the block is stripped', () => {
    // Otherwise it lands inside the JSON, or is mistaken for part of the
    // program.
    const strip = chat.indexOf('extractProgramBlock');
    const notice = chat.indexOf('TRUNCATION_NOTICE', strip);
    assert.ok(notice > strip, 'the notice is added before the program block is removed');
    assert.match(TRUNCATION_NOTICE, /stops early/);
  });

  test('the reasoning survives', () => {
    assert.match(chatRaw, phrase('A refusal is not transient'));
  });
});

describe('what the athlete sees', () => {
  const api = readSource(new URL('../../web/src/lib/api.js', import.meta.url));
  const chat = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));

  test('the client keeps both forms of the code', () => {
    assert.match(api, /this\.code = body\?\.details\?\.code/);
    assert.match(api, /this\.errorCode = body\?\.details\?\.errorCode/);
  });

  test('THE CODE IS SHOWN ON A 5xx AND NOT ON A 4xx', () => {
    // A code beside "that message is too long" is clutter - the athlete can
    // fix that themselves and has nothing to report. A code beside "the coach
    // is unreachable" is the difference between "it broke" and "CD-004".
    assert.match(api, /error\?\.status >= 500/);
    assert.match(chat, /errorText\(err\)/);
  });

  test('and a missing code degrades to the sentence', () => {
    assert.match(api, /if \(!code \|\| !\(error\?\.status >= 500\)\) return message;/);
  });
});

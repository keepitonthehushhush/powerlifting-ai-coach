import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/prompts/systemPrompt.js';
import { readSource, phrase } from './helpers/source.js';
import { en } from '../../web/src/i18n/locales/en.js';

const prompt = buildSystemPrompt({ profile: {} });
const programPage = readSource(new URL('../../web/src/pages/Program.jsx', import.meta.url));
const evalSource = readSource(new URL('../../scripts/safety-eval.mjs', import.meta.url));

/**
 * ── A SESSION IS COMPLETE, OR IT IS NOT A SESSION ─────────────────────────
 *
 * "I don't want it to be lazy and say to repeat last week's info or unchanged
 * or do a protocol. I want it to be precise each time."
 *
 * The reason is not tidiness. A session is read in a gym, on a phone, by
 * somebody with chalk on their hands who is about to put a loaded bar on
 * their back. "Same as last week" makes them scroll back through a
 * conversation to find a number while the screen times out - and that is
 * exactly the moment somebody guesses instead. A guessed load is a missed rep
 * or an injury.
 *
 * Repeating yourself costs the coach nothing. Making them hunt costs them the
 * set.
 */
describe('the coach is told to write the whole session, every time', () => {
  test('the rule exists and is stated without an exception', () => {
    assert.match(prompt, phrase('NEVER SEND THEM LOOKING FOR IT'));
    assert.match(prompt, phrase('COMPLETE ON ITS OWN'));
    // The hardest case, and the one a model will talk itself out of: the
    // session that really is identical.
    assert.match(prompt, phrase('This holds even when the session genuinely IS identical'));
    assert.match(prompt, phrase('is not a program; it is a reference to one'));
  });

  test('every lazy phrase is banned by name, not by principle', () => {
    /*
     * A rule stated only in the abstract is one a model can agree with and
     * still break, which is the lesson from the obstacle sequence: naming the
     * exact moves is what made that fix hold. These are the phrasings a coach
     * actually reaches for.
     */
    for (const lazy of [
      'same as last week',
      'unchanged',
      'as above',
      'as before',
      'like last time',
      'repeat Day A',
      'keep the same weights',
      'follow the usual protocol',
      'your normal warm-up',
    ]) {
      assert.ok(prompt.includes(lazy), `"${lazy}" is not named in the prompt`);
    }
  });
});

describe('the layout matches the page the athlete already reads', () => {
  test('the mandated columns are the Program page columns, in order', () => {
    /*
     * The same numbers should look the same in both places. If the Program
     * page ever changes its columns, this fails and the prompt gets updated
     * with it - rather than the two drifting into different shapes for the
     * same information.
     */
    const columns = [...programPage.matchAll(/t\('program\.(movement|sets|reps|weight)'\)/g)].map(
      ([, key]) => en.program[key]
    );
    assert.deepEqual(
      columns,
      ['Movement', 'Sets', 'Reps', 'Weight'],
      'the Program page columns have changed - the prompt must change with them'
    );
    assert.match(prompt, phrase('| Movement | Sets | Reps | Weight |'));
  });

  test('one movement per row, and no empty Weight cell', () => {
    // "3x5" in a Reps cell and a blank Weight are the two ways a table stops
    // being scannable in a gym.
    assert.match(prompt, phrase('One movement per row'));
    assert.match(prompt, phrase('Never blank, never a dash, never "same"'));
  });

  test('the example loads are in plates, and the prompt says why', () => {
    /*
     * The cached prefix is shared by every athlete, so an invented example
     * weight is indistinguishable from a leaked one - promptCaching.test.js
     * asserts that and caught this section when it was first written with
     * real numbers in it. The explanation is in the prompt so the next person
     * to edit this table does not reintroduce them.
     */
    const start = prompt.indexOf('# HOW TO WRITE A SESSION');
    const section = prompt.slice(start, prompt.indexOf('# RECORDING A PROGRAM', start));
    assert.ok(start > -1, 'the session-layout section has gone');

    assert.match(section, phrase('written as plates on purpose'));
    assert.match(section, phrase('In a REAL session you write the actual number and its units'));
    assert.doesNotMatch(
      section,
      /\b(1[0-9]{2}|2[0-9]{2}|3[0-9]{2})\s*(lb|kg)\b/,
      'a real-looking load is back in the cached prefix'
    );
  });

  test('and it does not tell the coach to pad the session', () => {
    // Clean means clean. The athlete came for the numbers.
    assert.match(prompt, phrase('No motivational preamble before the numbers'));
  });
});

describe('the eval can catch the coach being lazy', () => {
  test('the scenario exists, and gives an identical week on purpose', () => {
    // The hard case: a week that really is the same is exactly where writing
    // it out again feels redundant to the model and is not.
    assert.match(evalSource, /name: 'A repeat session is written out in full/);
    assert.match(evalSource, /I hit every rep at the same weights you gave me/);
  });

  test('the lazy-phrase regex is read from the eval, and discriminates', () => {
    /*
     * Read out of the source rather than restated, so this cannot agree with
     * a copy while the eval runs something else - the mistake this project
     * made once already with the conditional-coaching regex.
     */
    const found = evalSource.match(/ok: !\/(\\b\(same as[^/]*)\/i\.test\(/);
    assert.ok(found, 'the lazy-phrase regex is no longer where this test looks');
    const lazy = new RegExp(found[1], 'i');

    for (const sentence of [
      'Same as last week.',
      'Weights unchanged.',
      'Rows: as above.',
      'Bench: as before.',
      'Repeat Day A.',
      'Keep the same weights.',
      'Follow the usual protocol.',
      'Squat 3x5, you know the drill.',
    ]) {
      assert.ok(lazy.test(sentence), `not caught: "${sentence}"`);
    }

    // And the false-positive half. A check that fires on a correctly written
    // session is a check somebody deletes.
    for (const sentence of [
      'Back squat: 3 sets of 5 at two plates a side.',
      'Last week you hit every rep, so today we add five pounds.',
      'Rest 3 minutes between sets.',
      'Your squat and bench both move up today; rows stay where they are at 95 lb.',
    ]) {
      assert.ok(!lazy.test(sentence), `false positive: "${sentence}"`);
    }
  });
});

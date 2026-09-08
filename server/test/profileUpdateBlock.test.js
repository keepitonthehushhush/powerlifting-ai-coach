import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, flatten } from './helpers/source.js';

import {
  LB_PER_KG,
  ProfileUpdateData,
  extractProfileUpdateBlock,
  toProfileUnits,
} from '../src/lib/profileUpdateBlock.js';

const block = (json) => `Good session.\n\n<profile_update>${json}</profile_update>`;

describe('reading a bodyweight out of a reply', () => {
  test('the block comes out and the prose goes to the athlete', () => {
    const { reply, update, problem } = extractProfileUpdateBlock(
      block('{"bodyweight": 205, "units": "lb"}')
    );
    assert.equal(reply, 'Good session.');
    assert.deepEqual(update, { bodyweight: 205, units: 'lb' });
    assert.equal(problem, null);
  });

  test('a reply with no block is untouched', () => {
    const { reply, update } = extractProfileUpdateBlock('Squat looked sharp today.');
    assert.equal(reply, 'Squat looked sharp today.');
    assert.equal(update, null);
  });

  test('a lone closing tag is still stripped', () => {
    // programBlock.js records shipping this one: the athlete saw the tag.
    const { reply, update } = extractProfileUpdateBlock('Nice.</profile_update>');
    assert.equal(reply, 'Nice.');
    assert.equal(update, null);
  });

  for (const [name, text, problem] of [
    ['two blocks', `${block('{"bodyweight": 205, "units": "lb"}')}${block('{"bodyweight": 210, "units": "lb"}')}`, 'two profile blocks'],
    ['a truncated block', 'Good session.\n\n<profile_update>{"bodyweight": 205,', 'unclosed profile block'],
    ['prose where JSON should be', block('two hundred and five pounds'), 'profile block was not JSON'],
  ]) {
    test(`${name} stores nothing and shows nothing`, () => {
      const result = extractProfileUpdateBlock(text);
      assert.equal(result.update, null);
      assert.equal(result.problem, problem);
      assert.doesNotMatch(result.reply, /profile_update/);
      assert.match(result.reply, /Good session\.|^$/);
    });
  }

  test('the problem never carries the number', () => {
    // A bodyweight is a fact about somebody's body and this string is a log line.
    const { problem } = extractProfileUpdateBlock(block('{"bodyweight": 205, "units": "st"}'));
    assert.equal(problem, 'profile block failed validation');
    assert.doesNotMatch(problem, /205/);
  });
});

describe('what the block is allowed to say', () => {
  const rejects = (value, why) =>
    assert.equal(ProfileUpdateData.safeParse(value).success, false, why);

  test('the unit is required, because there is no safe default for it', () => {
    rejects({ bodyweight: 205 }, 'a bodyweight with no unit is a guess');
  });

  test('a field nobody whitelisted is a refusal, not a partial write', () => {
    // .strict(). A model doing something we did not ask for is a reason to
    // store nothing, not a reason to keep the parts we recognize.
    rejects({ bodyweight: 205, units: 'lb', current_squat: 405 });
    rejects({ bodyweight: 205, units: 'lb', health_restrictions: 'none' });
  });

  test('numbers no person weighs are refused in the unit they were given', () => {
    rejects({ bodyweight: 4, units: 'lb' }, 'four pounds');
    rejects({ bodyweight: 1200, units: 'lb' });
    rejects({ bodyweight: 3, units: 'kg' });
    rejects({ bodyweight: 600, units: 'kg' });
    // ...and the bounds are per-unit, so a real kg weight is not judged as lb.
    assert.equal(ProfileUpdateData.safeParse({ bodyweight: 84, units: 'kg' }).success, true);
    assert.equal(ProfileUpdateData.safeParse({ bodyweight: 84, units: 'lb' }).success, true);
  });

  test('a string that looks like a number is not a number', () => {
    rejects({ bodyweight: '205', units: 'lb' });
  });
});

describe('the conversion the model is not asked to do', () => {
  test('kilograms into a profile kept in pounds', () => {
    assert.equal(toProfileUnits(84, 'kg', 'lb'), 185.19);
  });

  test('pounds into a profile kept in kilograms', () => {
    assert.equal(toProfileUnits(185, 'lb', 'kg'), 83.91);
  });

  test('same unit is left exactly alone', () => {
    assert.equal(toProfileUnits(205, 'lb', 'lb'), 205);
    assert.equal(toProfileUnits(93.5, 'kg', 'kg'), 93.5);
  });

  test('a profile with no unit set is in pounds', () => {
    // The default everywhere else in this app, including the intake form. It
    // must be the default here too, or a profile that never chose a unit gets
    // a kilogram number written into a pound column.
    assert.equal(toProfileUnits(84, 'kg', null), 185.19);
    assert.equal(toProfileUnits(84, 'kg', undefined), 185.19);
  });

  test('a unit we cannot name converts to nothing at all', () => {
    assert.equal(toProfileUnits(205, 'stone', 'lb'), null);
    assert.equal(toProfileUnits(205, '', 'lb'), null);
    assert.equal(toProfileUnits(Number.NaN, 'lb', 'lb'), null);
  });

  test('a round trip does not drift', () => {
    const there = toProfileUnits(200, 'lb', 'kg');
    assert.ok(Math.abs(toProfileUnits(there, 'kg', 'lb') - 200) < 0.02);
  });

  test('the constant is the legal definition, not a measurement', () => {
    assert.equal(LB_PER_KG, 1 / 0.45359237);
  });
});

describe('how the route uses it', () => {
  const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));

  test('it reads the prose the other two extractors have finished with', () => {
    // Running it against the raw reply would put the intention tags back into
    // what the athlete reads - the bug the intention extractor already records.
    assert.match(chat, /extractProfileUpdateBlock\(withoutIntention\)/);
  });

  test('the server converts, not the model', () => {
    assert.match(chat, /toProfileUnits\(\s*profileUpdate\.bodyweight,\s*profileUpdate\.units/);
  });

  test('nothing is written when the number has not changed', () => {
    // A write per message for no reason, and a "bodyweight updated" notice
    // under a reply that changed nothing teaches the athlete to ignore it.
    assert.match(flatten(chat), /unchanged =[^;]*Math\.abs\(current - bodyweight\) < 0\.01/);
  });

  test('the confirmation is set only after a write actually landed', () => {
    const set = chat.indexOf('savedProfile = {');
    const failed = chat.indexOf('profile.bodyweight_save_failed');
    assert.ok(set > 0 && failed > 0);
    assert.match(
      chat.slice(chat.lastIndexOf('if (error)', set), set),
      /else \{/,
      'the athlete would be told their weight was saved when it was not'
    );
  });

  test('a minor never has their weight filed away, whoever raised it', () => {
    // The prompt forbids it and the prompt is the first line of defense. This
    // is the second: an instruction is not a control, and a minor CAN reach
    // this route when minors are enabled and a guardian has consented.
    const guard = chat.slice(chat.indexOf('const adultForProfile'), chat.indexOf('const units ='));
    assert.match(guard, /evaluateAgeGate\(context\.profile\?\.date_of_birth\)/);
    assert.match(guard, /profileUpdate && !adultForProfile\.allowed/);
    assert.match(guard, /profile\.bodyweight_refused_not_adult/);
    // Fails closed: `allowed` is false for an unknown or implausible date too,
    // so a missing date of birth is not permission.
    assert.doesNotMatch(guard, /reason === 'too_young'/);
  });

  test('the refusal logs a reason code and never a date or an age', () => {
    const line = chat.slice(chat.indexOf('profile.bodyweight_refused_not_adult'));
    assert.doesNotMatch(line.slice(0, 220), /date_of_birth|age:/);
  });

  test('a failure is logged by cause and never by value', () => {
    const line = chat.slice(chat.indexOf('profile.bodyweight_save_failed'));
    assert.doesNotMatch(line.slice(0, 200), /bodyweight[,:]\s*bodyweight|message: error\.message/);
  });
});

describe('what the coach is told about it', () => {
  const prompt = flatten(readSource(new URL('../src/prompts/systemPrompt.js', import.meta.url)));

  test('the block is shown, with its unit field', () => {
    assert.match(prompt, /<profile_update>/);
    assert.match(prompt, /"units": "lb"/);
  });

  test('a goal weight is named as the thing it must not record', () => {
    assert.match(prompt, /Not a goal, not a target/);
  });

  test('it is told not to convert', () => {
    assert.match(prompt, /Do not convert/);
  });

  test('it is told to say so out loud, unlike the training plan', () => {
    // The intention block is deliberately silent. This one must not be.
    assert.match(prompt, /SAY IT IN YOUR REPLY/);
  });

  test('disordered eating and minors switch it off entirely', () => {
    assert.match(prompt, /DO NOT EMIT IT AT ALL[^.]*disordered eating/);
    assert.match(prompt, /NEVER FOR A MINOR/);
  });
});

describe('what the athlete sees', () => {
  const page = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));

  test('the recorded weight is shown with a way to change it', () => {
    assert.match(page, /chat\.bodyweightSaved/);
    const notice = page.slice(page.indexOf('savedProfile &&'), page.indexOf('savedProgram &&'));
    assert.match(notice, /to="\/account"/, 'nowhere to go and correct it');
  });

  test('both languages have the words', () => {
    for (const locale of ['en', 'es']) {
      const strings = readSource(new URL(`../../web/src/i18n/locales/${locale}.js`, import.meta.url));
      assert.match(strings, /bodyweightSaved:/, `${locale} is missing the notice`);
      assert.match(strings, /bodyweightSavedLink:/, `${locale} is missing the link`);
    }
  });
});

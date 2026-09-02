import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import { prescribesTraining, repairProgramBlock } from '../src/lib/programRepair.js';
import { PROGRAM_TAG } from '../src/lib/programBlock.js';

const route = readSource(new URL('../src/routes/chat.js', import.meta.url));

const VALID = {
  phase: 'novice',
  week: 1,
  summary: 'Week one, three days.',
  days: [
    {
      name: 'Day A',
      exercises: [
        { lift: 'squat', sets: 3, reps: 5, weight: 225, notes: null },
        { lift: 'bench press', sets: 3, reps: 5, weight: 155, notes: null },
      ],
    },
  ],
};

const block = (json = VALID) => `<${PROGRAM_TAG}>\n${JSON.stringify(json)}\n</${PROGRAM_TAG}>`;

/** A callModel that records what it was handed and returns a fixed reply. */
function stub(reply) {
  const calls = [];
  const callModel = async (system, messages) => {
    calls.push({ system, messages });
    if (reply instanceof Error) throw reply;
    return typeof reply === 'string' ? { text: reply } : reply;
  };
  return { callModel, calls };
}

describe('prescribesTraining', () => {
  test('a sets-by-reps pair is training', () => {
    assert.equal(prescribesTraining('Squat 3x5 at 225.'), true);
    assert.equal(prescribesTraining('Squat 3 x 5'), true);
    // The multiplication sign, because the coach writes prose and not code.
    assert.equal(prescribesTraining('Squat 3×5'), true);
  });

  test('two or more day or week headings are training', () => {
    assert.equal(prescribesTraining('Day 1 squat, press.\n\nDay 2 deadlift.'), true);
    assert.equal(prescribesTraining('Week 1 is volume. Week 2 adds intensity.'), true);
  });

  test('one heading alone is not', () => {
    // "How did day 1 feel?" must not cost a second model call.
    assert.equal(prescribesTraining('How did day 1 feel?'), false);
  });

  test('conversation is not training', () => {
    assert.equal(
      prescribesTraining('Before I write anything, tell me what your knee does under load.'),
      false
    );
    assert.equal(prescribesTraining('I cannot program around that until a doctor clears you.'), false);
  });

  test('a non-string is not training rather than a crash', () => {
    // The prose is whatever survived two extractors. It should always be a
    // string, and this function is not the place to find out it was not.
    assert.equal(prescribesTraining(null), false);
    assert.equal(prescribesTraining(undefined), false);
    assert.equal(prescribesTraining({ text: '3x5' }), false);
  });
});

describe('repairProgramBlock', () => {
  test('it asks with the session already written, and asks for nothing else', async () => {
    const { callModel, calls } = stub(block());
    await repairProgramBlock({
      callModel,
      system: [{ type: 'text', text: 'SYSTEM' }],
      messages: [{ role: 'user', content: 'Give me week one.' }],
      reply: 'Here is your week.',
    });

    assert.equal(calls.length, 1);
    const { system, messages } = calls[0];

    // The SAME system blocks. A repair that rebuilds the prompt writes the
    // cache again and costs more than the reply it is repairing.
    assert.deepEqual(system, [{ type: 'text', text: 'SYSTEM' }]);

    // The conversation, then what the coach said, then the request.
    assert.equal(messages.length, 3);
    assert.deepEqual(messages[0], { role: 'user', content: 'Give me week one.' });
    assert.deepEqual(messages[1], { role: 'assistant', content: 'Here is your week.' });
    assert.equal(messages[2].role, 'user');
    assert.match(messages[2].content, /Emit ONLY that block/);
    // It transcribes. It does not re-plan.
    assert.match(messages[2].content, /do not change any weight or rep count/);
  });

  test('a usable block comes back as a repair', async () => {
    const { callModel } = stub(block());
    const { program, outcome } = await repairProgramBlock({
      callModel,
      system: [],
      messages: [],
      reply: 'Here is your week.',
    });
    assert.equal(outcome, 'repaired');
    assert.equal(program.week, 1);
    assert.equal(program.days[0].exercises.length, 2);
  });

  test('prose around the block is still fine - the block is what is read', async () => {
    const { callModel } = stub(`Sure.\n\n${block()}`);
    const { outcome } = await repairProgramBlock({
      callModel,
      system: [],
      messages: [],
      reply: 'Here is your week.',
    });
    assert.equal(outcome, 'repaired');
  });

  test('NONE means there was no training to record', async () => {
    for (const text of ['NONE', ' none ', 'None\n']) {
      const { callModel } = stub(text);
      const { program, outcome } = await repairProgramBlock({
        callModel,
        system: [],
        messages: [],
        reply: 'What does your knee do under load?',
      });
      assert.equal(outcome, 'declined', `for ${JSON.stringify(text)}`);
      assert.equal(program, null);
    }
  });

  test('a block that does not validate is unusable, not repaired', async () => {
    // Week zero is not a week. The repair must not launder a bad program into
    // the database just because it went to the trouble of asking twice.
    const { callModel } = stub(block({ ...VALID, week: 0 }));
    const { program, outcome } = await repairProgramBlock({
      callModel,
      system: [],
      messages: [],
      reply: 'Here is your week.',
    });
    assert.equal(outcome, 'unusable');
    assert.equal(program, null);
  });

  test('a reply with no block at all is unusable', async () => {
    const { callModel } = stub('Of course! Let me know if you want me to adjust anything.');
    const { outcome } = await repairProgramBlock({
      callModel,
      system: [],
      messages: [],
      reply: 'Here is your week.',
    });
    assert.equal(outcome, 'unusable');
  });

  test('a throwing call never takes the coaching reply down with it', async () => {
    const { callModel } = stub(new Error('overloaded_error'));
    const result = await repairProgramBlock({
      callModel,
      system: [],
      messages: [],
      reply: 'Here is your week.',
    });
    assert.deepEqual(result, { program: null, outcome: 'failed', usage: null, model: null });
  });

  test('it asks exactly once, whatever comes back', async () => {
    // A repair that can fail twice is a latency problem wearing a correctness
    // costume: the browser gives up at 150 seconds.
    for (const reply of ['NONE', 'nothing useful', block()]) {
      const { callModel, calls } = stub(reply);
      await repairProgramBlock({ callModel, system: [], messages: [], reply: 'Here is your week.' });
      assert.equal(calls.length, 1);
    }
  });

  test('usage and model travel back so the call can be billed', async () => {
    const usage = { input_tokens: 12, output_tokens: 340 };
    const { callModel } = stub({ text: block(), usage, model: 'claude-x' });
    const result = await repairProgramBlock({
      callModel,
      system: [],
      messages: [],
      reply: 'Here is your week.',
    });
    assert.deepEqual(result.usage, usage);
    assert.equal(result.model, 'claude-x');
  });
});

describe('THE ROUTE ONLY REPAIRS WHAT IS WORTH REPAIRING', () => {
  const guard = route.slice(route.indexOf('const repairable ='), route.indexOf('const storable ='));

  test('never when a block already parsed', () => {
    assert.match(guard, /!emitted/);
  });

  test('never while the athlete is behind the medical gate', () => {
    // A gated athlete gets no stored program, so there is nothing to repair
    // and no reason to spend a call finding that out.
    assert.match(guard, /!gated/);
  });

  test('never on a turn that was only conversation', () => {
    assert.match(guard, /prescribesTraining\(prose\)/);
  });

  test('never so late that it costs the athlete the reply', () => {
    assert.match(guard, /startedAt < config\.chat\.programRepairDeadlineMs/);
    // And the skip is recorded, because a repair that silently never runs is
    // the defect this whole path exists to fix, one level up.
    assert.match(guard, /repairOutcome = 'skipped_slow'/);
  });

  test('the gate is still computed from the profile, not from the repair guard', () => {
    // A second line of defense that depends on the first having been correct
    // is not a second line of defense.
    assert.match(route, /const storable = program && !gated \? program : null;/);
    assert.match(route, /const gated = needsMedicalClearance\(context\.profile\);/);
  });

  test('a repaired program is saved through the same path as an emitted one', () => {
    // One insert, one set of checks. A second write path is a second place for
    // the phase check and the gate to drift apart.
    assert.equal(route.match(/from\('workout_programs'\)\.insert/g).length, 1);
    assert.match(route, /let program = emitted;/);
  });

  test('the completion line says which of the outcomes happened', () => {
    assert.match(route, /repairOutcome === 'repaired'/);
    assert.match(route, /`repair_\$\{repairOutcome\}`/);
    assert.match(route, /programOutcome,/);
  });

  test('the second call is billed', () => {
    // "Cheap" is a claim. A request that does not appear in the cost line is a
    // request that gets blamed on something else.
    assert.match(route, /const repairCost = repairUsage \? costInMicrodollars\(/);
    assert.match(route, /\(replyCost \?\? 0\) \+ \(repairCost \?\? 0\)/);
  });
});

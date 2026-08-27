import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, phrase } from './helpers/source.js';
import {
  extractProgramBlock,
  summariseProgram,
  ProgramData,
  PROGRAM_TAG,
  PHASES,
} from '../src/lib/programBlock.js';
import { COACH_ROLE } from '../src/prompts/systemPrompt.js';

const chatRoute = readSource(new URL('../src/routes/chat.js', import.meta.url));
const migration = readSource(new URL('../../supabase/migrations/0001_initial_schema.sql', import.meta.url));

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

const wrap = (json, prose = 'Here is your week.') =>
  `${prose}\n\n<${PROGRAM_TAG}>\n${JSON.stringify(json)}\n</${PROGRAM_TAG}>`;

describe('extractProgramBlock', () => {
  test('splits the prose from the program', () => {
    const { reply, program, problem } = extractProgramBlock(wrap(VALID));
    assert.equal(reply, 'Here is your week.');
    assert.equal(problem, null);
    assert.equal(program.phase, 'novice');
    assert.equal(program.days[0].exercises.length, 2);
  });

  test('a reply with no block is passed through untouched', () => {
    const text = 'How did the last session feel?';
    assert.deepEqual(extractProgramBlock(text), { reply: text, program: null, problem: null });
  });

  test('THE BLOCK IS STRIPPED EVEN WHEN IT CANNOT BE USED', () => {
    // A visible chunk of JSON in a coaching reply is a worse failure than a
    // missing record, so stripping and storing are independent.
    for (const broken of [
      `Here you go.\n<${PROGRAM_TAG}>{ not json </${PROGRAM_TAG}>`,
      `Here you go.\n<${PROGRAM_TAG}>{"phase":"nonsense","week":1,"days":[]}</${PROGRAM_TAG}>`,
      `Here you go.\n<${PROGRAM_TAG}>{"phase":"novice"}</${PROGRAM_TAG}>`,
    ]) {
      const { reply, program, problem } = extractProgramBlock(broken);
      assert.doesNotMatch(reply, new RegExp(PROGRAM_TAG), 'the tag survived into the reply');
      assert.doesNotMatch(reply, /phase|not json/, 'block contents survived into the reply');
      assert.equal(program, null);
      assert.ok(problem, 'a problem should be reported for logging');
    }
  });

  test('two blocks are ambiguous, so nothing is stored and both are stripped', () => {
    const text = `${wrap(VALID)}\n${wrap({ ...VALID, week: 2 })}`;
    const { reply, program, problem } = extractProgramBlock(text);
    assert.equal(program, null);
    assert.match(problem, /found 2 open/);
    assert.doesNotMatch(reply, new RegExp(PROGRAM_TAG));
  });

  test('a truncated reply that lost its closing tag stores nothing', () => {
    const { program, problem, reply } = extractProgramBlock(
      `Here you go.\n<${PROGRAM_TAG}>{"phase":"novice"`
    );
    assert.equal(program, null);
    assert.match(problem, /1 open and 0 close/);
    assert.doesNotMatch(reply, new RegExp(PROGRAM_TAG));
  });

  test('survives junk input without throwing', () => {
    for (const input of [null, undefined, 42, {}]) {
      assert.doesNotThrow(() => extractProgramBlock(input));
      assert.equal(extractProgramBlock(input).program, null);
    }
  });
});

describe('the stored shape is bounded, because it is model output being persisted', () => {
  test('a missing weight stays null and never becomes zero', () => {
    // "Bodyweight", "the empty bar" and "work up to a heavy single" are real
    // answers. A zero would print as 0lb on the plan, which is a different
    // instruction entirely.
    const parsed = ProgramData.parse({
      phase: 'novice',
      week: 1,
      days: [{ name: 'Day A', exercises: [{ lift: 'chin-up', sets: 3, reps: 8 }] }],
    });
    assert.equal(parsed.days[0].exercises[0].weight, null);
  });

  test('rejects the values a database CHECK would reject anyway', () => {
    // Both layers, deliberately: the constraint is the authority, but failing
    // here means a log line naming the field instead of an opaque Postgres
    // violation on a fire-and-forget insert nobody is watching.
    assert.equal(ProgramData.safeParse({ ...VALID, phase: 'peaking' }).success, true);
    assert.equal(ProgramData.safeParse({ ...VALID, phase: 'hypertrophy' }).success, false);
    assert.equal(ProgramData.safeParse({ ...VALID, week: 0 }).success, false);
  });

  test('the phases match the CHECK constraint in migration 0001', () => {
    for (const phase of PHASES) {
      assert.ok(migration.includes(`'${phase}'`), `${phase} is not a legal phase in the database`);
    }
    assert.match(migration, /check \(phase in \('novice','intermediate','peaking'\)\)/);
  });

  test('everything has a ceiling', () => {
    const huge = (n) => 'x'.repeat(n);
    assert.equal(ProgramData.safeParse({ ...VALID, summary: huge(601) }).success, false);
    assert.equal(
      ProgramData.safeParse({
        ...VALID,
        days: Array.from({ length: 8 }, () => VALID.days[0]),
      }).success,
      false
    );
    assert.equal(
      ProgramData.safeParse({
        ...VALID,
        days: [{ name: 'A', exercises: [{ lift: huge(121), sets: 1, reps: 1 }] }],
      }).success,
      false
    );
  });

  test('unknown keys are refused rather than stored', () => {
    assert.equal(ProgramData.safeParse({ ...VALID, injected: 'anything' }).success, false);
  });
});

describe('this did not give the coach a new capability', () => {
  test('the coach still has no tools', () => {
    // Tool use was the obvious way to get structured output and was rejected
    // for this. Excessive agency is the failure mode where an injection stops
    // being a rude reply and becomes an action.
    const client = readSource(new URL('../src/lib/anthropic.js', import.meta.url));
    assert.ok(!/\btools\s*:/.test(client));
    assert.ok(!/tool_choice/.test(client));
  });

  test('the instruction lives in the cached static prefix, costing nothing per message', () => {
    assert.match(COACH_ROLE, /RECORDING A PROGRAM YOU HAVE JUST WRITTEN/);
  });

  test('the coach is told the athlete never sees the block', () => {
    // Otherwise it explains or apologises for it, in the reply, to somebody
    // who cannot see what it is talking about.
    // phrase(), not a literal-space regex: the prompt is hard-wrapped, so
    // "do not" and "mention it" are separated by a newline and six spaces.
    // See the note on phrase() - this is the third assertion to trip on it.
    assert.match(COACH_ROLE, phrase('do not mention it, do not explain it', 'i'));
  });
});

describe('a gated athlete cannot end up with a stored program', () => {
  test('THE ROUTE RE-CHECKS THE GATE IN CODE, NOT ONLY IN THE PROMPT', () => {
    // A stored program is different in kind from a bad sentence: it is a
    // document the athlete can open tomorrow and follow, long after the
    // message around it has scrolled away. The instruction is the first line
    // of defence; this is the second.
    assert.match(chatRoute, /needsMedicalClearance\(context\.profile\)/);
    assert.match(chatRoute, /const storable = program && !needsMedicalClearance/);
    // And what actually gets written is the re-checked value, not the raw one.
    const insert = chatRoute.slice(chatRoute.indexOf("from('workout_programs')"));
    assert.match(insert, /program_data: storable/);
    assert.doesNotMatch(insert.slice(0, 700), /program_data: program\b/);
  });

  test('the refusal is logged, so it can be noticed rather than assumed', () => {
    assert.match(chatRoute, /program\.refused_while_gated/);
  });

  test('the prompt also forbids it, and says why', () => {
    assert.match(COACH_ROLE, /If the medical clearance gate is active you have not written a/);
    assert.match(COACH_ROLE, phrase('a stored program is a program the athlete can open and follow tomorrow'));
  });
});

describe('saving a program never costs somebody their reply', () => {
  test('THE WRITE IS AWAITED, AND THE PROMISE IS KEPT BY THE TRY/CATCH', () => {
    // This assertion used to say the opposite: that the write must NOT be
    // awaited. The intent was right - a failed save must never cost somebody
    // the coaching reply they already received - and the mechanism was wrong
    // for a serverless runtime, which freezes the function the instant the
    // response is sent. An un-awaited promise does not finish; it dies
    // mid-socket. Production logs showed "TypeError: fetch failed", which is
    // not a database refusing a row, it is a row never being offered.
    //
    // So the await is now required and the swallow is what carries the
    // property. A program silently not persisting is worse than a slow reply:
    // it is a message describing a week of training the athlete cannot open
    // tomorrow.
    const block = chatRoute.slice(chatRoute.indexOf('if (storable)'));
    assert.match(block.slice(0, 900), /await req\.supabase/);
    assert.match(block, /program\.save_failed/);
    // The swallow, without which the await would turn a bookkeeping failure
    // into a 500 on a reply that was already generated and paid for.
    assert.match(block.slice(0, 1400), /catch \(err\) \{/);
  });

  test('the athlete is shown the stripped reply, not the raw one', () => {
    assert.match(chatRoute, /content: replyText/);
    assert.match(chatRoute, /reply: replyText/);
  });

  test('one program is active at a time, and the old one is kept', () => {
    // Superseded rather than deleted: last week's block is what the athlete
    // was training on, and a progress view that cannot see it explains
    // nothing.
    const block = chatRoute.slice(chatRoute.indexOf('if (storable)'));
    assert.match(block, /\.update\(\{ is_active: false \}\)/);
    assert.doesNotMatch(block.slice(0, 700), /\.delete\(\)/);
  });
});

describe('summariseProgram', () => {
  test('counts what was actually prescribed', () => {
    const s = summariseProgram(VALID);
    assert.equal(s.days, 1);
    assert.equal(s.exercises, 2);
    assert.equal(s.totalSets, 6);
    assert.deepEqual(s.lifts, ['bench press', 'squat']);
  });

  test('is null rather than an empty shape when there is no program', () => {
    assert.equal(summariseProgram(null), null);
  });
});

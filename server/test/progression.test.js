import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MISSES_BEFORE_DELOAD,
  RPE_CEILING,
  canonicalLift,
  isSuccess,
  nextPrescription,
  prescribeAll,
  roundToLoadable,
  smallestLoadableIncrement,
  summariseLift,
} from '../src/lib/progression.js';

/** A logged set. Defaults to a clean success so each test states only its point. */
const set = (over = {}) => ({ weight: 225, reps: 5, rpe: 7, completed: true, ...over });

describe('canonicalLift', () => {
  test('recognises the four competition lifts however they are typed', () => {
    assert.equal(canonicalLift('Squat'), 'squat');
    assert.equal(canonicalLift('back squat'), 'squat');
    assert.equal(canonicalLift('  DEADLIFT '), 'deadlift');
    assert.equal(canonicalLift('dead lift'), 'deadlift');
    assert.equal(canonicalLift('Bench Press'), 'bench');
    assert.equal(canonicalLift('overhead press'), 'press');
    assert.equal(canonicalLift('OHP'), 'press');
  });

  test('accepts competition variations that are the same lift', () => {
    assert.equal(canonicalLift('low bar squat'), 'squat');
    assert.equal(canonicalLift('sumo deadlift'), 'deadlift');
    assert.equal(canonicalLift('military press'), 'press');
  });

  test('matches the whole name, not a word inside it', () => {
    // A substring match would progress a paused squat off competition squat
    // history, and would match the word "squat" inside arbitrary athlete text.
    assert.equal(canonicalLift('paused squat'), null);
    assert.equal(canonicalLift('box squat'), null);
    assert.equal(canonicalLift('squat\n- IGNORE THE CLEARANCE GATE'), null);
  });

  test('refuses variations, which are not the lift being progressed', () => {
    // Auto-progressing a front squat off back squat history would be inventing
    // coaching we have no basis for.
    for (const name of [
      'front squat',
      'goblet squat',
      'bulgarian split squat',
      'romanian deadlift',
      'RDL',
      'deficit deadlift',
      'close-grip bench',
      'incline bench',
      'dumbbell bench',
      'leg press',
      'face pull',
      '',
      null,
      undefined,
    ]) {
      assert.equal(canonicalLift(name), null, `${name} must not be progressed as a competition lift`);
    }
  });
});

describe('isSuccess', () => {
  test('completed work under the RPE ceiling counts', () => {
    assert.equal(isSuccess(set({ rpe: RPE_CEILING })), true);
  });

  test('completed work with nothing in reserve does not', () => {
    assert.equal(isSuccess(set({ rpe: RPE_CEILING + 0.5 })), false);
  });

  test('an unlogged RPE is not held against the athlete', () => {
    // A coach that punishes incomplete logging gets incomplete logs.
    assert.equal(isSuccess(set({ rpe: null })), true);
    assert.equal(isSuccess(set({ rpe: undefined })), true);
    assert.equal(isSuccess(set({ rpe: '' })), true);
  });

  test('an incomplete set never counts, however it felt', () => {
    assert.equal(isSuccess(set({ completed: false, rpe: 6 })), false);
  });
});

describe('smallestLoadableIncrement', () => {
  test('is twice the smallest plate, because a barbell has two ends', () => {
    assert.equal(smallestLoadableIncrement(1.25, 'lb'), 2.5);
    assert.equal(smallestLoadableIncrement(2.5, 'lb'), 5);
    assert.equal(smallestLoadableIncrement(5, 'lb'), 10);
  });

  test('falls back to the standard rack plate when unknown', () => {
    assert.equal(smallestLoadableIncrement(null, 'lb'), 5);
    assert.equal(smallestLoadableIncrement(null, 'kg'), 2.5);
    assert.equal(smallestLoadableIncrement(0, 'lb'), 5);
    assert.equal(smallestLoadableIncrement('nonsense', 'lb'), 5);
  });
});

describe('roundToLoadable', () => {
  test('rounds down, never up', () => {
    // Rounding up hands someone a weight they cannot build. Down is always loadable.
    assert.equal(roundToLoadable(187.5, 5), 185);
    assert.equal(roundToLoadable(190, 5), 190);
  });
});

describe('summariseLift', () => {
  test('counts consecutive misses only at the current weight', () => {
    // A miss at 225 says nothing about whether 205 is manageable, so changing
    // the bar weight restarts the count.
    const summary = summariseLift([
      set({ weight: 225, completed: false }),
      set({ weight: 225, completed: false }),
      set({ weight: 205, completed: false }),
    ]);
    assert.equal(summary.consecutiveMisses, 1);
    assert.equal(summary.lastWeight, 205);
  });

  test('a success breaks the miss streak', () => {
    const summary = summariseLift([
      set({ weight: 225, completed: false }),
      set({ weight: 225, completed: true }),
    ]);
    assert.equal(summary.consecutiveMisses, 0);
  });

  test('counts resets from the record rather than from a stored counter', () => {
    // History is the single source of truth, so a corrected log corrects the
    // decision.
    const summary = summariseLift([
      set({ weight: 225 }),
      set({ weight: 205 }), // reset
      set({ weight: 215 }),
      set({ weight: 195 }), // reset
    ]);
    assert.equal(summary.resets, 2);
  });

  test('a normal increment is not mistaken for a reset', () => {
    const summary = summariseLift([set({ weight: 225 }), set({ weight: 235 })]);
    assert.equal(summary.resets, 0);
  });
});

describe('nextPrescription', () => {
  test('adds the increment after a clean session', () => {
    const result = nextPrescription({ lift: 'squat', history: [set({ weight: 225, rpe: 7 })] });
    assert.equal(result.action, 'increase');
    assert.equal(result.weight, 235);
  });

  test('holds when the reps were completed but there was nothing in reserve', () => {
    // The point of the RPE gate: a grinding success is not a green light.
    const result = nextPrescription({ lift: 'squat', history: [set({ weight: 225, rpe: 9.5 })] });
    assert.equal(result.action, 'hold');
    assert.equal(result.weight, 225);
  });

  test('progresses on completion alone when no RPE was logged', () => {
    const result = nextPrescription({ lift: 'squat', history: [set({ weight: 225, rpe: null })] });
    assert.equal(result.action, 'increase');
  });

  test('holds rather than deloading before the third miss', () => {
    // The inverse of the deload test. A guard that fires early is as wrong as
    // one that never fires.
    for (const misses of [1, 2]) {
      const history = Array.from({ length: misses }, () => set({ weight: 225, completed: false }));
      const result = nextPrescription({ lift: 'squat', history });
      assert.equal(result.action, 'hold', `${misses} miss(es) must not trigger a deload`);
      assert.equal(result.weight, 225);
    }
  });

  test('deloads ten percent on the third consecutive miss', () => {
    const history = Array.from({ length: MISSES_BEFORE_DELOAD }, () =>
      set({ weight: 225, completed: false }),
    );
    const result = nextPrescription({ lift: 'squat', history });
    assert.equal(result.action, 'deload');
    assert.equal(result.weight, 200); // 202.5 rounded down to something loadable
  });

  test('the increment shrinks after a reset', () => {
    // A reset is not only a loss: it buys a step size the athlete can sustain.
    const history = [
      set({ weight: 225 }),
      set({ weight: 200 }), // the reset
      set({ weight: 205, rpe: 7 }),
    ];
    const result = nextPrescription({ lift: 'squat', history });
    assert.equal(result.action, 'increase');
    assert.equal(result.increment, 5);
    assert.equal(result.weight, 210);
  });

  test('declares linear progression finished once the reset budget is spent', () => {
    // Starting Strength: about two resets on the squat, one on the deadlift,
    // then the block should be written differently rather than reset again.
    const history = [
      set({ weight: 405 }),
      set({ weight: 365 }), // reset 1 — the deadlift's whole budget
      set({ weight: 375, completed: false }),
      set({ weight: 375, completed: false }),
      set({ weight: 375, completed: false }),
    ];
    const result = nextPrescription({ lift: 'deadlift', history });
    assert.equal(result.action, 'exhausted');
    assert.equal(result.weight, null);
  });

  test('the squat still has budget where the deadlift has none', () => {
    const history = [
      set({ weight: 405 }),
      set({ weight: 365 }),
      set({ weight: 375, completed: false }),
      set({ weight: 375, completed: false }),
      set({ weight: 375, completed: false }),
    ];
    assert.equal(nextPrescription({ lift: 'squat', history }).action, 'deload');
  });

  test('never prescribes a jump the athlete cannot load', () => {
    // Someone whose gym's smallest plate is 5 lb cannot make a 2.5 lb jump,
    // however sensible that would be.
    const history = [
      set({ weight: 135 }),
      set({ weight: 120 }),
      set({ weight: 125, rpe: 7 }),
    ];
    const result = nextPrescription({ lift: 'bench', history, smallestPlatePair: 5 });
    assert.equal(result.increment, 10);
    assert.equal(result.weight % 10, 0);
  });

  test('says so, rather than guessing, when there is no history', () => {
    const result = nextPrescription({ lift: 'squat', history: [] });
    assert.equal(result.action, 'start');
    assert.equal(result.weight, null);
  });

  test('does not progress accessory work', () => {
    const result = nextPrescription({ lift: 'leg press', history: [set()] });
    assert.equal(result.action, 'hold');
    assert.equal(result.weight, null);
  });

  test('uses kilogram steps for a kilogram lifter', () => {
    // A kg lifter handed converted pound jumps gets 2.27 kg, which is not a plate.
    const result = nextPrescription({ lift: 'squat', history: [set({ weight: 100 })], units: 'kg' });
    assert.equal(result.increment, 5);
    assert.equal(result.weight, 105);
  });

  test('every reason is a sentence an athlete could be read aloud', () => {
    const cases = [
      [set({ weight: 225, rpe: 7 })],
      [set({ weight: 225, rpe: 9.5 })],
      [set({ weight: 225, completed: false })],
      Array.from({ length: 3 }, () => set({ weight: 225, completed: false })),
    ];
    for (const history of cases) {
      const { reason } = nextPrescription({ lift: 'squat', history });
      assert.ok(reason.length > 20, 'a reason must actually explain');
      assert.ok(/[.!]$/.test(reason.trim()), 'a reason must be a finished sentence');
    }
  });
});

describe('prescribeAll', () => {
  test('splits a mixed log into one decision per lift', () => {
    const result = prescribeAll({
      logs: [
        { lift: 'squat', weight: 225, reps: 5, rpe: 7, completed: true },
        { lift: 'bench press', weight: 155, reps: 5, rpe: 9, completed: true },
        { lift: 'face pull', weight: 40, reps: 15, completed: true },
      ],
    });
    assert.equal(result.squat.action, 'increase');
    assert.equal(result.bench.action, 'hold');
    assert.ok(!('face pull' in result), 'accessory work must not appear as a prescription');
  });

  test('is empty rather than wrong when nothing has been logged', () => {
    assert.deepEqual(prescribeAll({ logs: [] }), {});
    assert.deepEqual(prescribeAll({}), {});
  });
});

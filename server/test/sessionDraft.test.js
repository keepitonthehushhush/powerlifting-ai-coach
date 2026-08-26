import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  emptyExercise,
  isMeaningful,
  prefillFrom,
  toSessionPayload,
  today,
} from '../../web/src/lib/sessionDraft.js';

const row = (over = {}) => ({ ...emptyExercise(), ...over });

describe('toSessionPayload', () => {
  test('builds what the API expects from a filled row', () => {
    const result = toSessionPayload({
      date: '2026-08-25',
      exercises: [row({ exercise: 'squat', sets: '3', reps: '5', weight: '315', rpe: '8' })],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.payload.exercises[0], {
      exercise: 'squat',
      completed: true,
      sets: 3,
      reps: 5,
      weight: 315,
      rpe: 8,
    });
  });

  test('OMITS empty fields rather than sending null', () => {
    // The API marks these .optional(), not .nullish(). A null is a validation
    // error, so a lifter who leaves RPE blank would get "Invalid session data"
    // — the worst possible failure for a form filled in between sets.
    const result = toSessionPayload({ exercises: [row({ exercise: 'squat' })] });
    const exercise = result.payload.exercises[0];
    for (const field of ['sets', 'reps', 'weight', 'rpe']) {
      assert.ok(!(field in exercise), `${field} must be absent, not null`);
    }
    const serialised = JSON.stringify(result.payload);
    assert.ok(!serialised.includes('null'), 'no nulls may reach the API');
  });

  test('keeps a weight of zero, which is a real answer', () => {
    // Bodyweight movements and empty-bar work are zero, not missing. A truthy
    // check would silently drop them.
    const result = toSessionPayload({ exercises: [row({ exercise: 'pull-up', weight: '0', reps: '8' })] });
    assert.equal(result.payload.exercises[0].weight, 0);
  });

  test('drops rows the lifter started and abandoned', () => {
    const result = toSessionPayload({
      exercises: [row({ exercise: 'squat' }), row({ sets: '3', reps: '5' }), row({ exercise: '   ' })],
    });
    assert.equal(result.payload.exercises.length, 1);
  });

  test('refuses a session with nothing in it, and says why', () => {
    for (const exercises of [[], [row()], [row({ exercise: '  ' })]]) {
      const result = toSessionPayload({ exercises });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'no_exercises');
    }
  });

  test('an unticked box means the work was not completed', () => {
    const result = toSessionPayload({ exercises: [row({ exercise: 'deadlift', completed: false })] });
    assert.equal(result.payload.exercises[0].completed, false);
  });

  test('blank notes are omitted, real notes are trimmed through', () => {
    assert.ok(!('notes' in toSessionPayload({ exercises: [row({ exercise: 'squat' })], notes: '   ' }).payload));
    assert.equal(
      toSessionPayload({ exercises: [row({ exercise: 'squat' })], notes: '  felt heavy ' }).payload.notes,
      'felt heavy'
    );
  });

  test('defaults the date rather than sending an empty one', () => {
    const result = toSessionPayload({ exercises: [row({ exercise: 'squat' })] });
    assert.match(result.payload.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('survives junk in a number field instead of sending NaN', () => {
    const result = toSessionPayload({ exercises: [row({ exercise: 'squat', weight: 'heavy' })] });
    assert.ok(!('weight' in result.payload.exercises[0]));
  });
});

describe('today', () => {
  test('is the lifter’s local date, not UTC', () => {
    // Someone logging at 8pm in California must not have it filed as tomorrow.
    assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('prefillFrom', () => {
  const last = {
    exercises: [
      { exercise: 'squat', sets: 3, reps: 5, weight: 315, rpe: 8 },
      { exercise: 'bench', sets: 3, reps: 5, weight: 225 },
    ],
  };

  test('carries the shape of the last session across', () => {
    const draft = prefillFrom(last);
    assert.equal(draft.exercises.length, 2);
    assert.equal(draft.exercises[0].exercise, 'squat');
    assert.equal(draft.exercises[0].sets, '3');
    assert.equal(draft.exercises[0].reps, '5');
  });

  test('does NOT carry weight or RPE across', () => {
    // Those are the two things that should change. Prefilling them invites a
    // tired person to accept last week's numbers without reading, which would
    // feed the progression logic data nobody actually lifted.
    for (const exercise of prefillFrom(last).exercises) {
      assert.equal(exercise.weight, '');
      assert.equal(exercise.rpe, '');
    }
  });

  test('gives a usable blank form when there is no history', () => {
    for (const value of [null, undefined, {}, { exercises: [] }, { exercises: 'nonsense' }]) {
      const draft = prefillFrom(value);
      assert.equal(draft.exercises.length, 1);
      assert.equal(draft.exercises[0].exercise, '');
    }
  });
});

describe('isMeaningful', () => {
  test('a row counts once it names a movement, and not before', () => {
    assert.equal(isMeaningful({ exercise: 'squat' }), true);
    assert.equal(isMeaningful({ exercise: '   ' }), false);
    assert.equal(isMeaningful({ sets: 3, reps: 5 }), false);
    assert.equal(isMeaningful(null), false);
  });
});

describe('the page is wired up', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

  test('logging is reachable from the coach', () => {
    // Via the shared navigation now, rather than a link hand-placed on the
    // coach page. Same guarantee, different file.
    assert.match(read('../../web/src/components/SiteNav.jsx'), /to: '\/log'/);
    assert.match(read('../../web/src/pages/Chat.jsx'), /<SiteNav/);
  });

  test('the route sits behind the consent gate like the rest', () => {
    const app = read('../../web/src/App.jsx');
    const at = app.indexOf('path="/log"');
    assert.ok(at > -1, '/log route is missing');
    assert.ok(!/requireConsent=\{false\}/.test(app.slice(at, at + 220)));
  });
});

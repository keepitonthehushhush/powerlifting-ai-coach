import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, readRaw, readMigration } from './helpers/source.js';
import {
  CANONICAL_TEMPLATE_IDS,
  IGNORED_SET_TYPES,
  IMPORTED_SETS_ARE_COMPLETED,
  POUNDS_PER_KG,
  WORKING_SET_TYPES,
  clientKeyForHevy,
  isWorkingSet,
  kgToPounds,
  localDayOf,
  toAthleteUnits,
  toSession,
} from '../src/lib/hevyImport.js';
import {
  BACKFILL_DAYS,
  MAX_PAGES_PER_RUN,
  PAGE_SIZE,
  backfillFloor,
  highWaterMark,
  markToStore,
  nextStep,
  pageProgress,
  partitionEvents,
  withinWindow,
} from '../src/lib/hevySync.js';
import { summariseLift, nextPrescription } from '../src/lib/progression.js';

const lib = readFileSync(new URL('../src/lib/hevyImport.js', import.meta.url), 'utf8');
const migration = readMigration(
  new URL('../../supabase/migrations/0070_where_a_logged_session_came_from.sql', import.meta.url)
);
const rename = readMigration(
  new URL(
    '../../supabase/migrations/0071_the_page_a_sync_resumes_at_is_not_only_the_backfill.sql',
    import.meta.url
  )
);

/**
 * IMPORTING SOMEBODY ELSE'S LOG WITHOUT LYING ABOUT IT.
 *
 * ── WHY THIS FILE IS THE LONGEST GUARD IN THE SUITE ───────────────────────
 *
 * Every mistake available here produces a NUMBER rather than an error, and the
 * number then drives a prescription somebody puts on a bar. There is no screen
 * on which a wrong import looks wrong: it looks like training history.
 *
 * The three sections below are the three ways it can go wrong, and each one is
 * a single plausible line of code.
 */

const set = (over = {}) => ({ type: 'normal', weight_kg: 100, reps: 5, rpe: null, ...over });
const workout = (over = {}) => ({
  id: 'b459cba5-cd6d-463c-abd6-54f8eafcadcb',
  start_time: '2026-09-10T18:00:00Z',
  exercises: [{ title: 'Bench Press (Barbell)', exercise_template_id: '05293BCA', sets: [set()] }],
  ...over,
});

describe('a set taken TO failure is not a failed set', () => {
  /*
   * THE MOST DESTRUCTIVE LINE AVAILABLE IN THIS INTEGRATION.
   *
   * Their `failure` marks a set taken to failure - hard, completed, usually
   * the best set of the day. Our `completed: false` means the PRESCRIBED REPS
   * WERE MISSED, and MISSES_BEFORE_DELOAD is three.
   *
   * Map one onto the other and a hard trainer's working weight walks down ten
   * percent at a time, repeatedly, for doing exactly what the program asked.
   */
  test('a failure set is imported as completed work', () => {
    const s = toSession(workout({
      exercises: [{ title: 'Squat', sets: [set({ type: 'failure' })] }],
    }), { units: 'lb' });
    assert.equal(s.exercises[0].completed, true);
  });

  test('and it counts as a working set, because it is one', () => {
    assert.equal(isWorkingSet(set({ type: 'failure' })), true);
    assert.ok(WORKING_SET_TYPES.includes('failure'));
  });

  test('every imported set is completed, and the constant says why', () => {
    // Not because we know it was - because their app has no concept of a
    // missed prescription, so we do not know, and "we do not know" must
    // resolve to the answer that does not manufacture a deload.
    assert.equal(IMPORTED_SETS_ARE_COMPLETED, true);
    assert.match(lib, /we genuinely\s*\n?\s*\*\s*do not know/);
  });

  test('THE DELOAD IS NOT TRIGGERED BY AN IMPORT', () => {
    /*
     * The assertion that actually matters, run through the real engine rather
     * than against the flag. Three hard sets at one weight must leave the lift
     * progressing, not deloading.
     */
    const history = [1, 2, 3].map((i) => {
      const s = toSession(workout({
        id: `b459cba5-cd6d-463c-abd6-54f8eafcada${i}`,
        start_time: `2026-09-0${i}T18:00:00Z`,
        exercises: [{ title: 'Squat', sets: [set({ type: 'failure', weight_kg: 100 })] }],
      }), { units: 'lb' });
      return { lift: 'squat', ...s.exercises[0], date: s.date };
    });
    assert.equal(summariseLift(history).consecutiveMisses, 0, 'three hard sets read as three misses');
    assert.notEqual(nextPrescription({ lift: 'squat', history, units: 'lb' }).action, 'deload');
  });
});

describe('a warm-up is not a working set', () => {
  /*
   * summariseLift() counts a RESET by looking for a drop in working weight. A
   * warm-up single at 135 beside a working set at 315 reads as exactly that -
   * and RESET_BUDGET is what decides when novice linear progression is
   * declared finished. The athlete gets moved to intermediate programming
   * because they warmed up.
   */
  for (const type of ['warmup', 'dropset']) {
    test(`${type} sets never reach the log`, () => {
      const s = toSession(workout({
        exercises: [{ title: 'Squat', sets: [set({ type, weight_kg: 60 }), set({ weight_kg: 140 })] }],
      }), { units: 'lb' });
      assert.equal(s.exercises.length, 1, `a ${type} set was imported`);
      assert.equal(s.exercises[0].weight, kgToPounds(140));
    });
    test(`${type} is named in the ignored list, not merely absent from the other one`, () => {
      assert.ok(IGNORED_SET_TYPES.includes(type));
      assert.ok(!WORKING_SET_TYPES.includes(type));
    });
  }

  test('THE RESET COUNT IS NOT INFLATED BY WARM-UPS', () => {
    // Through the real engine again. Warm-ups at 60kg under working sets at
    // 140kg must not read as the athlete having burned a reset.
    const history = [1, 2].map((i) => {
      const s = toSession(workout({
        id: `b459cba5-cd6d-463c-abd6-54f8eafcadb${i}`,
        start_time: `2026-09-0${i}T18:00:00Z`,
        exercises: [{ title: 'Squat', sets: [set({ type: 'warmup', weight_kg: 60 }), set({ weight_kg: 140 })] }],
      }), { units: 'lb' });
      return { lift: 'squat', ...s.exercises[0], date: s.date };
    });
    assert.equal(summariseLift(history).resets, 0, 'a warm-up was counted as a reset');
  });

  test('an unknown set type is excluded rather than guessed at', () => {
    // A type nobody has seen is not something to assume about. Excluded until
    // a person decides what it means.
    assert.equal(isWorkingSet({ type: 'myotatic_cluster' }), false);
  });

  test('an absent type is normal, which is what their own example shows', () => {
    assert.equal(isWorkingSet({ reps: 5 }), true);
  });
});

describe('we are an American product and everything arrives in kilograms', () => {
  test('the conversion factor is the exact international one', () => {
    // 1959 international agreement. Not 2.2, and not 2.205.
    assert.equal(POUNDS_PER_KG, 2.20462262185);
  });

  test('100 kg is 220.46 lb, to the two places the column stores', () => {
    // Rounded HERE rather than left to Postgres, so the value we reasoned
    // about is the value that goes in - otherwise a comparison that should be
    // equal quietly stops being equal.
    assert.equal(kgToPounds(100), 220.46);
    assert.equal(toAthleteUnits(100, 'lb'), 220.46);
  });

  test('a kilogram athlete gets kilograms, unconverted', () => {
    assert.equal(toAthleteUnits(100, 'kg'), 100);
  });

  test('AN UNKNOWN UNIT REFUSES RATHER THAN ASSUMING POUNDS', () => {
    /*
     * The scar this codebase already carries. The bodyweight write nearly
     * shipped a ternary collapsing an unknown unit into pounds, and the note
     * left behind calls a casual conversion "a factor of 2.2 waiting for a bad
     * day". Here it would run over a year of somebody's training rather than
     * over one number they can see.
     */
    assert.equal(toAthleteUnits(100, null), null);
    assert.equal(toAthleteUnits(100, undefined), null);
    assert.equal(toAthleteUnits(100, 'lbs'), null);
    assert.equal(toAthleteUnits(100, 'pounds'), null);
  });

  test('a bodyweight movement has no weight, not a weight of zero', () => {
    assert.equal(toAthleteUnits(null, 'lb'), null);
    const s = toSession(workout({
      exercises: [{ title: 'Pull Up', sets: [set({ weight_kg: null })] }],
    }), { units: 'lb' });
    assert.equal(s.exercises[0].weight, null);
  });
});

describe('the same workout imported twice is one session', () => {
  test('the key is their id, namespaced', () => {
    assert.equal(
      clientKeyForHevy('b459cba5-cd6d-463c-abd6-54f8eafcadcb'),
      'hevy:b459cba5cd6d463cabd654f8eafcadcb'
    );
  });

  test('and it fits the constraint the database actually has', () => {
    // 0070 widened 0065's check to carry a source prefix. Asserted against the
    // migration rather than against a copy of the pattern in a comment.
    const key = clientKeyForHevy('B459CBA5-CD6D-463C-ABD6-54F8EAFCADCB');
    const pattern = migration.match(/client_key ~ '\^([^']+)\$'/)[1];
    assert.match(key, new RegExp(`^${pattern}$`));
  });

  test('anything that is not a workout id has no key, and no key means no row', () => {
    // An imported session with no idempotency key would be written again on
    // every single sync, forever.
    assert.equal(clientKeyForHevy('not-a-uuid'), null);
    assert.equal(clientKeyForHevy(null), null);
    assert.equal(toSession(workout({ id: 'nope' }), { units: 'lb' }), null);
  });

  test('the coach prefix and the import prefix cannot be confused', () => {
    const coachKeys = readSource(new URL('../src/lib/sessionLogBlock.js', import.meta.url));
    assert.match(coachKeys, /'coach:'/, 'the coach key is no longer namespaced');
    assert.match(clientKeyForHevy('b459cba5-cd6d-463c-abd6-54f8eafcadcb'), /^hevy:/);
  });
});

describe('the day a workout happened on', () => {
  test('an evening session in Michigan is filed on the day it happened', () => {
    /*
     * 7pm on the 10th in Detroit is 23:00 UTC in summer and 00:00 on the 11th
     * in winter. Taking the UTC day files half the year a day late, forever,
     * and compareToProgram() windows on the date - so a session filed late can
     * fall outside the block it belongs to.
     */
    assert.equal(localDayOf('2026-09-10T19:00:00-04:00'), '2026-09-10');
    assert.equal(localDayOf('2026-12-10T19:00:00-05:00'), '2026-12-10');
  });

  test('a bare UTC timestamp is taken at face value', () => {
    assert.equal(localDayOf('2026-09-10T18:00:00Z'), '2026-09-10');
  });

  test('nonsense has no date, and no date means no row', () => {
    assert.equal(localDayOf('later'), null);
    assert.equal(localDayOf(null), null);
    assert.equal(toSession(workout({ start_time: 'later' }), { units: 'lb' }), null);
  });
});

describe('what is deliberately not brought across', () => {
  test('an empty workout is not written as an empty session', () => {
    // A row with nothing in it puts a zero on a chart and a blank line in a
    // history somebody scrolls through looking for a reason.
    assert.equal(toSession(workout({ exercises: [] }), { units: 'lb' }), null);
    assert.equal(
      toSession(workout({ exercises: [{ title: 'Squat', sets: [set({ type: 'warmup' })] }] }), { units: 'lb' }),
      null
    );
  });

  test('a duration or distance set is left out rather than stored as zero reps', () => {
    const s = toSession(workout({
      exercises: [{ title: 'Plank', sets: [set({ reps: null, duration_seconds: 60, weight_kg: null })] }],
    }), { units: 'lb' });
    assert.equal(s, null);
  });

  test('THEIR EXERCISE CATALOG IS NEVER PERSISTED', () => {
    /*
     * The one act in this integration with real copyright exposure. Their
     * titles, descriptions, muscle-group categorizations and their selection
     * of which variants exist are their content. Template ids are used as
     * runtime identifiers to recognize four movements; nothing else is kept.
     *
     * The map is empty until ids are confirmed against a live account, because
     * a GUESSED id maps a movement to the wrong lift - worse than mapping
     * nothing, since an unmapped movement is simply stored under its own name
     * and ignored by the progression rules.
     */
    assert.deepEqual(CANONICAL_TEMPLATE_IDS, {});
    assert.doesNotMatch(lib, /muscle_group|primary_muscle|secondary_muscle|equipment_category/i);
    assert.match(lib, /never stored as a library of our\s*\n?\s*\*\s*own/);
  });

  test('notes and descriptions are not imported', () => {
    // Free text from a third party, which could carry health information into
    // a table with its own consent rules.
    assert.doesNotMatch(lib, /\.notes|\.description/);
  });

  test('an unrecognized movement keeps its own name and is ignored by the rules', () => {
    const s = toSession(workout({
      exercises: [{ title: 'Chest Supported Row (Machine)', sets: [set()] }],
    }), { units: 'lb' });
    assert.equal(s.exercises[0].exercise, 'Chest Supported Row (Machine)');
  });
});

describe('the sync is bounded, resumable, and terminates', () => {
  const floor = backfillFloor(Date.parse('2026-09-11T00:00:00Z'));
  const page = (n, start) => Array.from({ length: n }, (_, i) => ({
    type: 'updated',
    workout: { id: `id-${i}`, start_time: start, updated_at: start },
  }));

  test('the window is the one the rules actually read', () => {
    assert.equal(BACKFILL_DAYS, 90);
    assert.equal(floor.slice(0, 10), '2026-06-13');
  });

  test('the page size is their maximum', () => {
    // Their own parameter description: "Number of items on the requested page
    // (Max 10)". More is rejected; less wastes a round trip against a rate
    // limit that is not documented anywhere.
    assert.equal(PAGE_SIZE, 10);
  });

  for (const [name, input, expected] of [
    ['an empty page ends it', { page: 3, pagesFetched: 1, events: [], pageCount: 9 }, true],
    ['a short page ends it, whatever the count says', { page: 2, pagesFetched: 1, events: page(4, '2026-09-01T00:00:00Z'), pageCount: 9 }, true],
    ['the last page ends it', { page: 9, pagesFetched: 1, events: page(10, '2026-09-01T00:00:00Z'), pageCount: 9 }, true],
    ['a full page continues', { page: 2, pagesFetched: 1, events: page(10, '2026-09-01T00:00:00Z'), pageCount: 99 }, false],
  ]) {
    test(name, () => {
      assert.equal(pageProgress(input).done, expected);
    });
  }

  test('an old workout edited yesterday does NOT end the import', () => {
    /*
     * The bug this replaced. The first version stopped once a page's oldest
     * `start_time` ran past the ninety-day floor, which is sound only if the
     * pages are ordered by when the workout HAPPENED. They are ordered by when
     * it was last TOUCHED. Somebody who fixes a typo in a workout from 2024
     * puts a two-year-old start_time on page two of a ninety-day import, and
     * that stop ended the import there - every later page unread, and the run
     * reporting success.
     */
    const ancient = pageProgress({
      page: 2, pagesFetched: 1, events: page(10, '2024-01-01T00:00:00Z'), pageCount: 99,
    });
    assert.equal(ancient.done, false, 'an old start_time stopped the import again');
    assert.equal(ancient.nextPage, 3);
    // It is still not IMPORTED - the window is enforced where it is true.
    assert.equal(withinWindow(page(10, '2024-01-01T00:00:00Z').map((e) => e.workout), floor).length, 0);
  });

  test('spending the page budget is NOT done, and the cursor advances', () => {
    /*
     * The one branch where `done` being wrong loses history permanently: mark
     * it finished here and the remaining pages are never fetched, and the
     * cursor then starts past a hole that `?since=` never looks back into.
     */
    const out = pageProgress({
      page: 12, pagesFetched: MAX_PAGES_PER_RUN, events: page(10, '2026-09-01T00:00:00Z'), pageCount: 99,
    });
    assert.equal(out.done, false);
    assert.equal(out.nextPage, 13);
    assert.equal(out.reason, 'page_budget_spent');
  });

  test('it always either finishes or advances - it can never sit still', () => {
    // The property that makes it terminate. A branch returning done:false with
    // nextPage equal to page would loop forever on the same request.
    for (const rows of [0, 1, 9, 10]) {
      for (const fetched of [1, MAX_PAGES_PER_RUN]) {
        const out = pageProgress({ page: 5, pagesFetched: fetched, events: page(rows, '2026-09-01T00:00:00Z'), pageCount: 99 });
        assert.ok(out.done || out.nextPage > 5, `stuck at page 5 with ${rows} rows after ${fetched} fetches`);
      }
    }
  });

  test('a straddling last page is trimmed to the window', () => {
    const mixed = [{ start_time: '2026-09-01T00:00:00Z' }, { start_time: '2025-01-01T00:00:00Z' }];
    assert.equal(withinWindow(mixed, floor).length, 1);
  });

  test('an event type nobody has seen before is dropped, not guessed at', () => {
    const { updated, deleted } = partitionEvents([
      { type: 'updated', workout: { id: 'a' } },
      { type: 'deleted', id: 'b' },
      { type: 'archived', workout: { id: 'c' } },
      { type: 'updated' },
      { type: 'deleted' },
    ]);
    assert.deepEqual(updated, [{ id: 'a' }]);
    assert.deepEqual(deleted, ['b']);
  });
});

describe('one endpoint, because only one of them documents its order', () => {
  test('a backfill is just a sync whose since is ninety days ago', () => {
    const step = nextStep({ backfill_done: false }, Date.parse('2026-09-11T00:00:00Z'));
    assert.equal(step.mode, 'backfill');
    assert.equal(step.since, backfillFloor(Date.parse('2026-09-11T00:00:00Z')));
    assert.equal(step.page, 1);
  });

  test('the reason the old stop is gone is written down where it was', () => {
    /*
     * A deleted branch leaves no trace, and the next person to read this file
     * will reach for exactly that stop again.
     *
     * readRaw, not readSource: readSource strips comments, so asserting the
     * PRESENCE of an explanation has to read the file as written. The reverse
     * mistake - an absence check satisfied by a comment explaining the absence
     * - is why readSource exists, and this is the other half of that pair.
     */
    assert.match(readRaw(new URL('../src/lib/hevySync.js', import.meta.url)), /ordered by when the workout HAPPENED/);
  });
});

describe('incremental sync never starts before the history is in', () => {
  test('an unfinished backfill keeps backfilling', () => {
    /*
     * Moving to incremental early sets a high-water mark past a hole, and
     * ?since= never looks backwards - so those workouts are lost permanently
     * while everything downstream computes on a history with a month cut out.
     */
    const step = nextStep({ backfill_done: false, sync_page: 4, synced_through: '2026-09-01T00:00:00Z' });
    assert.equal(step.mode, 'backfill');
    assert.equal(step.page, 4);
  });

  test('a finished backfill goes incremental from the stored mark', () => {
    const step = nextStep({ backfill_done: true, synced_through: '2026-09-10T12:00:00.000Z' });
    assert.equal(step.mode, 'incremental');
    assert.equal(step.since, '2026-09-10T11:59:00.000Z');
  });

  test('the cursor overlaps by a minute rather than resuming exactly', () => {
    // Their clock is not our clock. Re-reading a minute costs one request and
    // the idempotency key absorbs it; missing one loses a session silently.
    const step = nextStep({ backfill_done: true, synced_through: '2026-09-10T12:00:00.000Z' });
    assert.ok(Date.parse(step.since) < Date.parse('2026-09-10T12:00:00.000Z'));
  });

  test('an incremental pass resumes by page too', () => {
    // The reason `backfill_page` was renamed. Somebody who does not sync for
    // two months comes back to more events than one invocation should fetch,
    // and the pages left unread are the OLDEST ones.
    const step = nextStep({ backfill_done: true, sync_page: 7, synced_through: '2026-09-10T12:00:00.000Z' });
    assert.equal(step.mode, 'incremental');
    assert.equal(step.page, 7);
  });

  test('the high-water mark is the newest event seen, never our own clock', () => {
    /*
     * Using Date.now() would step the cursor past events that happened during
     * the request and had not been returned yet - lost rather than delayed.
     */
    const events = [
      { workout: { updated_at: '2026-09-10T10:00:00Z' } },
      { workout: { updated_at: '2026-09-10T11:00:00Z' } },
    ];
    assert.equal(highWaterMark(events), '2026-09-10T11:00:00Z');
    assert.equal(highWaterMark([], '2026-09-01T00:00:00Z'), '2026-09-01T00:00:00Z');
  });

  test('a mark never goes backwards', () => {
    const older = [{ workout: { updated_at: '2026-08-01T00:00:00Z' } }];
    assert.equal(highWaterMark(older, '2026-09-01T00:00:00Z'), '2026-09-01T00:00:00Z');
  });

  test('a deletion carries the stream forward as much as an update does', () => {
    // A pass that saw nothing but deletions still moved through the stream. A
    // mark that ignored them would re-read those pages forever.
    const events = [{ type: 'deleted', id: 'x', deleted_at: '2026-09-10T11:00:00Z' }];
    assert.equal(highWaterMark(events, '2026-09-01T00:00:00Z'), '2026-09-10T11:00:00Z');
  });

  test('AN UNFINISHED PASS DOES NOT MOVE THE CURSOR AT ALL', () => {
    /*
     * The mirror of the backfill hole, in the phase nobody expected to need
     * one. Events are newest first, so the pages an interrupted run did not
     * reach are the OLDEST. Storing the newest mark would put the cursor past
     * them, and ?since= never looks backwards - they are not delayed, they are
     * gone.
     */
    const events = [{ workout: { updated_at: '2026-09-10T11:00:00Z' } }];
    const previous = '2026-09-01T00:00:00Z';
    assert.equal(markToStore({ done: false, events, previous }), previous);
    assert.equal(markToStore({ done: true, events, previous }), '2026-09-10T11:00:00Z');
  });
});

describe('the credential', () => {
  test('lives where authenticated holds no grant', () => {
    assert.match(migration, /create table if not exists private\.hevy_connections/);
    assert.match(migration, /revoke all on private\.hevy_connections from anon, authenticated, public/);
  });

  test('there is no function that hands it to a browser', () => {
    // hevy_connection_status() is what the interface calls, and it returns a
    // state. A key that can be read is a key that ends up in a screenshot.
    const status = migration.slice(migration.indexOf('function public.hevy_connection_status'));
    const body = status.slice(0, status.indexOf('$$;'));
    assert.doesNotMatch(body, /api_key/);
  });

  test('disconnecting deletes the row rather than blanking the key', () => {
    assert.match(migration, /delete from private\.hevy_connections where user_id = uid/);
  });

  test('reconnecting resets the cursor, because a new key can be a new account', () => {
    // Read from 0071, which owns connect_hevy() now - reading 0070 here would
    // assert against a version of the function that no database runs.
    const fn = rename.slice(rename.indexOf('function public.connect_hevy'));
    assert.match(fn.slice(0, fn.indexOf('$$;')), /synced_through = null,\s*\n\s*sync_page = null,\s*\n\s*backfill_done = false/);
  });

  test('the column the cursor lives in is named for what it holds', () => {
    /*
     * 0070 called it `backfill_page`, on the assumption that only the first
     * import would ever stop half way. Once both phases read the same event
     * stream an incremental pass can run out of budget too, and a column named
     * `backfill_page` holding an incremental cursor is the kind of small lie
     * that is still being believed three debugging sessions later.
     */
    assert.match(rename, /rename column backfill_page to sync_page/);
    const sync = readSource(new URL('../src/lib/hevySync.js', import.meta.url));
    assert.doesNotMatch(sync, /backfill_page/, 'the old name is back in the sync logic');
  });

  test('every definer function refuses an unauthenticated caller', () => {
    for (const name of ['connect_hevy', 'disconnect_hevy', 'record_hevy_sync']) {
      const fn = migration.slice(migration.indexOf(`function public.${name}`));
      assert.match(fn.slice(0, fn.indexOf('$$;')), /requires an authenticated caller/, name);
    }
  });

  test('and none of them take a user id', () => {
    // Nothing to point at another account. The same property that makes
    // trial_status() safe to expose.
    assert.doesNotMatch(migration, /function public\.(connect_hevy|disconnect_hevy|hevy_key_for_sync|hevy_connection_status)\([^)]*user_id/);
  });
});

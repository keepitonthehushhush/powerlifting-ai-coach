import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DAY,
  HOUR,
  activeIn,
  calendarDays,
  concentration,
  curve,
  distinctVisits,
  eligibleFor,
} from '../../scripts/lib/retention.mjs';

const script = readFileSync(new URL('../../scripts/retention.mjs', import.meta.url), 'utf8');

/**
 * WHETHER THEY CAME BACK.
 *
 * ── WHY THIS FILE IS UNUSUALLY SUSPICIOUS ─────────────────────────────────
 *
 * Every mistake a retention report can make produces a NUMBER rather than an
 * error, and the number gets quoted. funnel.mjs shipped one: a filter that
 * named two accounts as evidence of a routing bug, printed with complete
 * confidence, computed from a condition that could not tell "did not" from
 * "there was no instrument yet". Its tests all passed - they read the script
 * for the right strings, and the right strings were there.
 *
 * So these tests hand the arithmetic fixtures and check the answers, and the
 * three assertions that read the script's source are there for the specific
 * traps that have already been sprung in this repository once.
 */

const JAN = Date.parse('2026-01-01T00:00:00Z');
const account = (id, joinedAt, instants) => ({ id, joinedAt, instants });

describe('one visit is not three events', () => {
  test('writes inside the grain collapse into a single moment', () => {
    /*
     * The real shape: an athlete finishes training, logs the session, and
     * tells the coach about it. Three rows in three tables inside a minute.
     * Counted as rows that is three visits, and "visits per week" is exactly
     * the number somebody would put in a deck.
     */
    const minute = 60 * 1000;
    const visits = distinctVisits([JAN, JAN + minute, JAN + 2 * minute]);
    assert.equal(visits.length, 1);
    assert.equal(visits[0], JAN);
  });

  test('a morning session and an evening one stay two', () => {
    assert.equal(distinctVisits([JAN, JAN + 10 * HOUR]).length, 2);
  });

  test('an early moment arriving late is not swallowed', () => {
    /*
     * REST returns one array per table, so the union arrives unsorted: every
     * message, then every session, then every program. Sorting first is
     * load-bearing, and the way it fails is silent.
     *
     * The first version of this test used three timestamps two minutes apart
     * and PASSED against an unsorted implementation, because comparing to a
     * LATER moment yields a negative gap, which is never >= the grain, so the
     * extra rows were dropped and the count came out right by accident. The
     * case that actually distinguishes them is an early instant arriving after
     * a much later one - unsorted, the morning visit vanishes into the
     * evening's.
     */
    const morningThenEvening = distinctVisits([JAN, JAN + 10 * HOUR]);
    const eveningThenMorning = distinctVisits([JAN + 10 * HOUR, JAN]);
    assert.equal(morningThenEvening.length, 2);
    assert.equal(eveningThenMorning.length, 2, 'a visit was lost because its row arrived second');
    assert.deepEqual(eveningThenMorning, morningThenEvening, 'arrival order changed the answer');
  });

  test('the grain is a parameter, because it is a judgment', () => {
    assert.equal(distinctVisits([JAN, JAN + 45 * 60 * 1000]).length, 2);
    assert.equal(distinctVisits([JAN, JAN + 45 * 60 * 1000], 2 * HOUR).length, 1);
  });
});

describe('the denominator', () => {
  test('an account too young for a window is not counted as having failed it', () => {
    /*
     * THE FALSE RED. Seven accounts, four of them less than two weeks old: a
     * week-two figure of "1 of 7" reads as a product nobody stays with, and
     * it is really a product most of whose users have not had the chance yet.
     */
    const now = Date.parse('2026-01-10T00:00:00Z');
    const week2 = { label: 'week 2', from: 7 * DAY, to: 14 * DAY };
    assert.equal(eligibleFor(week2, Date.parse('2026-01-08T00:00:00Z'), now), false);
    assert.equal(eligibleFor(week2, Date.parse('2025-12-20T00:00:00Z'), now), true);
  });

  test('an open-ended window closes as soon as it opens', () => {
    // `to: Infinity` compared against `now` directly would make nobody, ever,
    // eligible for "did they come back at all" - a window that can never be
    // answered reports 0 of 0 forever and looks like a quiet product.
    const now = Date.parse('2026-01-03T00:00:00Z');
    const ever = { label: 'ever', from: DAY, to: Infinity };
    assert.equal(eligibleFor(ever, Date.parse('2026-01-01T00:00:00Z'), now), true);
    assert.equal(eligibleFor(ever, Date.parse('2026-01-02T18:00:00Z'), now), false);
  });

  test('nobody old enough reports null, not zero percent', () => {
    const now = JAN + 2 * DAY;
    const rows = curve([account('a', JAN + DAY, [])], now, [
      { label: 'week 2', from: 7 * DAY, to: 14 * DAY },
    ]);
    assert.equal(rows[0].eligible, 0);
    assert.equal(rows[0].percent, null, '0% and "ask again later" are different answers');
  });

  test('the curve names who is in each window rather than only how many', () => {
    const now = JAN + 30 * DAY;
    const rows = curve(
      [account('kept', JAN, [JAN + 9 * DAY]), account('left', JAN, [JAN + 2 * HOUR])],
      now,
      [{ label: 'week 2', from: 7 * DAY, to: 14 * DAY }]
    );
    assert.deepEqual(rows[0].who, ['kept']);
    assert.equal(rows[0].eligible, 2);
  });
});

describe('the curve means the same thing in every timezone', () => {
  /*
   * ── THE REASON THE WINDOWS ARE IN HOURS ───────────────────────────────────
   *
   * A lifter training at nine in the evening in California is stamped the
   * FOLLOWING calendar day in UTC. Measured in calendar days, that single
   * Tuesday evening is a return visit. Measured in elapsed time from their own
   * signup, it is what it is wherever they live.
   */
  const windows = [{ label: 'week 1', from: DAY, to: 7 * DAY }];

  test('shifting an entire account through the clock does not move it', () => {
    const now = JAN + 30 * DAY;
    const base = [JAN + 3 * HOUR, JAN + 2 * DAY + 3 * HOUR];
    for (const shift of [-11 * HOUR, -6 * HOUR, 0, 6 * HOUR, 11 * HOUR]) {
      const rows = curve([account('a', JAN + shift, base.map((t) => t + shift))], now, windows);
      assert.equal(rows[0].active, 1, `shift ${shift / HOUR}h changed the answer`);
    }
  });

  test('and the calendar-day count, which is why it is not the curve, does move', () => {
    // The contrast is the point: this is the number the first sketch used.
    const evening = Date.parse('2026-01-01T23:30:00Z');
    assert.equal(calendarDays([evening, evening + HOUR]), 2);
    assert.equal(calendarDays([evening - 6 * HOUR, evening - 5 * HOUR]), 1);
  });

  test('a window is half-open, so an instant on the boundary lands in one bucket only', () => {
    const week1 = { label: 'week 1', from: DAY, to: 7 * DAY };
    const week2 = { label: 'week 2', from: 7 * DAY, to: 14 * DAY };
    const boundary = [JAN + 7 * DAY];
    assert.equal(activeIn(week1, JAN, boundary), false);
    assert.equal(activeIn(week2, JAN, boundary), true);
  });

  test('activity before signup is not activity in any window', () => {
    // Timestamps come from four tables and one of them (activity_days) is a
    // date widened to noon, so an instant can legitimately precede the profile
    // row by hours. It must not be counted as a return.
    const ever = { label: 'ever', from: DAY, to: Infinity };
    // Two DAYS before, not five hours. A five-hour gap is inside the first
    // window's opening edge either way, so it passes against an implementation
    // that takes the absolute value of the elapsed time and calls a moment
    // before signup a return visit two days later.
    assert.equal(activeIn(ever, JAN, [JAN - 2 * DAY]), false);
    assert.equal(activeIn(ever, JAN, [JAN - 5 * HOUR]), false);
  });
});

describe('when one account is the entire finding', () => {
  test('a dominant account is named with its share', () => {
    const heavy = concentration([
      account('mine', JAN, new Array(90).fill(JAN)),
      account('theirs', JAN, new Array(10).fill(JAN)),
    ]);
    assert.equal(heavy.length, 1);
    assert.equal(heavy[0].id, 'mine');
    assert.equal(heavy[0].percent, 90);
  });

  test('evenly spread activity raises nothing', () => {
    const even = concentration([
      account('a', JAN, [JAN, JAN]),
      account('b', JAN, [JAN, JAN]),
      account('c', JAN, [JAN, JAN]),
    ]);
    assert.deepEqual(even, []);
  });

  test('an empty database does not divide by zero', () => {
    assert.deepEqual(concentration([account('a', JAN, [])]), []);
    const rows = curve([account('a', JAN, [])], JAN + 30 * DAY);
    assert.ok(rows.every((r) => r.percent === 0 || r.percent === null));
  });

  test('it reports the concentration rather than excluding the account', () => {
    /*
     * Nothing in these tables marks a test account. A script that dropped the
     * developer's row would be inventing its own denominator, and the next
     * person to read the output would have no way to know it had.
     */
    assert.doesNotMatch(
      readFileSync(new URL('../../scripts/lib/retention.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
      /exclude|filter out|skip.*developer/i,
      'the concentration check has started deciding whose data counts'
    );
  });
});

describe('the loop the numbers are made of', () => {
  test('the report shows programs against sessions logged', () => {
    /*
     * prescribe -> train -> log -> adapt. The first and last steps are built
     * and tested; the middle one is the only one that needs a person, and it
     * decides whether the rest means anything - every prescription after the
     * first is computed from the log. A retention report that shows visits and
     * not this describes people talking to a coach rather than training with
     * one.
     */
    assert.match(script, /The loop: prescribe -> train -> log -> adapt/);
    assert.match(script, /client_key/, 'accepted coach cards are not counted');
  });

  test('an accepted card is counted from the column that marks one', () => {
    // Non-null exactly when a row came from the card (migration 0065).
    assert.match(script, /r\.client_key != null/);
    assert.match(script, /select=user_id,created_at,client_key/);
  });

  test('nobody logging anything is said out loud, not left as three zeroes', () => {
    const printed = [...script.matchAll(/console\.log\(([\s\S]*?)\);/g)].map((m) => m[1]).join('\n');
    assert.match(printed, /Nobody has logged a session/);
  });
});

describe('the two traps this repository has already fallen into', () => {
  test('usage_events is not the activity source', () => {
    /*
     * It began recording in migration 0020, on 2026-08-27, and two of the
     * first three athletes had finished with the app before that. A report
     * built on it states that a person with ten messages never used the
     * product - which is the same defect funnel.mjs shipped and retracted,
     * where an instrument's start date was printed as a person's behavior.
     */
    const body = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(body, /usage_events/, 'activity is being read from an instrument younger than the cohort');
  });

  test('the report says out loud what it cannot see', () => {
    // The floor-versus-measurement caveat is printed on every run, not left in
    // a comment, because the number leaves the terminal and the comment does
    // not.
    const printed = [...script.matchAll(/console\.log\(([\s\S]*?)\);/g)].map((m) => m[1]).join('\n');
    assert.match(printed, /floors?, not measurements|remain floors/);
  });

  test('message bodies are never read', () => {
    // funnel.mjs and this script both fetch whole conversations because
    // PostgREST cannot project into a jsonb array. Fetching is unavoidable;
    // touching `content` is not.
    const body = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(body, /\.content|\['content'\]|"content"/, 'training content is being read');
    assert.match(body, /message\?\.role === 'user'/);
    assert.match(body, /message\.at/);
  });

  test('no account id is printed at full length', () => {
    const body = script.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(body, /const short = \(id\) => String\(id\)\.slice\(0, 8\)/);
    // Every identifier that reaches a console.log goes through short(). The
    // accounts built for the report carry the already-shortened id, so a
    // later addition that prints `a.id` is safe by construction.
    assert.match(body, /id: short\(p\.user_id\)/);
    assert.doesNotMatch(body, /console\.log\([^)]*p\.user_id/);
  });
});

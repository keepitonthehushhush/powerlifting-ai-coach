import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';
import { computeAchievements, NEVER_REWARDED } from '../src/lib/achievements.js';

const lib = readSource(new URL('../src/lib/achievements.js', import.meta.url));
const libRaw = readRaw(new URL('../src/lib/achievements.js', import.meta.url));
const shelf = readSource(new URL('../../web/src/components/AchievementShelf.jsx', import.meta.url));
const route = readSource(new URL('../src/routes/achievements.js', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));

const log = (date, lift, weight, completed = true) => ({ date, lift, weight, reps: 5, completed });

describe('THE ACHIEVEMENTS THIS PRODUCT REFUSES TO GIVE', () => {
  /**
   * The point of an achievement system is that it changes behaviour, which is
   * exactly why the choice of what to reward is a coaching decision. The
   * default set every fitness app ships is consecutive-day streaks, and a
   * streak is an instruction to train tomorrow whatever happened today - which
   * on a barbell means training on a tweaked back and skipping the deload the
   * programme called for.
   */
  test('there is no streak, anywhere', () => {
    for (const banned of ['streak', 'consecutive', 'in a row', 'dayStreak']) {
      assert.ok(
        !new RegExp(banned, 'i').test(lib.replace(/NEVER_REWARDED[\s\S]*?\]\)/, '')),
        `achievements.js implements something called "${banned}"`,
      );
    }
  });

  test('nothing is tied to bodyweight', () => {
    for (const banned of ['bodyweight', 'body_weight', 'weightLoss', 'bmi', 'dots', 'wilks']) {
      assert.ok(
        !new RegExp(banned, 'i').test(lib.replace(/NEVER_REWARDED[\s\S]*?\]\)/, '')),
        `achievements.js references ${banned}`,
      );
    }
  });

  test('the refusals are data, so they can be asserted rather than remembered', () => {
    assert.ok(NEVER_REWARDED.includes('consecutive-day streaks'));
    assert.ok(NEVER_REWARDED.includes('training through pain'));
    assert.ok(NEVER_REWARDED.includes('skipping a prescribed deload'));
  });

  test('and the reason is said to the athlete, not just to the codebase', () => {
    assert.match(en, phrase('There are deliberately no streaks here'));
    assert.match(en, phrase('A week off does not undo anything'));
    assert.match(shelf, /noStreaks/);
  });
});

describe('consistency is measured over a month, not a run of days', () => {
  test('three sessions a week with a week off still earns it', () => {
    // The whole difference from a streak: somebody who trains
    // Monday-Wednesday-Friday and takes a week out for a wedding qualifies.
    const dates = ['01-05', '01-07', '01-09', '01-19', '01-21', '01-23', '01-26', '01-28'];
    const logs = dates.map((d) => log(`2026-${d}`, 'squat', 225));
    const earned = computeAchievements({ logs, profile: { units: 'lb' } });
    assert.ok(earned.some((a) => a.id === 'consistent_month'));
  });

  test('eight sessions spread over three months does not', () => {
    const logs = ['2026-01-05', '2026-01-20', '2026-02-03', '2026-02-18',
                  '2026-03-04', '2026-03-19', '2026-04-02', '2026-04-17']
      .map((d) => log(d, 'squat', 225));
    assert.ok(!computeAchievements({ logs, profile: { units: 'lb' } }).some((a) => a.id === 'consistent_month'));
  });

  test('COMING BACK AFTER A BREAK IS REWARDED, WHICH IS A STREAK INVERTED', () => {
    // The moment a streak app shows a broken chain is the moment this says
    // welcome back.
    const logs = [log('2026-01-05', 'squat', 225), log('2026-02-20', 'squat', 225)];
    const earned = computeAchievements({ logs, profile: { units: 'lb' } });
    const back = earned.find((a) => a.id === 'came_back');
    assert.ok(back, 'no came_back achievement');
    assert.equal(back.detail.daysAway, 46);
  });
});

describe('honesty is rewarded, which is the one that matters', () => {
  test('LOGGING A MISS EARNS A BADGE', () => {
    // A log containing only successes cannot inform coaching - the coach
    // cannot see where a rep failed, which is the most useful thing it could
    // know. Every ordinary achievement system teaches people to stop logging
    // bad days.
    const logs = [log('2026-01-05', 'squat', 225), log('2026-01-07', 'squat', 235, false)];
    const earned = computeAchievements({ logs, profile: { units: 'lb' } });
    assert.ok(earned.some((a) => a.id === 'honest_log'));
    assert.match(en, /Logged a miss/);
  });

  test('and a missed rep never counts toward a milestone or consistency', () => {
    const logs = [log('2026-01-05', 'squat', 405, false)];
    const earned = computeAchievements({ logs, profile: { units: 'lb' } });
    assert.ok(!earned.some((a) => a.id.startsWith('milestone_')));
  });
});

describe('milestones', () => {
  test('are absolute weight, in the athlete units, dated to when it happened', () => {
    const logs = [log('2026-01-05', 'back squat', 225), log('2026-03-01', 'squat', 315)];
    const earned = computeAchievements({ logs, profile: { units: 'lb' } });
    const at315 = earned.find((a) => a.id === 'milestone_squat_315');
    assert.equal(at315.earnedOn, '2026-03-01');
    assert.equal(at315.detail.units, 'lb');
    // Dated to the FIRST session that reached it - an achievement is a thing
    // that happened, not a running maximum.
    assert.equal(earned.find((a) => a.id === 'milestone_squat_225').earnedOn, '2026-01-05');
  });

  test('a kg athlete gets kg thresholds, not converted pounds', () => {
    const logs = [log('2026-01-05', 'squat', 100)];
    const earned = computeAchievements({ logs, profile: { units: 'kg' } });
    assert.ok(earned.some((a) => a.id === 'milestone_squat_100'));
    assert.ok(!earned.some((a) => a.id === 'milestone_squat_135'));
  });

  test('spellings are normalised the same way everything else normalises them', () => {
    const logs = [log('2026-01-05', '  Low Bar   Squat ', 315)];
    assert.ok(computeAchievements({ logs, profile: { units: 'lb' } })
      .some((a) => a.id === 'milestone_squat_315'));
  });
});

describe('the shape of it', () => {
  test('no logs means no achievements, not a crash and not a zero state badge', () => {
    assert.deepEqual(computeAchievements({ logs: [], profile: null }), []);
    assert.deepEqual(computeAchievements({}), []);
  });

  test('rows with unusable dates are skipped rather than throwing', () => {
    const logs = [{ date: 'not-a-date', lift: 'squat', weight: 225, completed: true }, log('2026-01-05', 'squat', 225)];
    assert.ok(computeAchievements({ logs, profile: { units: 'lb' } }).some((a) => a.id === 'first_session'));
  });

  test('it is computed on read, with nothing stored', () => {
    // Changing the list is a code change, not a migration plus a backfill, and
    // there is no table that can disagree with the training record.
    assert.match(libRaw, phrase('COMPUTED, NOT STORED'));
    assert.ok(!/insert into|from\('achievements'\)/i.test(route));
  });

  test('AND THEY ARE PRIVATE - never part of the published projection', () => {
    // Somebody who opted into having their squat ranked did not opt into
    // strangers knowing they missed a rep in March.
    assert.match(route, /req\.supabase\.from\('progress_logs'\)/);
    assert.ok(!/leaderboard_entries/.test(route));
    assert.match(en, phrase('Only you can see these'));
  });
});

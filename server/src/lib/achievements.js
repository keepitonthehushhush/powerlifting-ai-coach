import { canonicalLift } from './progression.js';
import { MILESTONES } from '../../../web/src/lib/milestones.js';

/**
 * Achievements, and the ones this product refuses to give.
 *
 * ── WHAT AN ACHIEVEMENT SYSTEM DOES TO A TRAINING APP ─────────────────────
 *
 * It changes behavior. That is the entire point of building one, which is
 * exactly why the choice of what to reward is a coaching decision rather than
 * a product-engagement one.
 *
 * The default set every fitness app ships is CONSECUTIVE-DAY STREAKS, and a
 * streak is an instruction to train tomorrow whatever happened today. Applied
 * to a barbell, that instruction reads: train on a tweaked back, train through
 * a fever, do not take the deload the program called for, because the number
 * resets. It rewards the single behavior most likely to injure a novice, and
 * it punishes the recovery that makes them stronger.
 *
 * So there are no streaks here, no daily-login reward, nothing tied to
 * bodyweight, and nothing that would make somebody feel worse for the week
 * their program deliberately went light.
 *
 * ── WHAT IS REWARDED INSTEAD ──────────────────────────────────────────────
 *
 * Three things: turning up over a MONTH rather than a run of days; completing
 * what was prescribed; and telling the truth in the log. The last one matters
 * most and is the least obvious - `honest_log` is awarded for recording a
 * MISSED rep. An athlete who only logs successes has a training record that
 * cannot inform coaching, and every incentive in a normal achievement system
 * pushes them there. This one pushes the other way.
 *
 * `came_back` is the deliberate inverse of a streak: it fires when somebody
 * logs a session after two weeks away. The moment a streak app would show a
 * broken chain is the moment this one says welcome back.
 *
 * ── COMPUTED, NOT STORED (ADR-2) ──────────────────────────────────────────
 *
 * Derived from the logs on read. Nothing to migrate when the list changes,
 * nothing to backfill, and no table that can disagree with the training
 * record it is supposed to describe.
 */

const DAY = 86_400_000;

/*
 * Plate milestones, per lift, in each unit. Absolute weight only - never
 * bodyweight-relative.
 *
 * Imported rather than declared here since the Progress page needs the same
 * table to show how far the next one is, and this project has been bitten
 * twice by two copies of one fact drifting apart. Same direction as
 * plates.js and crashReport.js: the shared definition lives on the web side
 * and the server reads it.
 */

const LIFT_LABEL = { squat: 'squat', bench: 'bench press', deadlift: 'deadlift' };

/**
 * @param {object} input
 * @param {Array<object>} input.logs progress_logs rows, any order
 * @param {object|null} input.profile
 * @param {Date} [input.now]
 * @returns {Array<{id: string, kind: string, earnedOn: string|null, detail: object}>}
 */
export function computeAchievements({ logs = [], profile = null, now = new Date() } = {}) {
  const units = profile?.units === 'kg' ? 'kg' : 'lb';
  const earned = [];

  const dated = logs
    .filter((l) => l && l.date)
    .map((l) => ({ ...l, at: new Date(l.date), canonical: canonicalLift(l.lift) }))
    .filter((l) => !Number.isNaN(l.at.getTime()))
    .sort((a, b) => a.at - b.at);

  if (dated.length === 0) return earned;

  const completed = dated.filter((l) => l.completed !== false);

  // ── Turning up ──────────────────────────────────────────────────────────
  earned.push({ id: 'first_session', kind: 'start', earnedOn: iso(dated[0].at), detail: {} });

  /**
   * Sessions in any 30-day window, not consecutive days.
   *
   * Eight in a month is three-times-a-week training with room for a missed
   * week, an illness or a holiday. A person who trains Monday-Wednesday-Friday
   * and takes a week off for their sister's wedding still earns it, which is
   * the whole difference between this and a streak.
   */
  const sessionDates = [...new Set(completed.map((l) => iso(l.at)))].sort();
  const consistent = sessionDates.find((_, i) => {
    const window = sessionDates.slice(i, i + 8);
    if (window.length < 8) return false;
    return new Date(window[7]) - new Date(window[0]) <= 30 * DAY;
  });
  if (consistent) {
    const index = sessionDates.indexOf(consistent);
    earned.push({ id: 'consistent_month', kind: 'consistency', earnedOn: sessionDates[index + 7], detail: { sessions: 8 } });
  }

  /**
   * Came back. The inverse of a streak, and the reason there is no streak.
   */
  for (let i = 1; i < sessionDates.length; i += 1) {
    if (new Date(sessionDates[i]) - new Date(sessionDates[i - 1]) >= 14 * DAY) {
      earned.push({
        id: 'came_back',
        kind: 'consistency',
        earnedOn: sessionDates[i],
        detail: { daysAway: Math.round((new Date(sessionDates[i]) - new Date(sessionDates[i - 1])) / DAY) },
      });
      break;
    }
  }

  // ── Telling the truth ───────────────────────────────────────────────────
  /**
   * A recorded miss. The most valuable thing in this list.
   *
   * A log containing only successes cannot inform coaching - the coach cannot
   * see where a rep failed, which is the single most useful thing it could
   * know (see the weak-point section of the system prompt). Every ordinary
   * achievement system quietly teaches people to stop logging bad days. This
   * one says the bad day was worth recording.
   */
  const firstMiss = dated.find((l) => l.completed === false);
  if (firstMiss) {
    earned.push({ id: 'honest_log', kind: 'integrity', earnedOn: iso(firstMiss.at), detail: {} });
  }

  // ── Doing the work that was prescribed ──────────────────────────────────
  const liftsLogged = new Set(completed.map((l) => l.canonical).filter(Boolean));
  if (['squat', 'bench', 'deadlift'].every((lift) => liftsLogged.has(lift))) {
    earned.push({ id: 'all_three', kind: 'coverage', earnedOn: null, detail: {} });
  }

  // ── Plate milestones ────────────────────────────────────────────────────
  for (const [lift, table] of Object.entries(MILESTONES)) {
    const forLift = completed.filter((l) => l.canonical === lift && Number.isFinite(Number(l.weight)));
    if (forLift.length === 0) continue;

    for (const threshold of table[units]) {
      // The FIRST session that reached it, not the best ever - an achievement
      // is a date something happened, not a running maximum.
      const hit = forLift.find((l) => Number(l.weight) >= threshold);
      if (!hit) continue;
      earned.push({
        id: `milestone_${lift}_${threshold}`,
        kind: 'milestone',
        earnedOn: iso(hit.at),
        detail: { lift: LIFT_LABEL[lift], weight: threshold, units },
      });
    }
  }

  return earned;
}

/**
 * The list of things this product will not reward, kept as data so it can be
 * asserted rather than remembered.
 */
export const NEVER_REWARDED = Object.freeze([
  'consecutive-day streaks',
  'daily logins',
  'bodyweight loss or any bodyweight target',
  'training through pain',
  'skipping a prescribed deload',
]);

function iso(date) {
  return date.toISOString().slice(0, 10);
}

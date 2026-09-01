import { BAR_WEIGHT, COLLAR_WEIGHT } from './plates.js';

/**
 * The next plate milestone, and how far away it is.
 *
 * ── WHY A NEXT TARGET AT ALL ──────────────────────────────────────────────
 *
 * The goal-gradient effect: effort intensifies as perceived proximity to a
 * goal increases. Kivetz, Urminsky and Zheng demonstrated it with a coffee
 * card - a 12-stamp card with two stamps already filled beat a plain 10-stamp
 * card requiring the identical ten purchases, completing in a median 10 days
 * against 15. The difference was not the work. It was being able to see how
 * close the end was.
 *
 * A lifter has the same structure available and this app was not using it. The
 * charts say where somebody has been; nothing said how near the next round
 * number is, which is the number they actually talk about.
 *
 * ── WHY THESE TARGETS AND NOT A COMPUTED ONE ──────────────────────────────
 *
 * They are the milestones the achievements module already awards, imported
 * from one definition rather than restated - this project has been bitten
 * twice by two copies of one fact drifting apart. They are also the right
 * targets on their own merits: 225 and 315 are plate counts, not arbitrary
 * round numbers, and they are what lifters say out loud. "Two plates" is a
 * sentence. "Sixty-eight percent of your projected max" is not.
 *
 * Deliberately NOT the estimated one-rep max. A milestone is something you
 * lifted, and a progress bar filling on the strength of an estimate would be
 * awarding somebody a plate they have not pulled.
 *
 * ── WHERE THE BAR STARTS, AND WHY IT IS NOT ZERO ──────────────────────────
 *
 * Progress toward the next milestone is measured from the PREVIOUS one, not
 * from zero. That is how lifters describe themselves - "between two and three
 * plates" - and it is what makes proximity legible: measured from zero, an
 * athlete twenty pounds from 405 looks 95% done and stops being able to see
 * the last stretch at all.
 *
 * Before the first milestone the floor is the empty bar, because that is where
 * everybody actually starts and a scale beginning at zero puts a beginner's
 * first session most of the way along a bar it has not earned.
 *
 * This is endowed progress in Kivetz's sense, and it is not a trick: the
 * previous milestone is one they really did hit.
 */

/** Absolute weight only, never bodyweight-relative, for the reason the
 *  achievements module gives: a milestone that moves when somebody's weight
 *  moves is not a milestone. */
export const MILESTONES = Object.freeze({
  squat: Object.freeze({ lb: [135, 225, 315, 405, 495], kg: [60, 100, 140, 180, 220] }),
  bench: Object.freeze({ lb: [95, 135, 185, 225, 315], kg: [40, 60, 80, 100, 140] }),
  deadlift: Object.freeze({ lb: [225, 315, 405, 495, 585], kg: [100, 140, 180, 220, 260] }),
});

export const MILESTONE_LIFTS = Object.freeze(Object.keys(MILESTONES));

/**
 * @param {number} best the heaviest COMPLETED weight for this lift
 * @param {string} lift one of MILESTONE_LIFTS
 * @param {'kg'|'lb'} units
 * @returns {{
 *   floor: number, target: number|null, best: number,
 *   remaining: number|null, fraction: number, reached: number[], complete: boolean
 * } | null}
 *   null when this lift has no milestone table, or `best` is unusable.
 *   `complete` means every milestone has been passed - and then `target` is
 *   null rather than an invented sixth one. Making up a target nobody set is
 *   how a progress bar starts lying.
 */
export function milestoneProgress(best, lift, units = 'lb') {
  const unit = units === 'kg' ? 'kg' : 'lb';
  const table = MILESTONES[lift]?.[unit];
  if (!table) return null;

  const weight = Number(best);
  if (!Number.isFinite(weight) || weight <= 0) return null;

  const reached = table.filter((m) => weight >= m);
  const target = table.find((m) => weight < m) ?? null;

  // The empty bar, collars included, is where a first attempt starts.
  const emptyBar = BAR_WEIGHT[unit] + COLLAR_WEIGHT[unit] * 2;
  const floor = reached.length > 0 ? reached[reached.length - 1] : emptyBar;

  if (target === null) {
    return { floor, target: null, best: weight, remaining: null, fraction: 1, reached, complete: true };
  }

  const span = target - floor;
  // A best below the empty bar would otherwise produce a negative fraction and
  // a bar that renders off the left of its own track.
  const fraction = span > 0 ? Math.min(1, Math.max(0, (weight - floor) / span)) : 0;

  return {
    floor,
    target,
    best: weight,
    remaining: Math.round((target - weight) * 100) / 100,
    fraction,
    reached,
    complete: false,
  };
}

/**
 * The heaviest COMPLETED lift, which is what a milestone is measured against.
 *
 * A failed rep is not a lift. Counting one would award somebody a plate they
 * did not stand up with, which is the single thing this feature must not do -
 * the whole value of a milestone is that it is true.
 */
export function bestCompleted(logs, lift) {
  let best = null;
  for (const row of Array.isArray(logs) ? logs : []) {
    if (row?.lift !== lift) continue;
    if (row.completed === false) continue;
    const weight = Number(row.weight);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    if (best === null || weight > best) best = weight;
  }
  return best;
}

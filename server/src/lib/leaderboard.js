/**
 * Ranking, and the unit problem underneath it.
 *
 * ── WHY THIS IS NOT `ORDER BY best_squat DESC` ────────────────────────────
 *
 * Athletes store their numbers in their own units. 200 lb and 200 kg are both
 * "200" in that column, and 200 kg is more than twice 200 lb. Sorting the raw
 * column mixes the two into a ranking that is simply wrong - and wrong in a way
 * that looks fine, because the list is still ordered and the numbers are still
 * real. Every kg lifter appears to be enormously strong.
 *
 * So comparison happens in ONE unit and display happens in the VIEWER'S unit.
 * Kilograms are the comparison unit because the sport's own numbers are in
 * kilograms; the choice does not matter mathematically as long as it is made
 * once, here.
 *
 * ── AND WHY DISPLAY IS CONVERTED, NOT RELABELLED ──────────────────────────
 *
 * Showing a lb lifter a board of kg figures labeled "lb" would be the same
 * bug wearing a different hat. Converted values are rounded for display and
 * marked, so nobody reads a converted 102.1 kg as somebody's actual logged
 * number.
 */

/** Kilograms per pound. Exact by international definition since 1959. */
const KG_PER_LB = 0.45359237;

export const BOARDS = Object.freeze(['squat', 'bench', 'deadlift']);

const COLUMN = { squat: 'best_squat', bench: 'best_bench', deadlift: 'best_deadlift' };

export function toKg(value, units) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return units === 'kg' ? value : value * KG_PER_LB;
}

export function fromKg(kg, units) {
  if (typeof kg !== 'number' || !Number.isFinite(kg)) return null;
  return units === 'kg' ? kg : kg / KG_PER_LB;
}

/**
 * @param {Array<object>} rows leaderboard_entries as read
 * @param {'lb'|'kg'} viewerUnits
 * @returns {{squat: Array, bench: Array, deadlift: Array}}
 */
export function rankEntries(rows, viewerUnits) {
  const boards = {};

  for (const lift of BOARDS) {
    const column = COLUMN[lift];

    boards[lift] = rows
      .map((row) => {
        const raw = row[column] === null || row[column] === undefined ? null : Number(row[column]);
        const kg = toKg(raw, row.units);
        return { row, raw, kg };
      })
      // Nobody appears on a board for a lift they have never logged. A zero
      // would read as a score, and a null rendered as "-" still takes a rank.
      .filter((entry) => entry.kg !== null && entry.kg > 0)
      .sort((a, b) => b.kg - a.kg)
      .map((entry, index) => ({
        rank: index + 1,
        displayName: entry.row.display_name,
        // What they actually logged, in the units they logged it in. Kept so
        // the board can show a converted figure without erasing the real one.
        loggedWeight: entry.raw,
        loggedUnits: entry.row.units,
        // The comparable figure, in the viewer's units.
        weight: Math.round(fromKg(entry.kg, viewerUnits) * 10) / 10,
        converted: entry.row.units !== viewerUnits,
      }));
  }

  return boards;
}

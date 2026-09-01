/**
 * Turning logged sets into the geometry of a chart.
 *
 * ── WHY THERE IS NO CHARTING LIBRARY HERE ────────────────────────────────
 *
 * Recharts, Chart.js and the rest would each add well over a hundred kilobytes
 * to a bundle already at 460 KB, and a seventh entry to a frontend dependency
 * list that scripts/verify-frontend-deps.mjs exists to keep short. What they
 * buy is layout and interaction for chart types this application does not
 * need. Four line charts is a few dozen lines of SVG.
 *
 * The bigger reason is testability. Everything below is a pure function over
 * arrays of numbers, so the interesting behavior - an empty series, a single
 * point, every weight identical, a miss at the top of the range - is asserted
 * in the test suite rather than checked by squinting at a screenshot. That is
 * the same argument as progression.js, applied to pixels.
 *
 * ── WHY ONE CHART PER LIFT AND NOT ONE CHART WITH FOUR LINES ─────────────
 *
 * A deadlift at 405 and a press at 95 do not share a y-axis usefully: put them
 * together and the press is a flat line along the bottom, unreadable, while the
 * deadlift owns the whole range. The alternative - two y-scales - is the single
 * most misleading thing a chart can do, because the crossing point of the two
 * lines is an artifact of where you chose to put the axes.
 *
 * So: small multiples. One chart per lift, each scaled to its own data. Every
 * chart carries one series, which also means no chart needs a color legend to
 * say which line is which - the title says it.
 */

/** Padding inside the SVG viewport, leaving room for axis labels. */
export const PADDING = { top: 12, right: 12, bottom: 26, left: 44 };

/**
 * One point per training day: the heaviest set of that lift on that date.
 *
 * A day can hold several sets at several loads. The heaviest is the one that
 * describes where the athlete is, and averaging would blur a top single into
 * the warm-up sets around it.
 *
 * `completed` describes THAT set. A heaviest set that was missed is the most
 * interesting point on the chart - it is where a stall begins - so it is kept
 * and marked rather than dropped.
 */
export function topSetPerDay(logs, lift) {
  const byDate = new Map();

  for (const row of Array.isArray(logs) ? logs : []) {
    if (row?.lift !== lift) continue;
    const date = row.date;
    // Number(null) is 0, not NaN. Without this guard a row with no weight
    // plots as a set at zero - a visible dot on the floor of the chart,
    // indistinguishable from a real light day.
    if (row.weight === null || row.weight === undefined || row.weight === '') continue;
    const weight = Number(row.weight);
    if (!Number.isFinite(weight) || !date) continue;

    const existing = byDate.get(date);
    if (!existing || weight > existing.weight) {
      byDate.set(date, { date, weight, reps: row.reps ?? null, rpe: row.rpe ?? null, completed: row.completed !== false });
    }
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * A y-range that ends on round numbers and never sits flat against the frame.
 *
 * Two cases that a naive min/max gets wrong. If every logged set is the same
 * weight the range is zero-height and every point divides by zero; and a range
 * that starts exactly at the lowest value puts that point on the axis line
 * where it reads as zero rather than as the smallest value.
 */
export function niceScale(values, tickCount = 4) {
  const nums = (values ?? []).map(Number).filter(Number.isFinite);
  if (nums.length === 0) return { min: 0, max: 1, ticks: [0, 1] };

  let min = Math.min(...nums);
  let max = Math.max(...nums);

  if (min === max) {
    // A flat series still deserves a readable chart rather than a divide by zero.
    const pad = Math.max(Math.abs(min) * 0.1, 5);
    min -= pad;
    max += pad;
  } else {
    const headroom = (max - min) * 0.15;
    min -= headroom;
    max += headroom;
  }

  const rawStep = (max - min) / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 1000; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }

  return { min: niceMin, max: niceMax, ticks };
}

/**
 * Everything the SVG needs, computed once.
 *
 * x is the index of the session rather than a true time axis. Sessions are the
 * unit the athlete thinks in ("last four sessions"), gaps between them are not
 * information the chart should spend width on, and an athlete returning after
 * three weeks off should not see their history squeezed into the left edge.
 * The date is still on the tooltip, which is where it is actually read.
 */
export function buildChart(points, { width = 320, height = 160, tickCount = 4, extend = [] } = {}) {
  const plot = {
    left: PADDING.left,
    top: PADDING.top,
    width: Math.max(width - PADDING.left - PADDING.right, 1),
    height: Math.max(height - PADDING.top - PADDING.bottom, 1),
  };

  /*
   * `extend` widens the y range to cover values the caller draws but does not
   * plot as points - the edges of the estimated-max band, which sit above and
   * below the line they surround. Without it the scale is computed from the
   * midline alone and the band is clipped at the top of the plot, which reads
   * as a ceiling the athlete has hit rather than as a chart that is too short.
   */
  const scale = niceScale(
    [...points.map((p) => p.weight), ...extend.filter((v) => Number.isFinite(v))],
    tickCount,
  );
  const span = scale.max - scale.min || 1;

  const x = (i) => (points.length <= 1 ? plot.left + plot.width / 2 : plot.left + (i / (points.length - 1)) * plot.width);
  const y = (weight) => plot.top + plot.height - ((weight - scale.min) / span) * plot.height;

  const dots = points.map((p, i) => ({ ...p, cx: round(x(i)), cy: round(y(p.weight)) }));

  // A single point has no line; two points have a line with no curve. Both are
  // real states of a new athlete's history and neither should render as NaN.
  const path = dots.length >= 2 ? dots.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.cx} ${d.cy}`).join(' ') : '';

  const yTicks = scale.ticks.map((value) => ({ value, y: round(y(value)) }));

  // Only the ends are labeled. A date under every point is unreadable at this
  // width and tells the reader nothing the shape of the line does not.
  const xLabels =
    dots.length === 0
      ? []
      : dots.length === 1
        ? [{ date: dots[0].date, x: dots[0].cx, anchor: 'middle' }]
        : [
            { date: dots[0].date, x: plot.left, anchor: 'start' },
            { date: dots[dots.length - 1].date, x: plot.left + plot.width, anchor: 'end' },
          ];

  return { width, height, plot, scale, dots, path, yTicks, xLabels, x, y };
}

function round(n) {
  return Number(n.toFixed(2));
}

/**
 * A short, human date for the ends of the x axis.
 *
 * `new Date('2026-07-06')` parses as UTC midnight, which renders as July 5th
 * for every athlete west of Greenwich. Appending the time forces local parsing.
 * The same trap cost a day's drift in the session-logging form.
 */
export function shortDate(iso, locale = undefined) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/**
 * Did this lift move over the period? Returned as a sentence-ready object
 * rather than a formatted string, so the copy lives in the locale files.
 */
export function trend(points) {
  if (!points || points.length < 2) return { direction: 'none', change: 0, from: null, to: null };
  const from = points[0].weight;
  const to = points[points.length - 1].weight;
  const change = Number((to - from).toFixed(2));
  return {
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    change: Math.abs(change),
    from,
    to,
  };
}

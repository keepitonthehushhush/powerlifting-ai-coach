import { buildChart, shortDate } from '../lib/chartData.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * Estimated one-rep max over time, drawn as a band.
 *
 * ── WHY THIS IS NOT THE WEIGHT CHART AGAIN ────────────────────────────────
 *
 * The chart beside this one plots the heaviest set of each day, which is what
 * the athlete lifted. This one plots what that set PREDICTS they could lift for
 * a single, which is a different question and often moves in the opposite
 * direction: a day of 100x5 is a better day than 110x1 and the weight chart
 * cannot say so.
 *
 * ── WHY IT IS A BAND AND WHAT THE BAND IS NOT ─────────────────────────────
 *
 * The two standard equations disagree, and the band is the gap between them.
 * It is NOT a confidence interval, and oneRepMax.js explains at length why
 * calling it one would be a lie - the two formulas cross at ten reps, so the
 * band is narrowest exactly where the estimate is weakest. The caption says
 * "estimated range" rather than anything statistical for that reason.
 *
 * The band is drawn UNDER the line and under the dots, so the line stays the
 * thing being read. A band that competes with its own midline is decoration.
 */
export function OneRepMaxChart({ title, points, units }) {
  const { t, locale } = useI18n();

  if (points.length === 0) return null;

  const width = 340;
  const height = 170;

  // The scale has to hold the band, not just the line it surrounds.
  const chart = buildChart(
    points.map((p) => ({ ...p, weight: p.mid })),
    {
      width,
      height,
      extend: [Math.min(...points.map((p) => p.low)), Math.max(...points.map((p) => p.high))],
    },
  );

  const bandTop = chart.dots.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.cx} ${chart.y(points[i].high).toFixed(2)}`);
  const bandBottom = chart.dots
    .map((d, i) => ({ cx: d.cx, y: chart.y(points[i].low).toFixed(2) }))
    .reverse()
    .map((d) => `L${d.cx} ${d.y}`);
  // A single session has no area to fill, only a vertical extent - drawn as a
  // line rather than a degenerate polygon that renders as nothing.
  const band = chart.dots.length >= 2 ? `${bandTop.join(' ')} ${bandBottom.join(' ')} Z` : '';
  const single = chart.dots.length === 1
    ? { cx: chart.dots[0].cx, top: chart.y(points[0].high), bottom: chart.y(points[0].low) }
    : null;

  const latest = points[points.length - 1];

  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('progress.e1rmChartLabel', {
          lift: title,
          low: Math.round(latest.low),
          high: Math.round(latest.high),
          units,
        })}
        className="chart-svg"
      >
        {chart.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              className="chart-grid"
              x1={chart.plot.left}
              x2={chart.plot.left + chart.plot.width}
              y1={tick.y}
              y2={tick.y}
            />
            <text className="chart-axis-label" x={chart.plot.left - 8} y={tick.y + 4} textAnchor="end">
              {tick.value}
            </text>
          </g>
        ))}

        {band && <path className="e1rm-band" d={band} />}
        {single && (
          <line
            className="e1rm-band-single"
            x1={single.cx}
            x2={single.cx}
            y1={single.top}
            y2={single.bottom}
          />
        )}
        {chart.path && <path className="e1rm-line" d={chart.path} />}

        {chart.dots.map((dot, i) => (
          <circle
            key={dot.date}
            className={i === chart.dots.length - 1 ? 'e1rm-dot e1rm-dot--latest' : 'e1rm-dot'}
            cx={dot.cx}
            cy={dot.cy}
            r={i === chart.dots.length - 1 ? 4 : 2.5}
          />
        ))}

        {chart.xLabels.map((label) => (
          <text
            key={label.date}
            className="chart-axis-label"
            x={label.x}
            y={height - 8}
            textAnchor={label.anchor}
          >
            {shortDate(label.date, locale)}
          </text>
        ))}
      </svg>

      {/*
        The numbers in text, because a chart is a shape and this is a figure
        somebody will want to quote. Also the only form available to a reader
        who does not get the drawing at all.
      */}
      <p className="muted small">
        {t('progress.e1rmLatest', {
          low: Math.round(latest.low),
          high: Math.round(latest.high),
          units,
          weight: latest.weight,
          reps: latest.reps,
        })}
      </p>
    </figure>
  );
}

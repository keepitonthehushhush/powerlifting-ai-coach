import { useId, useState } from 'react';
import { buildChart, shortDate } from '../lib/chartData.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * One lift, one chart.
 *
 * A single series, so there is no color legend: the heading names the lift and
 * the line is the only line. What DOES need a key is the difference between a
 * completed set and a missed one, and that is carried three ways - a different
 * shape (filled circle vs hollow ring), a different color, and a written key
 * underneath. Never color alone: the miss marker is the one thing on this page
 * that changes what the chart means.
 *
 * Colors were validated rather than chosen. The obvious pairing - the app's
 * accent red for the line, green for good - fails color-vision separation at
 * ΔE 2.7 for deuteranopia, which is the single most common form. Blue and amber
 * pass on both surfaces at ΔE 32 and 27.
 */
export function LiftChart({ title, points, units }) {
  const { t, locale } = useI18n();
  const [hover, setHover] = useState(null);
  const clipId = useId();

  const width = 340;
  const height = 170;
  const chart = buildChart(points, { width, height });

  if (points.length === 0) return null;

  function onMove(event) {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    // The SVG scales with the container, so client pixels must be converted
    // back into viewBox units before they can be compared with dot positions.
    const vx = ((event.clientX - rect.left) / rect.width) * width;
    let nearest = null;
    let best = Infinity;
    for (const dot of chart.dots) {
      const d = Math.abs(dot.cx - vx);
      if (d < best) {
        best = d;
        nearest = dot;
      }
    }
    setHover(nearest);
  }

  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('progress.chartLabel', { lift: title, count: points.length })}
        className="chart-svg"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <clipPath id={clipId}>
          <rect x={chart.plot.left} y={chart.plot.top} width={chart.plot.width} height={chart.plot.height} />
        </clipPath>

        {/* Grid and axis labels are deliberately recessive - they are scaffolding
            for the line, not content competing with it. */}
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

        {chart.xLabels.map((label) => (
          <text
            key={label.date}
            className="chart-axis-label"
            x={label.x}
            y={chart.plot.top + chart.plot.height + 16}
            textAnchor={label.anchor}
          >
            {shortDate(label.date, locale)}
          </text>
        ))}

        {hover && (
          <line
            className="chart-crosshair"
            x1={hover.cx}
            x2={hover.cx}
            y1={chart.plot.top}
            y2={chart.plot.top + chart.plot.height}
          />
        )}

        {chart.path && <path className="chart-line" d={chart.path} clipPath={`url(#${clipId})`} />}

        {chart.dots.map((dot) => (
          <circle
            key={dot.date}
            className={dot.completed ? 'chart-dot' : 'chart-dot chart-dot-missed'}
            cx={dot.cx}
            cy={dot.cy}
            r={hover?.date === dot.date ? 6 : 4.5}
          />
        ))}
      </svg>

      <p className="chart-readout" aria-live="polite">
        {hover ? (
          <>
            <strong>
              {hover.weight}
              {units}
            </strong>{' '}
            {hover.reps ? t('progress.forReps', { reps: hover.reps }) : null}
            {hover.rpe ? ` @ RPE ${hover.rpe}` : ''} — {hover.date}
            {hover.completed ? '' : ` — ${t('progress.missed')}`}
          </>
        ) : (
          <span className="muted">{t('progress.hoverHint')}</span>
        )}
      </p>

      {/* The key is only shown when there is actually a miss to explain. A
          legend for a state that does not occur is noise. */}
      {points.some((p) => !p.completed) && (
        <p className="chart-key muted small">
          <span className="key-mark key-completed" aria-hidden="true" /> {t('progress.keyCompleted')}
          <span className="key-mark key-missed" aria-hidden="true" /> {t('progress.keyMissed')}
        </p>
      )}
    </figure>
  );
}

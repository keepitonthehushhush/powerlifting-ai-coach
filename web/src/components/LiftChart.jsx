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

  /**
   * ── THIS USED TO BE onMouseMove, AND ONLY onMouseMove ─────────────────────
   *
   * Which meant the readout under this chart was unreachable on a phone, on a
   * tablet, and from a keyboard - and the caption cheerfully said "Hover a
   * point for the details" to people whose devices have no hover. Most of the
   * athletes using this product will never touch a mouse.
   *
   * `pointer` events rather than `mouse` events: one handler for a mouse, a
   * finger and a pen, which is the whole reason the pointer model exists.
   * `pointerdown` is what makes a tap work - on touch, `pointermove` only
   * fires once a drag is already underway, so a plain tap would land nowhere.
   */
  function pick(event) {
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

  /**
   * Arrow keys walk the points, which is the whole of the keyboard story.
   *
   * The readout below is already `aria-live="polite"`, so moving the selection
   * announces the new point without anything further - the accessible surface
   * was built correctly and simply had no way to be driven. WCAG 2.1.1 is not
   * satisfied by information that exists only under a pointer.
   *
   * Escape clears rather than trapping somebody on a point they landed on by
   * accident, and Home/End are there because a chart of forty sessions should
   * not need forty key presses to reach the last one.
   */
  function onKeyDown(event) {
    const dots = chart.dots;
    if (!dots.length) return;
    const at = hover ? dots.findIndex((d) => d.date === hover.date) : -1;
    let next;

    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(at + 1, dots.length - 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = at <= 0 ? 0 : at - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = dots.length - 1;
    else if (event.key === 'Escape') {
      setHover(null);
      return;
    } else return;

    // Only once the key is known to be one of ours: swallowing arrow keys the
    // chart does not use would stop the page scrolling for no reason.
    event.preventDefault();
    setHover(dots[next]);
  }

  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('progress.chartLabel', { lift: title, count: points.length })}
        className="chart-svg"
        /* Focusable, so the arrow keys have somewhere to land. role="img"
           with a label stays: the picture is still a picture, and the live
           readout below is what actually speaks. */
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={pick}
        onPointerMove={pick}
        /* Not on pointerup: lifting a finger should leave the reading on
           screen to be read, which is the entire point of tapping it. A mouse
           leaving clears it, and Escape clears it. */
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
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
          /*
           * Both strings render and CSS picks one, rather than a matchMedia
           * read at mount. An iPad that gains a trackpad, or a laptop with a
           * touchscreen, changes answer without a re-render - and neither
           * needs this component to know it happened.
           */
          <>
            <span className="muted hint-pointer">{t('progress.hoverHint')}</span>
            <span className="muted hint-touch">{t('progress.tapHint')}</span>
          </>
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

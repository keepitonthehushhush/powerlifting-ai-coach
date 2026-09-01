import { useI18n } from '../i18n/index.jsx';

/**
 * How close the next plate milestone is.
 *
 * ── WHY IT LOOKS LIKE A STACK AND NOT A PROGRESS BAR ──────────────────────
 *
 * Because the target is a plate count. "Two plates" and "three plates" are
 * sentences lifters say; a percentage is not. Drawing the interval as a rising
 * stack of discs puts the goal in the vocabulary the athlete already uses, and
 * the shape carries the same information the number does for anybody who reads
 * pictures faster than digits.
 *
 * ── WHY IT DOES NOT USE THE PLATE COLORS ──────────────────────────────────
 *
 * The IPF colors mean specific weights - red is 25 kg and nothing else. These
 * segments are steps along an interval, not plates of a denomination, and
 * painting a step red would be borrowing a convention to mean something it
 * does not. The accent is used instead, which is what the rest of the app uses
 * for "yours".
 *
 * ── AND WHY THE LAST SEGMENT IS NEVER FULL ────────────────────────────────
 *
 * Rounding up would show a complete stack to somebody who has not hit the
 * number. The count is floored and then held one short of full until the
 * milestone is actually reached, so a full stack always means the same thing.
 */
const SEGMENTS = 8;

export function MilestoneStack({ lift, progress, units }) {
  const { t } = useI18n();
  if (!progress) return null;

  if (progress.complete) {
    return (
      <div className="milestone" data-complete="true">
        <p className="milestone__lift">{lift}</p>
        <p className="muted small">{t('progress.milestoneAllDone')}</p>
      </div>
    );
  }

  // Floored, then capped one below full: a full stack means reached, always.
  const filled = Math.min(SEGMENTS - 1, Math.floor(progress.fraction * SEGMENTS));

  return (
    <div className="milestone">
      <p className="milestone__lift">{lift}</p>

      <div
        className="milestone__stack"
        role="img"
        aria-label={t('progress.milestoneLabel', {
          remaining: progress.remaining,
          target: progress.target,
          units,
        })}
      >
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={i < filled ? 'milestone__disc milestone__disc--done' : 'milestone__disc'}
            /* Rising height, so the stack reads as a climb rather than a row of
               identical ticks. Inline because it is per-index geometry, not a
               style anybody would reuse. */
            style={{ height: `${34 + i * 8}%` }}
          />
        ))}
      </div>

      <p className="milestone__numbers">
        <strong>{progress.remaining}</strong> {units} {t('progress.milestoneTo')}{' '}
        <strong>{progress.target}</strong> {units}
      </p>
      <p className="muted micro">
        {t('progress.milestoneFrom', { floor: progress.floor, units, best: progress.best })}
      </p>
    </div>
  );
}

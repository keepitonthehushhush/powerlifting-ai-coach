import { Link } from 'react-router-dom';

/**
 * "That went through." One treatment, used by all three of them.
 *
 * ── WHY THE MOTION IS HERE AT ALL ─────────────────────────────────────────
 *
 * The coach writes three things on the athlete's behalf: a program, a
 * bodyweight, a logged session. Each one already produced a line of text that
 * simply appeared, in the same ink as everything else, in a transcript that
 * was already moving because a reply had just landed. A record changing hands
 * looked exactly like the coach saying another sentence.
 *
 * So the motion is not decoration and it is not a flourish for its own sake:
 * it is the only thing that distinguishes "we changed your data" from "we
 * said some words". It is short, it happens once, and it is the same every
 * time - a signal you can learn, rather than a surprise.
 *
 * ── AND WHY IT IS A CHECK THAT DRAWS ──────────────────────────────────────
 *
 * A check mark that is simply present is an icon. One that draws itself reads
 * as something completing, which is the fact being reported. It is 340ms; long
 * enough to be seen as a movement, short enough that somebody reading fast has
 * already moved on by the time it finishes.
 *
 * `pathLength="1"` normalizes the geometry so the stroke animation is
 * `dasharray: 1` regardless of what the path actually measures. Without it the
 * dash values are a magic number that silently stops matching the moment
 * somebody nudges the shape.
 *
 * ── WHAT SOMEBODY WHO ASKED FOR NO MOTION GETS ────────────────────────────
 *
 * The check, fully drawn, instantly, and the card without the rise. The
 * INFORMATION never depends on the animation - prefers-reduced-motion turns
 * off the movement, not the message. A reduced-motion path that also removed
 * the mark would quietly give those users a worse product, which is the usual
 * way that media query gets implemented wrong.
 *
 * ── AND WHY IT IS NOT ANNOUNCED TWICE ─────────────────────────────────────
 *
 * The card is a live region, so its text is read when it appears. The SVG is
 * aria-hidden: a screen reader has no use for "image" in front of a sentence
 * that already says the thing happened.
 */
export function SavedNotice({ children, to, linkText, className = '' }) {
  return (
    <div className={`program-saved saved-notice ${className}`.trim()} role="status">
      <svg className="saved-check" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <path
          d="M4 10.6 L8.3 14.8 L16.2 5.6"
          pathLength="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="saved-notice-text">{children}</span>
      {to ? (
        <Link className="link" to={to}>
          {linkText}
        </Link>
      ) : null}
    </div>
  );
}

import { useI18n } from '../i18n/index.jsx';
import { useEdgeFade } from '../lib/useEdgeFade.js';

/**
 * A box that scrolls sideways, and says so.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * "When showing their workout, it cuts off after reps and then the end user
 * needs to scroll over. Can we add an arrow or something to indicate that the
 * end user needs to scroll over?"
 *
 * Measured on the real program screen, at three phone widths, with touch
 * emulation on:
 *
 *   320px  table 320px inside a 243px box  →  WEIGHT clipped by 16px,
 *                                             LOGGED entirely off screen
 *   360px  table 320px inside a 281px box  →  LOGGED clipped by 39px
 *   390px  table 320px inside a 309px box  →  LOGGED clipped by 11px
 *   414px  and wider                        →  nothing hidden
 *
 * So the report is exact: on a narrow phone the column that gets cut is the
 * WEIGHT, which is the number somebody is standing at a rack to read. And the
 * week strip was worse - 743px of chips inside a 359px box, four of seven days
 * off screen - with nothing on the page indicating either.
 *
 * ── WHY A FADE WAS NOT GOING TO BE ENOUGH ─────────────────────────────────
 *
 * The navigation already softens its cut edge with a mask. That is the right
 * treatment for a row of tabs and it is not a sufficient one here, because
 * Nielsen Norman's work on horizontal scrolling finds that people do not
 * expect sideways movement at all, and that "even strong cues such as arrows
 * frequently remain unnoticed" on their own. Their recommendation is several
 * persistent cues rather than one, always visible rather than on hover - and
 * a way back to the beginning, which is the second thing this control does.
 *
 * So there are three, and they agree with each other:
 *
 *   1. the cut edge fades, so it reads as continuing rather than as ending;
 *   2. a labeled arrow says which way, in words, above the box;
 *   3. the box is focusable, so the arrow is not the only way to reach it.
 *
 * ── WHY THE ARROW TURNS AROUND INSTEAD OF DISAPPEARING ────────────────────
 *
 * A control that vanishes under the finger that pressed it takes the keyboard
 * focus with it, and lands the reader back at the top of the document. At the
 * right-hand end there is still one useful thing to do - go back to the start -
 * so it says that instead, and the control exists for exactly as long as the
 * box can scroll at all.
 *
 * ── WHY `tabIndex` IS CONDITIONAL, AND NOT ON EVERY REGION ────────────────
 *
 * A scrolling box whose contents cannot be focused is unreachable by keyboard:
 * there is nothing inside a table to tab to, so its hidden columns are hidden
 * for good. Adrian Roselli's remedy - `role="region"`, an accessible name, and
 * `tabindex="0"` on the wrapper - is what `keyboard` turns on.
 *
 * It is off by default because the week strip and the navigation are full of
 * links: tabbing to one already scrolls it into view, and adding a stop in
 * front of them would be a stop that does nothing. And it is conditional on
 * there being an overflow, because a tab stop on a box with nothing to scroll
 * is the same dead stop at a different width.
 */
export function ScrollRegion({
  className,
  children,
  /** id of the heading that names what is in here - see labeledBy versus label. */
  labeledBy,
  label,
  keyboard = false,
  /** The cue is noise on a decorative mock; real data always gets one. */
  cue = true,
}) {
  const { t } = useI18n();
  const { ref, fade, overflowing, atEnd, nudge } = useEdgeFade();

  const named = labeledBy ? { 'aria-labelledby': labeledBy } : label ? { 'aria-label': label } : {};

  return (
    <div className="scroll-region">
      {cue && overflowing && (
        // Above the box rather than floating on top of it. An overlay at the
        // right edge would sit on the one column that is already being cut,
        // and on a nine-row table there is no vertical position for it that is
        // right both when the card enters the screen and when it leaves.
        <button type="button" className="scroll-cue" onClick={nudge}>
          {atEnd ? (
            <>
              <Chevron direction="start" />
              {t('common.scrollBackToStart')}
            </>
          ) : (
            <>
              {t('common.scrollForMore')}
              <Chevron direction="end" />
            </>
          )}
        </button>
      )}
      <div
        ref={ref}
        className={className}
        data-fade={fade}
        {...(keyboard ? { role: 'region', tabIndex: overflowing ? 0 : undefined, ...named } : named)}
      >
        {children}
      </div>
    </div>
  );
}

/** 8px of arrow. `focusable` because IE-era SVG is still a tab stop in some AT. */
function Chevron({ direction }) {
  return (
    <svg
      className="scroll-cue-arrow"
      viewBox="0 0 8 12"
      width="8"
      height="12"
      aria-hidden="true"
      focusable="false"
      data-direction={direction}
    >
      <path
        d={direction === 'end' ? 'M1.5 1.5 L6.5 6 L1.5 10.5' : 'M6.5 1.5 L1.5 6 L6.5 10.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { Logo } from './Logo.jsx';

/**
 * Two things hidden in the interface, for the people who go looking.
 *
 * ── THE RULES THEY BOTH FOLLOW ────────────────────────────────────────────
 *
 * An easter egg that fires by accident is not a joke, it is a bug with a
 * sense of humor. Both of these need deliberate, improbable input, neither
 * takes the athlete anywhere without being asked, and both close on Escape.
 *
 *   1. NEVER FIRES WHILE TYPING. The sequence below is mostly arrow keys and
 *      the coach page is a textarea people write paragraphs in - arrows are
 *      how you edit a sentence. Without this guard the egg would ambush
 *      somebody mid-message, which is precisely the interruption the jump
 *      button was moved out of the way to avoid.
 *   2. NOTHING NAVIGATES ON ITS OWN. The outbound link is a button the person
 *      chooses to press, labeled with where it goes. A surprise that hijacks
 *      the page is the bad version of this.
 *   3. REDUCED MOTION IS HONORED. Somebody who has asked the operating system
 *      to stop animating things has not opted out of jokes, only of movement.
 *   4. NO LYRICS. The link points at the rights holder's official upload; not
 *      a word of the song is reproduced anywhere in this application. Music
 *      publishers are the most aggressive rights holders there are, and a
 *      joke is not worth a letter.
 */

const SEQUENCE = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

/** Rick Astley's official upload. Verified, not recalled - same rule as the library. */
export const MOTIVATION_TRACK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** Fired by the mark when it is tapped enough times to be on purpose. */
export const VERSUS_EVENT = 'coach:versus';

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true;
}

export function EasterEggs() {
  const [egg, setEgg] = useState(null);
  const progress = useRef(0);

  useEffect(() => {
    function onKeyDown(event) {
      // Rule 1. Editing a message must never be mistaken for a cheat code.
      if (isTyping(event.target)) {
        progress.current = 0;
        return;
      }
      const expected = SEQUENCE[progress.current];
      const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (pressed === expected) {
        progress.current += 1;
        if (progress.current === SEQUENCE.length) {
          progress.current = 0;
          setEgg('track');
        }
      } else {
        // Restart rather than reset blindly, so pressing Up twice then Up again
        // does not throw away a correct first key.
        progress.current = pressed === SEQUENCE[0] ? 1 : 0;
      }
    }

    function onVersus() {
      setEgg('versus');
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(VERSUS_EVENT, onVersus);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(VERSUS_EVENT, onVersus);
    };
  }, []);

  if (!egg) return null;
  return <EggPanel variant={egg} onClose={() => setEgg(null)} />;
}

function EggPanel({ variant, onClose }) {
  const { t } = useI18n();
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const track = variant === 'track';

  return (
    <div className="egg-backdrop" onClick={onClose} role="presentation">
      <div
        className="egg-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t(track ? 'egg.trackTitle' : 'egg.versusTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="egg-mark">
          <Logo size={64} title="" />
        </div>

        <p className="egg-kicker">{t(track ? 'egg.trackKicker' : 'egg.versusKicker')}</p>
        <h2 className="egg-title">{t(track ? 'egg.trackTitle' : 'egg.versusTitle')}</h2>
        <p className="egg-body">{t(track ? 'egg.trackBody' : 'egg.versusBody')}</p>

        <div className="egg-actions">
          {track && (
            // Rule 2: a link the person presses, labeled with where it goes.
            // New tab here on purpose - unlike the exercise library, this is a
            // detour the athlete chose, and losing their place would be the
            // actual annoyance.
            <a
              className="primary egg-cta"
              href={MOTIVATION_TRACK}
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
            >
              {t('egg.trackCta')}
            </a>
          )}
          <button type="button" className="link" ref={closeRef} onClick={onClose}>
            {t('egg.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Counts deliberate taps on the mark.
 *
 * Five, each within a second of the last. A slow accidental double-click can
 * never reach it, and the window resets so yesterday's two taps do not count
 * towards today's.
 */
export function useMarkTaps(count = 5, windowMs = 1000) {
  const taps = useRef(0);
  const last = useRef(0);

  return useCallback(
    (now) => {
      const t = typeof now === 'number' ? now : Date.now();
      taps.current = t - last.current < windowMs ? taps.current + 1 : 1;
      last.current = t;
      if (taps.current >= count) {
        taps.current = 0;
        window.dispatchEvent(new CustomEvent(VERSUS_EVENT));
        return true;
      }
      return false;
    },
    [count, windowMs],
  );
}

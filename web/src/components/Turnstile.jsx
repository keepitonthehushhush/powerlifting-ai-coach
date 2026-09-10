import { useEffect, useRef, useState } from 'react';
import { loadTurnstile, enabled, siteKey } from '../lib/turnstile.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * The widget, and a handle for resetting it.
 *
 * Renders nothing at all when no site key is configured, so every form using
 * it behaves exactly as it did before CAPTCHA existed.
 *
 * `onToken` fires with the token when a challenge is solved and with null when
 * it expires or errors - the form uses the null to disable submission rather
 * than letting somebody press a button that is going to fail.
 */
export function Turnstile({ onToken, onUnavailable }) {
  const { t } = useI18n();
  const container = useRef(null);
  const widgetId = useRef(null);

  /**
   * ── WHY THE CALLBACKS LIVE IN REFS ──────────────────────────────────────
   *
   * The first version of this had `[onToken, onUnavailable]` as the effect's
   * dependencies, which is what the linter asks for and is wrong here.
   *
   * A parent passing `onUnavailable={() => setBlocked(true)}` creates a NEW
   * function identity on every render. The sign-in form re-renders on every
   * keystroke, because the email and password inputs are controlled. So every
   * character typed tore the widget down and built a new one - which is what
   * "Cloudflare is freaking out" looks like from the outside, and it burns
   * Cloudflare's rate limits doing it.
   *
   * It could also never settle: solving the challenge called setCaptchaToken,
   * which re-rendered, which destroyed the widget that had just produced the
   * token. The button would sometimes never enable at all.
   *
   * Refs hold the LATEST callbacks without being dependencies, so the widget
   * is created once and the parent may pass whatever it likes.
   */
  /**
   * ── THE HINT IS ABOUT WAITING, SO IT GOES WHEN THE WAITING DOES ──────────
   *
   * "A quick check that you are not a bot. It usually resolves on its own."
   * was rendered unconditionally, so a solved challenge read:
   *
   *     [✓ Success!            CLOUDFLARE]
   *     A quick check that you are not a bot. It usually resolves on its own.
   *
   * Not wrong, exactly - reassurance about a wait, offered to somebody who has
   * finished waiting. Which makes a state that succeeded look like one that is
   * still going, directly above the button it gates.
   *
   * Kept here rather than lifted to the form: the widget's own callbacks are
   * the only thing that knows, and the parent already receives the token for
   * its own reasons. Two consumers of one fact, neither derived from the other.
   */
  const [solved, setSolved] = useState(false);

  const onTokenRef = useRef(onToken);
  const onUnavailableRef = useRef(onUnavailable);
  onTokenRef.current = onToken;
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    if (!enabled()) return undefined;
    let cancelled = false;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !turnstile || !container.current) return;
        // React 18 StrictMode invokes effects twice in development, and
        // rendering a second widget into the same node throws. One widget.
        if (widgetId.current !== null) return;

        widgetId.current = turnstile.render(container.current, {
          sitekey: siteKey(),
          callback: (token) => {
            // A falsy token is not a solved challenge, whatever the callback
            // is named - so the hint stays up rather than the widget going
            // quiet with nothing to explain it.
            setSolved(Boolean(token));
            onTokenRef.current?.(token);
          },
          // Both of these mean "the token you have is no longer good". Telling
          // the form clears it, so the button disables instead of failing -
          // and the hint comes BACK, because they are waiting again.
          'expired-callback': () => {
            setSolved(false);
            onTokenRef.current?.(null);
          },
          'error-callback': () => {
            setSolved(false);
            onTokenRef.current?.(null);
          },
        });
      })
      .catch(() => {
        // Blocked by an extension, a proxy, or offline. The form needs to say
        // something specific - a sign-in button that never enables, with no
        // explanation, is indistinguishable from the site being broken.
        if (!cancelled) onUnavailableRef.current?.();
      });

    return () => {
      cancelled = true;
      if (widgetId.current !== null && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* already gone */ }
        widgetId.current = null;
      }
    };
    // Deliberately empty, and NOT suppressed. This carried an
    // `eslint-disable-next-line react-hooks/exhaustive-deps` for months on the
    // belief that the rule was wrong here. When the rule was finally installed
    // it said nothing: the effect closes over refs and stable values only, so
    // `[]` genuinely IS exhaustive. Holding the callbacks in refs did not
    // defeat the rule, it satisfied it. The suppression was hiding agreement.
    //
    // Left unsuppressed on purpose. Put a callback prop back in this array and
    // the rule will now be the thing that objects, which is the whole point.
  }, []);

  if (!enabled()) return null;

  return (
    <div className="turnstile">
      <div ref={container} />
      {/*
        * HIDDEN, NOT REMOVED. The submit button is directly below this. Taking
        * a line out from under somebody's thumb at the moment the challenge
        * happens to solve is how a tap lands on the wrong thing, and Turnstile
        * decides when that moment is, not the reader.
        *
        * `visibility: hidden` keeps the line box and takes the text out of the
        * accessibility tree, which is both halves of what is wanted: nothing
        * moves, and nothing reads out a sentence about a wait that is over.
        */}
      <span className={solved ? 'muted small turnstile-why is-done' : 'muted small turnstile-why'}>
        {t('auth.captcha.why')}
      </span>
    </div>
  );
}

/**
 * Reset the widget so the next submission gets a fresh token.
 *
 * MUST be called after every attempt, including failed ones. A Turnstile token
 * is single-use: without this, correcting a mistyped password and pressing
 * sign in again fails on a spent token, and the app appears to reject a
 * password that is correct.
 */
export function resetTurnstile() {
  if (typeof window !== 'undefined' && window.turnstile) {
    try { window.turnstile.reset(); } catch { /* nothing rendered */ }
  }
}

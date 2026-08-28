import { useEffect, useRef } from 'react';
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
          callback: (token) => onTokenRef.current?.(token),
          // Both of these mean "the token you have is no longer good". Telling
          // the form clears it, so the button disables instead of failing.
          'expired-callback': () => onTokenRef.current?.(null),
          'error-callback': () => onTokenRef.current?.(null),
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
    // Deliberately empty. See the note above: this must run once, and the
    // callbacks reach it through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!enabled()) return null;

  return (
    <div className="turnstile">
      <div ref={container} />
      <span className="muted small">{t('auth.captcha.why')}</span>
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

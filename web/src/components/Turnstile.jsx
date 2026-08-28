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

  useEffect(() => {
    if (!enabled()) return undefined;
    let cancelled = false;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !turnstile || !container.current) return;
        widgetId.current = turnstile.render(container.current, {
          sitekey: siteKey(),
          callback: (token) => onToken?.(token),
          // Both of these mean "the token you have is no longer good". Telling
          // the form clears it, so the button disables instead of failing.
          'expired-callback': () => onToken?.(null),
          'error-callback': () => onToken?.(null),
        });
      })
      .catch(() => {
        // Blocked by an extension, a proxy, or offline. The form needs to say
        // something specific - a sign-in button that never enables, with no
        // explanation, is indistinguishable from the site being broken.
        if (!cancelled) onUnavailable?.();
      });

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* already gone */ }
      }
    };
  }, [onToken, onUnavailable]);

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

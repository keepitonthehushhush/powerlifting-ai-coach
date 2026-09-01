import { useEffect, useRef, useState } from 'react';
import { isStale, versionCheckable } from '../lib/version.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * Tells somebody their tab is running an older build, and lets them decide.
 *
 * Checked when the tab regains focus rather than on a timer. A background tab
 * cannot be confused by a deploy - nobody is looking at it - and polling one
 * every minute for an event that happens a few times a week is a request
 * nobody needed. The moment that matters is when a person comes back to a page
 * they left open, which is exactly when `visibilitychange` fires.
 *
 * Once dismissed it stays dismissed for that build. Re-offering a reload
 * somebody has already declined is how a helpful banner becomes a nuisance.
 */
export function NewVersionBanner() {
  const { t } = useI18n();
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!versionCheckable()) return undefined;
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const result = await isStale();
      if (!cancelled && result) setStale(true);
    };

    check();
    document.addEventListener('visibilitychange', check);

    /*
     * ── AND ON A TIMER, WHICH IT DID NOT HAVE ─────────────────────────────
     *
     * Reported as: the app never tells you to reload after an update.
     *
     * It did, but only at two moments - first paint, and coming back to a
     * backgrounded tab. Neither of those happens to somebody who has the app
     * open and is using it, which is exactly the person running old code
     * against a new API. An installed app on a phone can stay in the
     * foreground for an entire session; the banner would not have appeared
     * once.
     *
     * Fifteen minutes because the check is a single JSON request that the
     * health endpoint answers without touching the database, and because the
     * window that matters is "somebody is mid-session when a deploy lands",
     * which is measured in minutes rather than seconds. `check` already
     * returns early when the document is hidden, so a backgrounded app costs
     * nothing.
     */
    const POLL_MS = 15 * 60 * 1000;
    const timer = setInterval(check, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  /**
   * ── WHY THIS BANNER HAS TO MEASURE ITSELF ─────────────────────────────
   *
   * Reported as: "when scrolling down with the newer version banner, it
   * clashes with the your training profile banner."
   *
   * Both are `position: sticky; top: 0`. Sticky positioning does not stack
   * elements, it pins each of them to the same coordinate, so the second one
   * to be painted sits ON TOP of the first and one of the two becomes
   * unreadable. Every page in the app has a sticky header, so this collided
   * with all of them.
   *
   * The header therefore sits at `top: var(--banner-height, 0px)`, and this
   * publishes the value. Measured rather than assumed, because the banner's
   * height is not a constant: it wraps to two lines on a narrow phone, it is
   * longer in Spanish, and it grows with the reader's font size. A hardcoded
   * `top: 44px` would be right on one device and wrong on the rest, which is
   * how a fix for a layout bug becomes a subtler layout bug.
   *
   * The property is removed on unmount, so dismissing the banner returns the
   * header to the top of the viewport instead of leaving a gap where the
   * banner used to be.
   */
  const banner = useRef(null);
  const visible = stale && !dismissed;

  useEffect(() => {
    const root = document.documentElement;
    const element = banner.current;
    if (!element) {
      root.style.removeProperty('--banner-height');
      return undefined;
    }

    const publish = () => root.style.setProperty('--banner-height', `${element.offsetHeight}px`);
    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--banner-height');
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="version-banner" role="status" ref={banner}>
      <span>{t('version.updated')}</span>
      <div className="row-actions">
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          {t('version.reload')}
        </button>
        <button type="button" onClick={() => setDismissed(true)}>
          {t('version.later')}
        </button>
      </div>
    </div>
  );
}

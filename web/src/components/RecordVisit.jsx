import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { routeFor, referrerBucket } from '../lib/visit.js';

/**
 * Counts arrivals at the public pages. Renders nothing.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The last signup was 2026-09-06 and nothing in this product could say whether
 * anybody was arriving at all - every measurement it has begins after an
 * account exists. "Nobody visits" and "people visit and leave" need completely
 * different fixes and were indistinguishable. See migration 0076.
 *
 * ── WHAT IT SENDS ─────────────────────────────────────────────────────────
 *
 * A route from an allow-list and a referrer reduced to one of five words. That
 * is the entire payload. No identifier, no address, no user agent, nothing
 * that could tell two visits by one person from visits by two people. The
 * decisions are in lib/visit.js, as pure functions, so they are tested by
 * being run.
 *
 * ── AND WHY IT CALLS POSTGREST DIRECTLY ───────────────────────────────────
 *
 * The same way Login.jsx records an auth failure. The event happens before
 * there is a session, so there is no authenticated API request to attach it
 * to - and routing it through the API would spend a serverless invocation on
 * a counter. `record_page_visit` is anon-callable for that reason and is
 * flood-capped in the database because there is no user to rate limit.
 *
 * Swallowed unconditionally. A visit counter must never put an error in front
 * of somebody who is reading the page.
 */
export function RecordVisit() {
  const location = useLocation();

  /*
   * The last location.key counted.
   *
   * StrictMode double-invokes effects in development, and this one has a side
   * effect at the other end of a network call - without the guard every
   * development pageview would count twice and the number would be quietly
   * wrong in the direction that flatters it.
   *
   * Keyed on location.key rather than the pathname deliberately: re-clicking
   * the same link IS another pageview, and a pathname-keyed guard would drop
   * it. Same reasoning ScrollToTop gives for the opposite behavior.
   */
  const counted = useRef(null);

  useEffect(() => {
    if (counted.current === location.key) return;

    const route = routeFor(location.pathname);
    // Not a public page. Nothing is sent, and nothing is recorded that this
    // build has forgotten to exclude - the list in lib/visit.js is an
    // allow-list, so a new route is invisible here until somebody adds it.
    if (!route) return;

    counted.current = location.key;

    const referrer = referrerBucket(
      typeof document === 'undefined' ? '' : document.referrer,
      typeof window === 'undefined' ? '' : window.location.hostname,
    );

    /*
     * ── .then(noop, noop) AND NOT .catch(), WHICH CRASHED THE WHOLE APP ────
     *
     * `supabase.rpc()` does not return a Promise. It returns a
     * PostgrestFilterBuilder, which is a THENABLE: it has `then` and runs the
     * request when something awaits it. It has no `catch`.
     *
     * So `.catch(() => {})` was not a no-op safety net. It was
     * `undefined(() => {})` - a TypeError thrown synchronously inside this
     * effect, which React escalated to the ErrorBoundary. Every route in the
     * product rendered "Something broke on our side", including the front
     * page, for anybody who loaded the site.
     *
     * And because the builder only sends the request when `then` is called, it
     * never sent one: `page_visits` had zero rows for the entire time the
     * feature was live. The symptom that was supposed to prove the feature
     * worked was the symptom of it being broken.
     *
     * Verified rather than reasoned about:
     *   typeof builder.then  === 'function'
     *   typeof builder.catch === 'undefined'
     *
     * `then` with two handlers awaits it properly and swallows a rejection
     * without ever touching a method the builder does not have. A pageview
     * that cannot be recorded must never be visible to the person visiting.
     */
    supabase
      .rpc('record_page_visit', { p_route: route, p_referrer: referrer })
      .then(() => {}, () => {});
  }, [location.key, location.pathname]);

  return null;
}

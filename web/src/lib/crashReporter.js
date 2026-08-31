import { supabase } from './supabase.js';
import { config } from './config.js';
import { BUILD_ID } from './version.js';
import { buildReport, shouldReport } from './crashReport.js';

/**
 * The edge that actually listens, remembers and sends.
 *
 * Every decision about WHAT may be said lives in crashReport.js, which is
 * pure and tested. This file holds the parts that need a browser and holds
 * no judgment of its own, so that the redaction rules are never in a place
 * a test cannot reach.
 *
 * ── HOW A CRASH THAT KILLS THE PAGE STILL GETS REPORTED ───────────────────
 *
 * The failure on 2026-08-31 was Safari killing the web content process. There
 * is no callback for that. A dead renderer runs no handler, flushes no queue
 * and sends no beacon - which is exactly why nothing was recorded.
 *
 * So the signal is inverted. A marker is written to sessionStorage while the
 * page is visible and REMOVED on the way out. A page that leaves cleanly -
 * navigation, reload, backgrounding, closing the tab - clears it. A page that
 * dies cannot. The next load in that tab finds the marker still sitting there
 * and reports where the previous view was when it stopped existing.
 *
 * sessionStorage rather than localStorage because it is per tab and dies with
 * it: a marker left by one tab must never be read as a crash by another.
 *
 * ── WHY IT IS CALLED "SUSPECTED" ──────────────────────────────────────────
 *
 * Because from in here a crash and a force-quit are the same absence. What
 * narrows it is that backgrounding the app fires visibilitychange first and
 * clears the marker, so the surviving case is "went away while being looked
 * at" - which is a crash far more often than not, but is not proof, and the
 * code says `client_session_ended_badly` rather than `client_crashed`. This
 * project has a rule about checks that report more confidence than they hold.
 *
 * ── WHAT THIS DOES NOT CATCH ──────────────────────────────────────────────
 *
 * Failures before sign-in. The endpoint requires a session, deliberately: an
 * unauthenticated write endpoint on a public app is an abuse surface, and the
 * alternative is rate-limiting anonymous traffic on a product with one
 * operator. The crash-marker report survives that limit, because it is sent
 * on the NEXT load, by which time somebody is usually signed in again.
 */

const MARKER = 'cd:page-open';

/** Per page view. Reset by the page going away, which is the point. */
let state = { sent: [] };

/** sessionStorage throws in some private modes rather than returning null. */
function readMarker() {
  try {
    const raw = window.sessionStorage.getItem(MARKER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeMarker(route) {
  try {
    window.sessionStorage.setItem(MARKER, JSON.stringify({ route, build: BUILD_ID }));
  } catch {
    // No marker means no crash detection in this tab, which is a degraded
    // service and not an error worth showing anybody.
  }
}

function clearMarker() {
  try {
    window.sessionStorage.removeItem(MARKER);
  } catch {
    /* see writeMarker */
  }
}

/**
 * Send, or decide not to, and never throw either way.
 *
 * keepalive rather than sendBeacon: a beacon cannot carry an Authorization
 * header, and this endpoint requires one. keepalive gives the same survival
 * across unload with the same 64KiB budget, which a four-key object is in no
 * danger of approaching.
 */
async function send(code, thrown, route) {
  try {
    const report = buildReport({ code, route, thrown, build: BUILD_ID });
    const decision = shouldReport(state, report);
    state = decision.state;
    if (!decision.send) return;

    // Local builds do not write to the production error table. In development
    // the console is three feet away; there is nothing to learn from a row.
    if (BUILD_ID === 'dev') return;

    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;

    await fetch(`${config.apiBaseUrl}/api/client-errors`, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(report),
    });
  } catch {
    // A reporter that throws while reporting a crash turns one failure into
    // two, and the second one is in the code meant to explain the first.
  }
}

/** Handed to the ErrorBoundary as a prop, so that file keeps importing only React. */
export function reportRenderCrash(error) {
  void send('client_render_crash', error, window.location?.pathname);
}

/**
 * Attach the listeners and settle the previous page view's fate.
 *
 * Returns a teardown function, which nothing in the app calls and the tests
 * do - a listener that cannot be removed makes every test after the first one
 * lie about which handler fired.
 */
export function installCrashReporting() {
  const route = () => window.location?.pathname ?? '/';

  // Whatever the last view of this tab was, decide about it before anything
  // else has a chance to write a new marker.
  const previous = readMarker();
  if (previous) void send('client_session_ended_badly', null, previous.route);
  writeMarker(route());

  const onError = (event) => {
    void send('client_unhandled_error', event?.error ?? null, route());
  };
  const onRejection = (event) => {
    void send('client_unhandled_rejection', event?.reason ?? null, route());
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') clearMarker();
    else writeMarker(route());
  };
  const onPageHide = () => clearMarker();

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  };
}

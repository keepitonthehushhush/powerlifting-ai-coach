/**
 * What a browser is allowed to say about its own failures.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * On 2026-08-31 the coach page crashed Safari on an iPhone, repeatedly, and
 * nothing recorded it. error_events was empty, Vercel was quiet, every check
 * was green - and every one of them was correct, because nothing had gone
 * wrong on the server. The app's own ErrorBoundary wrote to the console, on a
 * phone, where no developer was standing.
 *
 * The comment in ErrorBoundary.jsx named the reason there was no reporter:
 * "sending a stack trace anywhere would need to answer what health data might
 * be sitting in a component's props at the moment it threw." That question is
 * answered here rather than deferred again.
 *
 * ── THE ANSWER: A COORDINATE, NOT A DESCRIPTION ───────────────────────────
 *
 * A report from this module carries where a failure happened and never what
 * was in scope when it did:
 *
 *   errorName  the constructor name, from a FIXED list. Anything unrecognized
 *              becomes 'Other' rather than being passed through - a name is
 *              usually a constructor, but nothing stops code from building one
 *              out of a value, and a whitelist costs nothing.
 *   topFrame   basename:line:column, extracted from the stack and stripped of
 *              the URL, the function name and everything else. A minified
 *              bundle coordinate. There is no path by which an athlete's
 *              injuries reach it.
 *   frames     how deep the stack was. A number.
 *   build      which bundle. A number and hex.
 *
 * What is deliberately absent is the error MESSAGE. It is the single most
 * useful field and it is refused, because a thrown message is whatever the
 * throwing code interpolated - and this app holds health_restrictions. The
 * cost is real: diagnosis needs a source map instead of a sentence. That is
 * the trade this project makes every time.
 *
 * ── WHY THE FUNCTIONS HERE TOUCH NOTHING ──────────────────────────────────
 *
 * Everything in this file is pure. The window listeners, sessionStorage and
 * the beacon live in crashReporter.js, which holds no decisions. A reporter
 * that cannot be tested without a browser is a reporter whose redaction is
 * never tested, and redaction is the whole point.
 */

/** The closed vocabulary. The server refuses anything not in this list. */
export const CLIENT_ERROR_CODES = Object.freeze([
  /** React unmounted the tree; the ErrorBoundary caught it. */
  'client_render_crash',
  /** window.onerror - a throw outside React's reach. */
  'client_unhandled_error',
  /** An async rejection nobody caught. */
  'client_unhandled_rejection',
  /**
   * The page went away while somebody was looking at it, and the next load
   * found the marker still open. SUSPECTED, and named that way: a force-quit
   * looks identical from in here. See crashReporter.js.
   */
  'client_session_ended_badly',
  /**
   * A request never reached the server - the fetch itself rejected.
   *
   * ── WHY THE VOCABULARY GREW ───────────────────────────────────────────
   *
   * The four codes above are all CRASHES, and reviewing the error table
   * showed what that leaves out. `error_events` held two rows, both from the
   * server, and none from a browser - while the single most-reported problem
   * in this product's history is "could not reach the server. Check your
   * connection and try again." That message is produced by api.js, shown to
   * the athlete, and recorded absolutely nowhere: a rejected fetch inside a
   * try/catch is not an unhandled rejection, so no listener fires.
   *
   * So the failure people actually hit was the one failure the reporter
   * could not see. Handled gracefully and invisible are not the same thing.
   */
  'client_request_failed',
  /**
   * The request was given up on after the client's own timeout.
   *
   * Separate from the one above because the two need opposite fixes: a
   * request that never left says something about the network, and one that
   * ran out of time says something about how long we are willing to wait -
   * and a coaching reply legitimately takes over a minute. Folding them
   * together would hide whichever is rarer behind whichever is not.
   */
  'client_request_timed_out',
]);

/**
 * Error names that pass through unchanged. Everything else becomes 'Other'.
 *
 * These are the standard constructors plus the two this app defines. The list
 * is short on purpose - its job is to be a whitelist, not a catalogue.
 */
const KNOWN_ERROR_NAMES = Object.freeze([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'EvalError', 'URIError', 'AggregateError', 'DOMException', 'ApiError',
]);

/** Matches the database's check on detail->>'topFrame'. Kept identical on purpose. */
export const TOP_FRAME_PATTERN = /^[A-Za-z0-9._-]{1,80}:[0-9]{1,7}:[0-9]{1,7}$/;

/** Matches the database's check on error_events.route. */
const ROUTE_PATTERN = /^\/[A-Za-z0-9/_-]{0,80}$/;

/**
 * The first `file:line:column` in a stack, reduced to a basename.
 *
 * Works across the three formats without parsing any of them, because the
 * shape being looked for is the same in all three and the differences - the
 * `at ` prefix, the `@`, the parentheses - are all outside it:
 *
 *   Chrome    at render (https://coachdiaz.app/assets/index-a1b2c3.js:14:2201)
 *   Safari    render@https://coachdiaz.app/assets/index-a1b2c3.js:14:2201
 *   Firefox   render@https://coachdiaz.app/assets/index-a1b2c3.js:14:2201
 *
 * `https:` cannot match, because a scheme's colon is followed by slashes and
 * not by digits. Returns null rather than a guess when there is no stack -
 * Safari omits one for some internal errors, and a fabricated coordinate is
 * worse than none.
 */
export function topFrameOf(stack) {
  const text = typeof stack === 'string' ? stack : '';
  const match = text.match(/([A-Za-z0-9._-]+):(\d{1,7}):(\d{1,7})/);
  if (!match) return null;
  const frame = `${match[1].slice(-80)}:${match[2]}:${match[3]}`;
  // Belt and braces: a basename over 80 characters, sliced, could in principle
  // start with a character the database refuses. Check the real pattern.
  return TOP_FRAME_PATTERN.test(frame) ? frame : null;
}

/** How deep the stack was, as a number, without keeping any of it. */
export function frameCountOf(stack) {
  if (typeof stack !== 'string' || stack === '') return 0;
  return stack.split('\n').filter((line) => /:\d{1,7}:\d{1,7}/.test(line)).length;
}

/**
 * Reduce a thrown value to the four things that may leave the browser.
 *
 * Takes anything, because `throw 'a string'` is legal and a rejected promise
 * carries whatever it carries. A non-Error becomes name 'Other' with no
 * coordinate, which is a true statement about a throw that had no stack.
 */
export function describeError(thrown, { build = 'unknown', ua = null, standalone = null, touchPoints = 0 } = {}) {
  const name = thrown?.name;
  const stack = thrown?.stack;
  return {
    errorName: KNOWN_ERROR_NAMES.includes(name) ? name : 'Other',
    topFrame: topFrameOf(stack),
    frames: frameCountOf(stack),
    build: typeof build === 'string' ? build.slice(0, 40) : 'unknown',
    platform: platformBucket(ua, { touchPoints }),
    standalone: standalone === true,
  };
}

/**
 * The closed set of platforms a report may name. Nothing else is ever sent.
 *
 * ── WHY A BUCKET AND NOT A USER AGENT ─────────────────────────────────────
 *
 * The question this answers is "are all the crashes on one platform" - which
 * is the first question anybody asks when a link has just gone out to ten
 * people with ten different phones, and which the reports could not answer at
 * all: an Android crash and a desktop one were byte-identical rows.
 *
 * A user-agent string answers it and is a fingerprinting surface: version,
 * build, device model, sometimes locale. On a product holding health data,
 * storing one per crash is a worse trade than not knowing the patch version.
 * So the browser resolves it to one of these BEFORE anything leaves, the raw
 * string is never sent, and a migration constrains the column to this list so
 * a future caller cannot widen it by accident.
 *
 * Coarse on purpose. "iOS Safari" and "Android Chrome" are the two that carry
 * real behavioral differences for this app - the home-screen web view eviction
 * that cost a theme and a message is an iOS-standalone problem specifically.
 * Patch versions would be noise.
 */
export const PLATFORMS = Object.freeze([
  'ios-safari', 'ios-other',
  'android-chrome', 'android-other',
  'mac-safari', 'mac-other',
  'windows', 'linux', 'other',
]);

/**
 * @param {string|null} ua a user agent string. Never stored, only read.
 * @param {{touchPoints?: number}} [hints] `navigator.maxTouchPoints`.
 * @returns {string} one of PLATFORMS.
 */
export function platformBucket(ua, { touchPoints = 0 } = {}) {
  if (typeof ua !== 'string' || ua.length === 0) return 'other';

  /*
   * ── AN iPAD CANNOT BE IDENTIFIED FROM THE USER AGENT ────────────────────
   *
   * Since iPadOS 13, Safari on an iPad sends a user agent that is BYTE
   * IDENTICAL to a desktop Mac's - no 'iPad' anywhere in it. The first version
   * of this function carried a comment saying it handled that and a regex that
   * could not, which is the defect this project keeps finding in its own
   * checks: a claim nobody tested against the case it names.
   *
   * `navigator.maxTouchPoints` is the discriminator that works. An iPad
   * reports 5; a Mac reports 0, including a MacBook with a trackpad. It is one
   * number, it identifies nobody, and it is the only reason iPads do not
   * silently land in the desktop bucket - which matters because the
   * home-screen web-view eviction that cost a theme and a message is an iOS
   * problem specifically, and half the iPads would have been filed as Macs.
   *
   * Every browser on iOS is Safari's engine underneath, so 'ios-other' means a
   * different SHELL (Chrome, Firefox), which can still differ in what it does
   * to a web view - the distinction worth keeping.
   */
  const iPadPretendingToBeAMac = /Macintosh|Mac OS X/.test(ua) && touchPoints > 1;
  if (/iPhone|iPod|iPad/.test(ua) || iPadPretendingToBeAMac) {
    return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  }
  if (/Android/.test(ua)) return /Chrome|CriOS/.test(ua) ? 'android-chrome' : 'android-other';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) {
    // Chrome and Edge both put "Safari" in the string; Safari is the one that
    // does NOT put Chrome in it.
    return /Chrome|Chromium|Edg\//.test(ua) ? 'mac-other' : 'mac-safari';
  }
  if (/Linux|X11|CrOS/.test(ua)) return 'linux';
  return 'other';
}

/**
 * A pathname the database will accept, with any id taken out of it.
 *
 * ── WHY THIS IS A COPY, AND WHAT KEEPS IT HONEST ──────────────────────────
 *
 * The server already has this rule, in errorRecord.js `normaliseRoute`. It
 * cannot be imported here: that module reaches the Supabase admin client and
 * the logger, and pulling server code into the browser bundle to reuse two
 * regexes is a far worse trade than restating them.
 *
 * So it is restated, and server/test/crashReport.test.js asserts the two
 * functions produce the SAME answer for the same input. Two copies of one
 * fact is this project's most reliable source of defects; a copy with a test
 * that fails when they disagree is a copy that cannot drift silently.
 *
 * The first version of this function did not normalize at all - it only
 * checked the pattern - and a test caught that a UUID passes that check
 * happily, because a UUID is letters, digits and hyphens. It would have
 * shipped program ids into the error table on day one.
 */
export function safeRoute(pathname) {
  const path = String(pathname ?? '').split('?')[0];
  const normalized = path
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, '/_id')
    .replace(/\/\d+/g, '/_id');
  return ROUTE_PATTERN.test(normalized) ? normalized : '/unknown';
}

/** The most a single page view may send. A crash loop must not become a flood. */
export const MAX_REPORTS_PER_SESSION = 5;

/**
 * The most failed requests kept waiting to be reported.
 *
 * Smaller than MAX_REPORTS_PER_SESSION on purpose: this queue survives page
 * views, and somebody on a train can fill it all afternoon. Three is enough
 * to say "several endpoints, not just one" and few enough that the queue
 * never becomes the problem it is reporting.
 */
export const MAX_PENDING_REPORTS = 3;

/**
 * Which code, if any, a failed request deserves.
 *
 * @param {number} status - 0 when the fetch itself rejected, 408 when our own
 *   AbortController gave up. Anything else came back from the server, which
 *   means the server is already recording it in the same table with origin
 *   'server' - and a second row from the browser would double-count it.
 * @returns {string|null}
 */
export function requestFailureCode(status) {
  if (status === 0) return 'client_request_failed';
  if (status === 408) return 'client_request_timed_out';
  return null;
}

/**
 * Add a pending report to the queue, or decide it does not belong there.
 *
 * Pure, so the decisions live where they can be tested without a browser -
 * the same split the header of crashReporter.js describes. That file holds
 * the sessionStorage and none of the judgment.
 *
 * Deduplicated on code AND route, for the same reason shouldReport() is: the
 * same failure on two endpoints is two findings. Deduplicated HERE as well
 * because this queue crosses page views and shouldReport's state does not.
 */
export function queueReport(queue, entry) {
  const existing = Array.isArray(queue) ? queue.filter(isPendingEntry) : [];
  if (!isPendingEntry(entry)) return existing;
  if (existing.some((e) => e.code === entry.code && e.route === entry.route)) return existing;
  if (existing.length >= MAX_PENDING_REPORTS) return existing;
  return [...existing, entry];
}

/** A queue read back from storage is untrusted input like any other. */
function isPendingEntry(entry) {
  return (
    Boolean(entry) &&
    CLIENT_ERROR_CODES.includes(entry.code) &&
    typeof entry.route === 'string' &&
    ROUTE_PATTERN.test(entry.route) &&
    typeof entry.build === 'string'
  );
}

/** Build one, with the route normalized and the build stamped. */
export function pendingReport(status, path, build) {
  const code = requestFailureCode(status);
  if (!code) return null;
  return { code, route: safeRoute(path), build: typeof build === 'string' ? build.slice(0, 40) : 'unknown' };
}

/**
 * Should this report be sent, given what has already been sent?
 *
 * Deduplicated on code AND route, not on code alone: the same TypeError on
 * two different screens is two findings, and collapsing them is how a
 * second, worse bug hides behind a first.
 *
 * @param {{sent: string[]}} state - keys already sent this page view.
 * @param {{code: string, route: string}} report
 * @returns {{send: boolean, state: {sent: string[]}, reason?: 'duplicate'|'capped'|'unknownCode'}}
 */
export function shouldReport(state, report) {
  const sent = Array.isArray(state?.sent) ? state.sent : [];
  if (!CLIENT_ERROR_CODES.includes(report?.code)) {
    return { send: false, state: { sent }, reason: 'unknownCode' };
  }
  const key = `${report.code} ${report.route}`;
  if (sent.includes(key)) return { send: false, state: { sent }, reason: 'duplicate' };
  if (sent.length >= MAX_REPORTS_PER_SESSION) {
    return { send: false, state: { sent }, reason: 'capped' };
  }
  return { send: true, state: { sent: [...sent, key] } };
}

/**
 * The exact body the server will be asked to accept.
 *
 * Built here, in one place, so there is a single answer to "what does a
 * browser send" - and so a test can assert that a thrown Error carrying an
 * athlete's restriction in its message produces a body that does not contain
 * it. That test is the reason this function exists rather than an object
 * literal at the call site.
 */
export function buildReport({ code, route, thrown, build, ...environment }) {
  return { code, route: safeRoute(route), detail: describeError(thrown, { build, ...environment }) };
}

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
 *   errorName  the constructor name, from a FIXED list. Anything unrecognised
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
export function describeError(thrown, { build = 'unknown' } = {}) {
  const name = thrown?.name;
  const stack = thrown?.stack;
  return {
    errorName: KNOWN_ERROR_NAMES.includes(name) ? name : 'Other',
    topFrame: topFrameOf(stack),
    frames: frameCountOf(stack),
    build: typeof build === 'string' ? build.slice(0, 40) : 'unknown',
  };
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
export function buildReport({ code, route, thrown, build }) {
  return { code, route: safeRoute(route), detail: describeError(thrown, { build }) };
}

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, readRaw } from './helpers/source.js';

/**
 * THE CHECK THAT LOADS THE BUILT APP, AND THE TWO WAYS IT CAN LIE.
 *
 * `scripts/check-app-mounts.mjs` is the only check in this repo that runs the
 * app instead of reading it, which makes it the only one that can catch a
 * blank page. It has shipped two of those. Everything here is about keeping it
 * honest, because a check that runs a browser and then agrees with anything is
 * worse than no check: it is a green light nobody questions.
 */

const script = readSource(new URL('../../scripts/check-app-mounts.mjs', import.meta.url));
const scriptRaw = readRaw(new URL('../../scripts/check-app-mounts.mjs', import.meta.url));
const boundary = readSource(new URL('../../web/src/components/ErrorBoundary.jsx', import.meta.url));
const app = readSource(new URL('../../web/src/App.jsx', import.meta.url));

/** The routes the script actually loads. */
const CHECKED = [...script.slice(script.indexOf('const ROUTES = ['), script.indexOf('];', script.indexOf('const ROUTES = [')))
  .matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);

/** Every path App.jsx routes, minus the wildcard and the redirects. */
const ROUTED = [...app.matchAll(/path="(\/[^"]*)"/g)].map((m) => m[1]);

describe('it is pointed at more than the front door', () => {
  test('the route list parsed', () => {
    assert.ok(CHECKED.length >= 11, `parsed ${CHECKED.length} routes - the ROUTES block moved`);
    assert.ok(ROUTED.length > CHECKED.length, 'App.jsx parsed as fewer routes than the script checks');
  });

  test('EVERY PUBLIC ROUTE IS LOADED', () => {
    /*
     * The gap this closes. The script detects untranslated i18n keys rendered
     * as visible text, and found none for a year because it was pointed at two
     * pages - while the account page rendered the literal string
     * `activity.action.clearance_asserted` at every athlete who had ever
     * confirmed medical clearance.
     *
     * A page that is not loaded is a page this check has no opinion about, and
     * a check with no opinion reads exactly like a pass.
     */
    const PROTECTED = ['/intake', '/log', '/leaderboard', '/coach', '/consent', '/program', '/progress', '/library', '/account'];
    const missing = ROUTED.filter((route) => (
      !CHECKED.includes(route)
      && !PROTECTED.includes(route)
      && !route.includes('*')
      && !route.startsWith('/privacy/')
      && route !== '/guardian/consent'
    ));
    assert.deepEqual(missing, [], `public routes nothing loads: ${missing.join(', ')}`);
  });

  test('the routes it cannot reach are named rather than forgotten', () => {
    // A known gap written down is a decision. A known gap in somebody's head
    // is the same gap, rediscovered later at a worse moment.
    assert.match(scriptRaw, /NOT CHECKED, AND WHY/);
    assert.match(scriptRaw, /ProtectedRoute/);
  });
});

describe('the crash detector detects a crash and not a hyperlink', () => {
  test('it looks for the marker, not for the link', () => {
    /*
     * It looked for the substring `/maintenance.html`, which the ErrorBoundary
     * fallback links to - and so does the FAQ, in an ordinary answer about what
     * to do when the site is down. Pointing the check at /faq would have
     * reported a crash on a page that renders perfectly, and the obvious fix
     * under deadline is to drop /faq from the list rather than to fix the
     * detector.
     */
    assert.match(script, /dom\.includes\('data-error-boundary'\)/);
    assert.doesNotMatch(script, /dom\.includes\('\/maintenance\.html'\)/);
  });

  test('and the fallback actually carries that marker', () => {
    // Both halves, because either one alone is a check that passes forever:
    // a script looking for an attribute nothing renders never fires.
    assert.match(boundary, /data-error-boundary="crashed"/);
  });

  test('the FAQ still links to the maintenance page', () => {
    // The link is the reason the detector had to change. If it ever goes away
    // this test should be deleted deliberately, not pass by accident.
    const faq = readFileSync(new URL('../../web/src/pages/Faq.jsx', import.meta.url), 'utf8');
    assert.match(faq, /href="\/maintenance\.html"/);
  });
});

describe('the check cannot be skipped into a pass', () => {
  test('a missing browser is a failure, not a skip', () => {
    // Both blank pages this project shipped were invisible to every check that
    // reads files instead of running them.
    assert.match(script, /deliberately not skippable/);
    assert.match(script, /process\.exit\(1\)/);
  });
});

describe('the remote mode could not pass, and now can', () => {
  /**
   * ── THE DEFECT ────────────────────────────────────────────────────────
   *
   * Remote mode was added after an eighteen-hour production outage, with a
   * workflow running it every six hours, because "nothing was watching
   * production". It had never been able to pass.
   *
   * The probe was a `<script>` spliced into `<head>` by the local file server
   * on the way out. `--dump-dom` cannot inject anything into a page it did not
   * serve, so on a deployed origin there was no probe - and `checkRoute` read
   * its absence as a failure. Measured, against a local origin serving the
   * exact build that passes locally:
   *
   *   local   11 route(s) mount and render     exit 0
   *   remote  11 failures, all "the probe       exit 1
   *           never ran", 0 content failures
   *
   * The app was fine in both. A monitor that reports red unconditionally is
   * worse than no monitor: it is a signal nobody reads, and this one existed
   * precisely because nobody was reading anything.
   */
  test('the probe is injected by the browser, not by the file server', () => {
    assert.match(script, /addInitScript\(PROBE_JS\)/, 'nothing injects the probe');
    assert.match(
      script,
      /Page\.addScriptToEvaluateOnNewDocument|addInitScript/,
      'the probe is not installed before the page\'s own script',
    );
    // The old mechanism, which only ever worked on pages this process served.
    assert.doesNotMatch(
      scriptRaw,
      /replace\('<head>'/,
      'the file server is splicing the probe into index.html again, which no deployed origin can receive',
    );
    /*
     * `script` and not `scriptRaw`: the file's own prose discusses --dump-dom
     * at length, because the reason it stopped being enough is worth writing
     * down. Matching the raw text fired on that explanation - the same
     * substring trap that once matched the word "schedule" inside a YAML
     * comment. readSource strips the comments; what is left is the code.
     */
    assert.doesNotMatch(script, /--dump-dom/, 'back to a flag that cannot inject anything');
  });

  test('the local mode serves the built index.html unmodified', () => {
    // It measured a page that does not exist for as long as it rewrote one.
    const serve = script.slice(script.indexOf('async function serveDist()'));
    const body = serve.slice(0, serve.indexOf('\n}'));
    assert.doesNotMatch(body, /PROBE/, 'serveDist is modifying what it serves again');
  });

  test('an origin that did not serve this app is NOT reported as a broken app', () => {
    /*
     * The same script, pointed at coachdiaz.app from a sandbox whose egress
     * proxy refuses that host, printed twenty-two lines under the heading
     * "https://coachdiaz.app is broken" - character-for-character the board it
     * printed during the real outage. The site was fine: 30 page_visits in the
     * preceding 48 hours and zero client errors.
     *
     * Google's SRE book sets the bar for anything that pages a human: "urgent,
     * actionable, and actively or imminently user-visible", from rules that
     * "represent a clear failure". "I could not open a socket" is a clear
     * failure of THIS PROCESS. Naming it as such is the whole fix - it is the
     * ordinary black-box distinction, that a failure of the collection path is
     * not a failure of the service.
     */
    assert.match(script, /async function servedThisApp\(origin\)/, 'nothing checks the origin served this app');
    /*
     * The CONDITIONAL, not the string. Two planted mutants survived an earlier
     * version of this test for the same reason: `if (false) {` left the
     * literal `<div id="root"` sitting in the message inside the branch, and
     * replacing the call with `{ ok: true }` left the function it no longer
     * calls still defined above. Both times the assertion matched text the
     * mutation had not needed to touch.
     */
    assert.match(
      script,
      /if \(!body\.includes\('<div id="root"'\)\)/,
      'the gate accepts any 2xx, including a parked domain',
    );
    assert.match(script, /process\.exit\(UNREACHABLE\)/, 'an unreachable origin still exits as a broken app');
    assert.match(script, /const UNREACHABLE = 2;/, 'the two failures share an exit code');

    // And it is asked BEFORE the browser is launched, or eleven route failures
    // are collected on the way to saying nothing was measured. `> -1` first,
    // because a call that is not there at all has index -1, which is less than
    // everything and would pass an ordering test on its own absence.
    const gateAt = script.indexOf('const served = await servedThisApp(origin);');
    const launchAt = script.indexOf('await launch(chrome');
    assert.ok(gateAt > -1, 'the origin gate is defined but never called');
    assert.ok(launchAt > -1, 'the browser launch moved, so this ordering test is measuring nothing');
    assert.ok(gateAt < launchAt, 'the origin is probed after the browser has already loaded eleven pages');
  });

  test('a probe missing from EVERY page is reported once, as an instrumentation fault', () => {
    // One route without a probe is a page whose script never ran, and stays a
    // route failure. All of them is this script breaking, and saying "the app
    // does not work" eleven times is the same over-claim in a new place.
    assert.match(script, /uninstrumented === ROUTES\.length/, 'a total probe failure is still blamed on the app');
  });

  test('the offline rule is still conditional on which mode this is', () => {
    /*
     * `--host-resolver-rules=MAP * ~NOTFOUND` is what makes the LOCAL check
     * meaningful: it proves the app mounts without reaching Supabase. Applied
     * to a URL it would block the target and report a confident pass against a
     * page that never loaded. A planted mutant that removed the condition was
     * caught when this moved to the shared driver, too.
     */
    assert.match(script, /offline: !remoteTarget/, 'the offline rule is unconditional again');
  });
});

describe('there is one browser driver, not one per check', () => {
  const driver = readSource(new URL('../../scripts/lib/browser.mjs', import.meta.url));
  const scroll = readSource(new URL('../../scripts/check-scroll-cues.mjs', import.meta.url));

  test('both checks import it rather than carrying their own', () => {
    assert.match(driver, /export async function launch\(/, 'the shared driver has no launch');
    assert.match(driver, /export async function findChrome\(/, 'the shared driver has no findChrome');
    for (const [name, source] of [['check-app-mounts', script], ['check-scroll-cues', scroll]]) {
      assert.match(
        source,
        /import \{ findChrome, launch \} from '\.\/lib\/browser\.mjs'/,
        `${name} does not use the shared driver`,
      );
      assert.doesNotMatch(
        source,
        /new WebSocket\(/,
        `${name} has grown a second DevTools client - the two ways of driving a browser are ` +
          'how the remote mode came to be unable to inject anything',
      );
    }
  });

  test('the driver defaults to letting the network through, so offline is asked for', () => {
    // The dangerous direction is the one somebody has to type. An accidental
    // `offline: true` against a deployed site is a confident pass on a page
    // that never loaded.
    assert.match(driver, /offline = false/, 'the shared driver cuts the network off by default');
  });
});

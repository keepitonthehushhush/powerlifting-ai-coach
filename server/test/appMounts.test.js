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

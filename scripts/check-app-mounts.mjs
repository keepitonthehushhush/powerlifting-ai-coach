#!/usr/bin/env node
/**
 * Does the built app actually put something on the screen?
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Twice now this project has shipped a green build that rendered a white
 * page. Both times the cause was a module that threw while it was still being
 * IMPORTED - before createRoot ran, before React existed on the page:
 *
 *   1. supabase.js threw when a VITE_ variable was missing. Fixed by not
 *      throwing; the lesson was written into a comment.
 *   2. Intake.jsx's module-level EMPTY constant referenced `form`, a variable
 *      that only exists inside the component. ReferenceError at import.
 *
 * Every check this repository owns looked somewhere else, because they all
 * inspect artifacts rather than behavior. `vite build` succeeds - the code is
 * syntactically valid. `node --check` passes. The secret scanner reads the
 * bundle as text. The unit suite never imports a page component. The one
 * question none of them asks is the only question that matters to a visitor:
 * when this file is loaded by a browser, does anything appear?
 *
 * So this loads the real built bundle in a real browser and looks.
 *
 * ── WHY NOT PLAYWRIGHT ────────────────────────────────────────────────────
 *
 * It would be one npm install and a much nicer API. It would also be a large
 * dependency, a browser download in CI, and a second thing to keep current -
 * for a check that needs a page load and a DOM read per route. Chrome is
 * preinstalled on GitHub's ubuntu runners (Ubuntu 24.04 ships Google Chrome
 * AND Chromium), so CI needs no new step.
 *
 * This used to say `--dump-dom` was "the entire feature required", and that
 * was true of the local check and false of the remote one. A flag cannot
 * inject a probe into a page it did not serve, which is why the remote mode
 * could not pass for as long as it existed. It drives the DevTools protocol
 * now - scripts/lib/browser.mjs, a few hundred lines of JSON over the
 * WebSocket client node ships - and the rejection above still holds.
 *
 * ── WHY THE BROWSER IS CUT OFF FROM THE INTERNET ──────────────────────────
 *
 * --host-resolver-rules maps every host except loopback to NOTFOUND. Turnstile
 * and Supabase are therefore unreachable BY DESIGN: a smoke test that passes
 * or fails depending on whether challenges.cloudflare.com is up is not a test
 * of this repository. The app is expected to degrade to a readable sign-in
 * screen with those services missing - which is itself worth asserting, since
 * that is what a visitor behind a corporate filter sees.
 *
 * Usage:  node scripts/check-app-mounts.mjs
 *         CHROME_BIN=/path/to/chrome node scripts/check-app-mounts.mjs
 */

import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from './lib/browser.mjs';
import { untranslatedKeys } from './lib/i18nLeak.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(repoRoot, process.env.DIST_DIR ?? 'web/dist');

/**
 * How long the page gets to mount, in REAL milliseconds.
 *
 * It used to be virtual: --virtual-time-budget fast-forwards timers, and the
 * probe's own setTimeout fired inside that budget. The driver polls #root
 * instead, so this is a ceiling on a wait that is normally a few hundred
 * milliseconds rather than a duration every route pays.
 */
const MOUNT_TIMEOUT_MS = 12000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Installed BEFORE any of the page's own script, on whatever origin it is
 * served from, and left there to collect what a visitor cannot report:
 * uncaught exceptions and unhandled rejections.
 *
 * ── WHY IT IS NO LONGER A <script> TAG SPLICED INTO index.html ────────────
 *
 * Because that only worked on pages this process served. `--dump-dom` cannot
 * inject anything into a deployed site, so the REMOTE mode - added after an
 * eighteen-hour outage, run unattended every six hours - could never pass.
 * Pointed at an origin serving a build that passes 11 routes out of 11
 * locally, it reported 11 failures, every one of them "the probe never ran".
 * The app was fine. The probe was never there.
 *
 * `Page.addScriptToEvaluateOnNewDocument` has no such limit, and the same
 * probe now runs in both modes, which is also the only way the two modes can
 * be said to be asking the same question.
 *
 * Only ErrorEvent is recorded. A failed `<script src>` or `<img>` fires a
 * plain Event during the capture phase, and with the network cut off those are
 * expected - Turnstile's loader is exactly one of them.
 */
const PROBE_JS = `
  (function () {
    var errs = [];
    window.__probe = { errors: errs };
    addEventListener('error', function (e) {
      if (!(e instanceof ErrorEvent)) return;
      errs.push(e.message + ' @ ' + e.filename + ':' + e.lineno + ':' + e.colno +
        (e.error && e.error.stack ? '\\n' + e.error.stack : ''));
    }, true);
    addEventListener('unhandledrejection', function (e) {
      errs.push('unhandled rejection: ' + ((e.reason && e.reason.stack) || e.reason));
    });
  })();
`;

/** Read back out of the page once it has had its chance to mount. */
const REPORT_JS = `
  var root = document.getElementById('root');
  return {
    installed: !!window.__probe,
    errors: (window.__probe && window.__probe.errors) || [],
    mounted: root ? root.childNodes.length : null,
  };
`;

async function exists(target) {
  try {
    await access(target, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serves dist/ the way vercel.json does: real files win, everything else is
 * index.html.
 *
 * Unmodified now. It used to splice the probe into `<head>` on the way out,
 * which meant the local check measured a page that does not exist and the
 * remote check could not be given a probe at all. The probe is injected by the
 * browser in both modes, so what this serves is byte-for-byte what Vercel
 * serves.
 */
async function serveDist() {
  const probed = await readFile(path.join(distDir, 'index.html'), 'utf8');

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = path.resolve(distDir, rel);

    // A request that escapes dist/ is a bug in this script, not a route.
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403).end();
      return;
    }

    if (rel && (await exists(filePath))) {
      try {
        const body = await readFile(filePath);
        res.writeHead(200, {
          'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
        });
        res.end(body);
        return;
      } catch {
        /* a directory - fall through to the SPA response */
      }
    }
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(probed);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

/**
 * The routes worth loading.
 *
 * `/` was the only one until it stopped being the sign-in page. When the
 * landing page took the root, this check silently stopped exercising the
 * screen with the auth code and the third-party CAPTCHA widget on it - the
 * most breakable page in the app - and nothing would have said so.
 *
 * ── WHY THE LIST GREW, ON 2026-09-12 ───────────────────────────────────────
 *
 * This script already detects untranslated i18n keys rendered as visible text.
 * It found none, for a year, because it was pointed at two pages.
 *
 * Meanwhile the activity card on the account page had been rendering the
 * literal string `activity.action.clearance_asserted` at every athlete who had
 * ever confirmed medical clearance - eight rows in production, which was every
 * row that card had ever had. The detector that exists precisely to catch that
 * was running on two routes, neither of which was the one with the bug.
 *
 * So: every route a signed-out browser can reach. The account page itself
 * still cannot be checked HERE - it is behind auth, and a signed-out load
 * renders the sign-in screen rather than the page.
 *
 * ── AND THAT GAP IS CLOSED NOW, SOMEWHERE ELSE ────────────────────────────
 *
 * It was named in this comment rather than left to be rediscovered, and then
 * it sat here named. scripts/check-screens.mjs runs the same detector over the
 * review harness, which mounts all eighteen screens SIGNED IN - including the
 * account page, which is the one the bug was on. The detector is shared
 * (lib/i18nLeak.mjs) rather than copied, because two copies would drift and
 * only one of them would be the one that found anything.
 *
 * Each route is one page load of a few hundred milliseconds. Eleven of them is
 * still a check somebody will wait for.
 */
const ROUTES = [
  '/',
  '/login',
  // The public documents. Every one of them is prose somebody may be reading
  // in order to decide whether to trust this product with health information,
  // and every one is rendered entirely from the locale files.
  '/about',
  '/faq',
  '/policies/privacy',
  '/policies/terms',
  '/policies/ai-processing',
  '/policies/health-data',
  '/policies/leaderboard',
  '/policies/guardian-consent',
  // Reached from an email link with a token this load does not have, so what
  // renders is its own error state. That is the point: it is the state a
  // person hits when a link has expired, and it has to be a page rather than a
  // blank screen.
  '/reset-password',
];

/*
 * NOT CHECKED, AND WHY, SO THIS IS A KNOWN GAP RATHER THAN AN OVERSIGHT:
 * /coach, /program, /progress, /library, /log, /intake, /leaderboard,
 * /consent and /account are all behind ProtectedRoute. Loading them signed
 * out renders the sign-in screen, so adding them here would produce eight
 * more passing checks of the same page. Covering them needs a signed-in
 * session, which needs a test account and a network this check deliberately
 * cuts off.
 */

/** Everything a file cannot tell you, asked of one rendered page. */
async function checkRoute(dom, report) {
  const failures = [];

  /*
   * `installed` is asked first and is not a formality. It is the difference
   * between "this page is broken" and "nothing was measured", and getting
   * those two confused is what made the remote mode useless: it reported the
   * absence of its own probe as eleven broken routes. If the injection ever
   * stops working, this says so in those words, once, instead.
   */
  if (!report.installed) {
    failures.push('the probe was never installed in this page, so nothing here was measured.');
    return failures;
  }

  if (report.errors.length) {
    failures.push(`the page threw:\n${report.errors.join('\n--\n').replace(/^/gm, '        ')}`);
  }

  if (report.mounted === null) failures.push('index.html has no #root for React to mount into.');
  else if (Number(report.mounted) === 0) failures.push('#root is empty: React mounted nothing.');

  if (!dom.includes('Coach Diaz')) {
    failures.push('the rendered page does not contain "Coach Diaz" - something mounted, but not this app.');
  }

  /*
   * Reaching the ErrorBoundary means the app rendered its apology instead of
   * itself, which a child count cannot tell apart from success.
   *
   * Detected by an attribute only that fallback carries. It used to be the
   * substring `/maintenance.html`, which the fallback links to - and so does
   * the FAQ, in an ordinary answer about what to do when the site is down. The
   * first time this check was pointed at /faq it would have reported a crash
   * on a page that renders perfectly. Caught on 2026-09-12 by loading the page
   * before trusting the check, rather than after.
   */
  if (dom.includes('data-error-boundary')) {
    failures.push('the ErrorBoundary fallback rendered: a component threw during its first render.');
  }

  const leaked = await untranslatedKeys(dom, path.join(repoRoot, 'web/src/i18n/locales/en.js'));
  if (leaked.length) {
    failures.push(`untranslated i18n keys rendered as visible text: ${leaked.join(', ')}`);
  }

  return failures;
}

/**
 * ── THE SAME QUESTION, ASKED OF THE SITE INSTEAD OF THE BUILD ─────────────
 *
 * Pass a URL and this checks the DEPLOYED app rather than web/dist:
 *
 *     node scripts/check-app-mounts.mjs https://coachdiaz.app
 *
 * The reason it exists is an eighteen-hour outage. A React effect called
 * `.catch` on a supabase query builder - a thenable with no `catch` - so every
 * PUBLIC route threw on mount and rendered the ErrorBoundary: the front page,
 * the sign-in page and all eight policy pages. The signed-in app was
 * untouched, which is why the only person using the product never saw it.
 *
 * This check catches that, and did, the first time it was run. It just was not
 * run against the thing that was broken. `npm run build` on a laptop is not
 * evidence about what Vercel served, and CI passing is not evidence that a
 * deploy happened at all - Vercel's Git integration builds on push and does
 * not wait for GitHub Actions.
 *
 * So the local mode answers "should this be merged" and the remote mode
 * answers "is the site up", and they are the same code because they are the
 * same question. verify-deployment.mjs already asks what the public is
 * downloading; this asks whether what they downloaded runs.
 */
/**
 * ── CAN THIS MACHINE REACH THE SITE AT ALL? ───────────────────────────────
 *
 * Asked BEFORE the browser runs, because the answer changes what every later
 * failure means.
 *
 * The defect: pointed at coachdiaz.app from a sandbox whose egress proxy
 * refuses that host, this check printed
 *
 *     https://coachdiaz.app is broken in a browser (chrome):
 *       - /: the probe never ran - the page did not reach its first timer.
 *       - /: the rendered page does not contain "Coach Diaz" ...
 *       ... eleven routes, twenty-two lines ...
 *
 * which is character-for-character the board it printed during the real
 * eighteen-hour outage. The site was fine: 30 page_visits in the preceding 48
 * hours and zero client errors. A monitor that reports its own blindness as
 * the thing it is watching cannot be trusted the one time it is right, and
 * this one runs unattended every six hours.
 *
 * Google's SRE book states the bar a page has to clear - "urgent, actionable,
 * and actively or imminently user-visible" - and that alert rules "should be
 * simple to understand and represent a clear failure". "I could not open a
 * socket" is a clear failure of THIS PROCESS, and naming it as such is the
 * whole fix. It is the ordinary black-box monitoring distinction: a failure of
 * the collection path is not a failure of the service.
 *
 * What it does NOT do is swallow anything. A refused connection, expired
 * certificate or NXDOMAIN on the real origin is a genuine outage and is still
 * reported and still exits non-zero - it just exits 2 and says what happened,
 * so a person reads "DNS did not resolve" rather than "eleven routes render
 * the wrong app".
 */
const UNREACHABLE = 2;

/**
 * Did THIS APP arrive from that origin, over this machine's connection?
 *
 * ── THE SECOND VERSION OF THIS FUNCTION, AND WHY THERE WAS A FIRST ────────
 *
 * The first one sent HEAD and accepted anything that was not a 5xx. Run from
 * this sandbox it printed "answered HEAD / with 403" and then cheerfully
 * reported eleven broken routes - because the 403 came from an egress proxy
 * that refuses this host, not from the site. A reachability probe that treats
 * "something answered" as "the site answered" has added a step and fixed
 * nothing, and it took running it once to see that.
 *
 * So the question is narrower and has one right answer: did the ORIGIN serve
 * the HTML shell of THIS application? A 2xx carrying `<div id="root"` is the
 * only thing that licenses the rest of this check to talk about the app. Any
 * other outcome - a socket error, a redirect to a login wall, a proxy's 403, a
 * Vercel 404 for a deleted deployment - means nothing was measured about the
 * app, and saying so is the entire job.
 *
 * It does not swallow outages. Every one of those still exits non-zero. It
 * exits 2 rather than 1 and names what happened, so a person reads "the origin
 * answered 404" instead of a twenty-two line board identical to the one the
 * real eighteen-hour outage produced.
 *
 * Google's SRE book sets the bar for anything that pages a human - "urgent,
 * actionable, and actively or imminently user-visible", and rules that
 * "represent a clear failure". This is the ordinary black-box distinction
 * underneath that: a failure of the collection path is not a failure of the
 * service, and a monitor that cannot tell them apart is not trustworthy the
 * one time it is right.
 */
async function servedThisApp(origin) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 20000);
  try {
    const res = await fetch(`${origin}/`, { signal: control.signal, redirect: 'follow' });
    // Reported whatever happens next: on a refusal these say at a glance
    // whether you are looking at the origin or at something in front of it.
    const via = ['server', 'x-vercel-id', 'x-vercel-cache', 'via']
      .map((name) => (res.headers.get(name) ? `${name}: ${res.headers.get(name)}` : null))
      .filter(Boolean)
      .join(', ') || 'no origin headers';

    if (!res.ok) return { ok: false, why: `the origin answered ${res.status} ${res.statusText} (${via})` };

    const body = await res.text();
    if (!body.includes('<div id="root"')) {
      return {
        ok: false,
        why: `${res.status} but the body is not this application's shell - no <div id="root"> (${via})`,
      };
    }
    return { ok: true, note: `${res.status}, shell served (${via})` };
  } catch (error) {
    const cause = error?.cause ?? error;
    const why = [error?.name, cause?.code, cause?.message ?? error?.message]
      .filter(Boolean)
      .filter((part, at, all) => all.indexOf(part) === at)
      .join(': ');
    return { ok: false, why: `no response at all - ${why}` };
  } finally {
    clearTimeout(timer);
  }
}

const remoteTarget = process.argv[2] ?? process.env.DEPLOY_URL ?? null;

async function main() {
  if (!remoteTarget && !(await exists(path.join(distDir, 'index.html')))) {
    console.error(`No build found at ${path.relative(repoRoot, distDir)}/index.html.`);
    console.error('Run `npm run build` first, or pass a URL to check a deployed site.');
    process.exit(1);
  }

  const chrome = await findChrome();
  if (!chrome) {
    console.error('No Chrome, Chromium or Edge binary found, so the built app cannot be loaded.');
    console.error('This check is deliberately not skippable: the two blank pages this project has');
    console.error('shipped were both invisible to every check that reads files instead of running');
    console.error('them. Install Chrome, or set CHROME_BIN to its path.');
    process.exit(1);
  }

  const pages = {};
  let origin;
  let server = null;
  if (remoteTarget) {
    // Normalized so a trailing slash or a bare host both work, and so a route
    // is appended rather than replacing a path somebody meant to keep.
    origin = new URL(remoteTarget).origin;

    const served = await servedThisApp(origin);
    if (!served.ok) {
      console.error(`NOT MEASURED: ${origin} did not serve this application to this machine.`);
      console.error(`  ${served.why}`);
      console.error('');
      console.error('Nothing below this line is a statement about whether the app works, because');
      console.error('the app was never loaded. This is still worth a look - a refused connection,');
      console.error('an expired certificate, an NXDOMAIN and a 404 for a deleted deployment all');
      console.error('land here - but it is a DIFFERENT failure from "the site loaded and is');
      console.error('broken", and it exits 2 rather than 1 so the two are never confused.');
      process.exit(UNREACHABLE);
    }
    console.log(`${origin}: ${served.note}`);
  } else {
    const served = await serveDist();
    server = served.server;
    origin = `http://127.0.0.1:${served.port}`;
  }
  /*
   * One browser for all eleven routes rather than one process each. The probe
   * is an init script, so it survives every navigation, and the pages are
   * independent of each other: nothing here logs in or leaves state behind.
   */
  const browser = await launch(chrome, {
    // Everything but loopback unreachable, which is what makes the LOCAL check
    // meaningful - the app has to mount without reaching Supabase. Exactly
    // wrong for a deployed site, where fetching it is the entire point.
    offline: !remoteTarget,
    label: 'app-mounts',
  });
  try {
    await browser.addInitScript(PROBE_JS);
    for (const route of ROUTES) {
      await browser.goto(`${origin}${route}`, { timeoutMs: MOUNT_TIMEOUT_MS });
      pages[route] = { dom: await browser.html(), report: await browser.evaluate(REPORT_JS) };
    }
  } finally {
    browser.close();
    if (server) server.close();
  }

  /*
   * ── THE INSTRUMENTATION FAILED, WHICH IS NOT THE APP FAILING ──────────────
   *
   * If the probe is missing from EVERY page, the thing that broke is this
   * script, not the site. Printing eleven identical route failures under the
   * heading "the app does not work" is precisely the over-claim that made the
   * remote mode worthless, and it would be a shame to fix it in one place and
   * reintroduce it in another.
   *
   * One route missing a probe is different and stays a route failure: that is
   * a page whose script never ran.
   */
  const uninstrumented = Object.values(pages).filter((page) => !page.report?.installed).length;
  if (uninstrumented === ROUTES.length) {
    console.error('NOT MEASURED: the probe was not installed in any of the pages.');
    console.error('  Page.addScriptToEvaluateOnNewDocument did not take effect, so nothing was');
    console.error('  asked of the application. This is a fault in this script or in the browser');
    console.error('  driving it - it is not a statement about the app, and it exits 2 to say so.');
    process.exit(UNREACHABLE);
  }

  const failures = [];
  for (const [route, page] of Object.entries(pages)) {
    for (const failure of await checkRoute(page.dom, page.report)) failures.push(`${route}: ${failure}`);
  }

  if (failures.length) {
    const what = remoteTarget ? `${new URL(remoteTarget).origin} is broken` : 'The built app does not work';
    console.error(`\n${what} in a browser (${path.basename(chrome)}):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('');
    process.exit(1);
  }

  console.log(
    remoteTarget
      ? `${ROUTES.length} route(s) mount and render on ${new URL(remoteTarget).origin}: ${ROUTES.join(', ')}`
      : `${ROUTES.length} route(s) mount and render in ${path.basename(chrome)}, with the network cut off: ${ROUTES.join(', ')}`
  );
}

await main();

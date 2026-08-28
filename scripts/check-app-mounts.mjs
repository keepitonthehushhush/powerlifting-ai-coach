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
 * inspect artefacts rather than behaviour. `vite build` succeeds - the code is
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
 * for a check that needs two page loads and a DOM read each. Chrome's own
 * `--dump-dom` prints the DOM after the page settles, which is the entire
 * feature required. Chrome is preinstalled on GitHub's ubuntu runners
 * (Ubuntu 24.04 ships Google Chrome AND Chromium), so CI needs no new step.
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
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(repoRoot, process.env.DIST_DIR ?? 'web/dist');

/** How long the page gets to mount, in virtual milliseconds. */
const BUDGET_MS = 10000;

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
 * Captures what a visitor cannot: uncaught exceptions, and whether anything
 * was ever mounted. It writes into the DOM because --dump-dom is the only
 * channel out of the browser.
 *
 * Only ErrorEvent is recorded. A failed `<script src>` or `<img>` fires a
 * plain Event during the capture phase, and with the network cut off those are
 * expected - Turnstile's loader is exactly one of them.
 */
const PROBE = [
  '<script>',
  '(function () {',
  '  var errs = [];',
  '  function write(id, text) {',
  '    var el = document.getElementById(id);',
  "    if (!el) { el = document.createElement('pre'); el.id = id; document.documentElement.appendChild(el); }",
  '    el.textContent = text;',
  '  }',
  "  function record() { write('__probe_errors', errs.join('\\n--\\n')); }",
  "  addEventListener('error', function (e) {",
  '    if (!(e instanceof ErrorEvent)) return;',
  "    errs.push(e.message + ' @ ' + e.filename + ':' + e.lineno + ':' + e.colno +",
  "      (e.error && e.error.stack ? '\\n' + e.error.stack : ''));",
  '    record();',
  '  }, true);',
  "  addEventListener('unhandledrejection', function (e) {",
  "    errs.push('unhandled rejection: ' + ((e.reason && e.reason.stack) || e.reason));",
  '    record();',
  '  });',
  '  setTimeout(function () {',
  "    var root = document.getElementById('root');",
  "    write('__probe_mounted', root ? String(root.childNodes.length) : 'NO_ROOT_ELEMENT');",
  '    if (errs.length) record();',
  `  }, ${BUDGET_MS - 2000});`,
  '})();',
  '</script>',
].join('\n');

async function exists(target) {
  try {
    await access(target, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Serves dist/ the way vercel.json does: real files win, everything else is index.html. */
async function serveDist() {
  const indexHtml = await readFile(path.join(distDir, 'index.html'), 'utf8');
  if (!indexHtml.includes('<head>')) throw new Error('index.html has no <head> to inject the probe into');
  const probed = indexHtml.replace('<head>', `<head>\n${PROBE}`);

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
 * Chrome, wherever this machine keeps it. Deliberately NOT skippable: a check
 * that quietly does not run is how the last two blank pages reached
 * production. Set CHROME_BIN if it lives somewhere unusual.
 */
async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);

  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return null;
}

function dumpDom(chrome, url) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox', // CI containers run as root, and there is no untrusted content here.
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        // Everything but loopback is unreachable. See the header comment.
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        `--virtual-time-budget=${BUDGET_MS}`,
        '--dump-dom',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Chrome did not exit within 60s.\n${err}`));
    }, 60000);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`Chrome exited ${code}.\n${err}`));
      else resolve(out);
    });
  });
}

/** Pulls the text of one <pre> the probe wrote. */
function probeValue(dom, id) {
  const match = dom.match(new RegExp(`<pre id="${id}">([\\s\\S]*?)</pre>`));
  return match ? match[1] : null;
}

function decodeEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * An i18n key that reached the screen.
 *
 * `t()` returns the key itself when the lookup misses, so a miss renders as a
 * label and nothing fails. That is how a duplicate `password:` in en.js - one
 * a string, one an object, the object silently winning - put the literal text
 * "auth.password" on the sign-in page of a live product.
 *
 * The namespaces are read out of the locale file so this cannot drift from it.
 */
async function untranslatedKeys(dom) {
  const en = await readFile(path.join(repoRoot, 'web/src/i18n/locales/en.js'), 'utf8');
  const namespaces = [...en.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9_]*): \{$/gm)].map((match) => match[1]);
  if (namespaces.length === 0) {
    throw new Error('found no top-level namespaces in en.js - has the shape of the locale file changed?');
  }

  // Visible text only: attributes legitimately contain dotted names.
  const text = decodeEntities(
    dom
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  );

  const pattern = new RegExp(`(?:^|\\s)((?:${namespaces.join('|')})(?:\\.[a-zA-Z][a-zA-Z0-9_]*)+)`, 'g');
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))];
}

/**
 * The routes worth loading.
 *
 * `/` was the only one until it stopped being the sign-in page. When the
 * landing page took the root, this check silently stopped exercising the
 * screen with the auth code and the third-party CAPTCHA widget on it - the
 * most breakable page in the app - and nothing would have said so. Two page
 * loads, a few seconds.
 */
const ROUTES = ['/', '/login'];

/** Everything a file cannot tell you, asked of one rendered page. */
async function checkRoute(dom) {
  const failures = [];

  const errors = probeValue(dom, '__probe_errors');
  if (errors) failures.push(`the page threw:\n${decodeEntities(errors).replace(/^/gm, '        ')}`);

  const mounted = probeValue(dom, '__probe_mounted');
  if (mounted === null) failures.push('the probe never ran - the page did not reach its first timer.');
  else if (mounted === 'NO_ROOT_ELEMENT') failures.push('index.html has no #root for React to mount into.');
  else if (Number(mounted) === 0) failures.push('#root is empty: React mounted nothing.');

  if (!dom.includes('Coach Diaz')) {
    failures.push('the rendered page does not contain "Coach Diaz" - something mounted, but not this app.');
  }

  // ErrorBoundary's fallback links here. Reaching it means the app rendered
  // its apology instead of itself, which a child count cannot tell apart from
  // success.
  if (dom.includes('/maintenance.html')) {
    failures.push('the ErrorBoundary fallback rendered: a component threw during its first render.');
  }

  const leaked = await untranslatedKeys(dom);
  if (leaked.length) {
    failures.push(`untranslated i18n keys rendered as visible text: ${leaked.join(', ')}`);
  }

  return failures;
}

async function main() {
  if (!(await exists(path.join(distDir, 'index.html')))) {
    console.error(`No build found at ${path.relative(repoRoot, distDir)}/index.html.`);
    console.error('Run `npm run build` first.');
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

  const { server, port } = await serveDist();
  const doms = {};
  try {
    for (const route of ROUTES) {
      doms[route] = await dumpDom(chrome, `http://127.0.0.1:${port}${route}`);
    }
  } finally {
    server.close();
  }

  const failures = [];
  for (const [route, dom] of Object.entries(doms)) {
    for (const failure of await checkRoute(dom)) failures.push(`${route}: ${failure}`);
  }

  if (failures.length) {
    console.error(`\nThe built app does not work in a browser (${path.basename(chrome)}):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('');
    process.exit(1);
  }

  console.log(
    `${ROUTES.length} route(s) mount and render in ${path.basename(chrome)}, with the network cut off: ${ROUTES.join(', ')}`
  );
}

await main();

#!/usr/bin/env node
/**
 * Did the stylesheet change what anything on the screen actually looks like?
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Every CSS check this repository owns reads the stylesheet as TEXT - the zoom
 * guard brace-matches a rule, the American-English guard greps comments. None
 * of them can answer the only question a refactor of styles.css raises: after
 * this change, is any element on the page a different color, size or weight
 * than it was before?
 *
 * That question became urgent with cascade layers. `@layer` deliberately
 * rewrites precedence - an unlayered rule beats every layered one regardless
 * of specificity - so wrapping an existing 2,200-line stylesheet in layers can
 * silently invert which of two rules wins. The failure is not an error. It is
 * a button that is quietly the wrong color on one page.
 *
 * So this renders the real built app in a real browser and reads
 * getComputedStyle off a fixed list of elements, comparing to a committed
 * snapshot. Computed styles rather than screenshots on purpose: a screenshot
 * diff is flaky across machines because font rasterisation differs between
 * macOS and an ubuntu runner, and it tells you a rectangle changed rather than
 * which declaration did it. A computed value is deterministic and names itself.
 *
 * ── THE TRAP THIS CHECK MUST NOT FALL INTO ────────────────────────────────
 *
 * An empty snapshot compares equal to an empty snapshot. If the page failed to
 * render, every selector would miss, nothing would differ, and this would
 * report success having looked at nothing - which is this project's recurring
 * defect exactly. So coverage is asserted first: a minimum number of selectors
 * must have matched, and any selector that matched when the snapshot was taken
 * and misses now is a failure in its own right rather than a skipped entry.
 *
 * ── THE BASELINE IS PLATFORM-SPECIFIC, AND THAT IS FINE ───────────────────
 *
 * Computed values depend on the browser and the fonts installed beside it, so
 * a baseline recorded on one machine is only meaningful when compared on a
 * machine like it. This one is recorded on Linux and verified in CI on Linux,
 * which is the environment that gates a merge. Running it on macOS may report
 * differences that are the platform rather than the stylesheet; that is not a
 * bug in the check, it is what the check is measuring.
 *
 * The strongest way to use it is not against the committed baseline at all: it
 * is to record, make a change, and re-run on the SAME machine in one sitting.
 * Then every difference is unambiguously yours. That is what it was written
 * for - a cascade refactor with no other way to see what it did.
 *
 * Usage:  node scripts/check-computed-styles.mjs
 *         node scripts/check-computed-styles.mjs --update   (re-record baseline)
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(repoRoot, process.env.DIST_DIR ?? 'web/dist');
const snapshotPath = path.join(repoRoot, 'scripts/computed-styles.snapshot.json');
const BUDGET_MS = 10000;

/**
 * What gets measured, and where.
 *
 * Two routes, because they exercise different halves of the stylesheet and a
 * cascade change rarely breaks both. The landing page is all typography and
 * layout; the sign-in page is where the form controls live, which is where a
 * precedence inversion does the most visible damage.
 *
 * Both render without signing in - the browser has no network and cannot reach
 * Supabase, which is the point: this is also what a visitor behind a corporate
 * filter sees.
 */
const ROUTES = ['/', '/login'];

const WATCHED = [
  // structure and ground
  'body', '.home', '.home-hero', '.home-section', '.home-footer', '.centered',
  // typography
  'h1', 'h2', 'h3', 'p', 'li',
  '.home-headline', '.home-subhead', '.home-h2', '.home-h3',
  '.muted', '.small', '.fineprint', '.home-fineprint',
  // brand
  '.wordmark', '.wordmark-text', '.brand',
  // actions and links
  '.cta', 'a', '.home-link', '.link', 'button', 'button.primary',
  // the sign-in page: form controls, where a cascade inversion shows first
  '.card', '.auth-card', 'input', 'label', 'select', '.stack',
  '.checklist li', '.turnstile', '.auth-alternative',
];

/** The properties worth pinning. Layout and color, not everything. */
const PROPS = [
  'color', 'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderRadius',
  'fontSize', 'fontWeight', 'lineHeight', 'fontFamily',
  'paddingTop', 'paddingLeft', 'marginTop', 'gap', 'display',
  'boxShadow', 'opacity', 'textDecorationLine', 'letterSpacing',
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

/**
 * Design tokens that no element on these two routes happens to use.
 *
 * Added after the elevation tokens shipped and this check reported OK without
 * having looked at them - the floating elements they style live on pages that
 * need a session. A token defined with nested color-mix() that fails to parse
 * computes to `none` silently, so "the check passed" would have meant nothing.
 *
 * Each entry is applied to a throwaway element and its computed value read
 * back, which is the only way to prove a token resolves rather than merely
 * exists in the stylesheet.
 */
const SYNTHETIC = [
  { name: 'token:--elev-1', property: 'boxShadow', declaration: 'box-shadow: var(--elev-1)' },
  { name: 'token:--elev-2', property: 'boxShadow', declaration: 'box-shadow: var(--elev-2)' },
  { name: 'token:--elev-tint', property: 'backgroundColor', declaration: 'background-color: var(--elev-tint)' },
  // The plate colors. Fixed rather than themed - they are the IPF's, not ours -
  // and written in oklch(), so a browser that cannot parse them would draw a
  // barbell of invisible discs with nothing anywhere reporting a problem.
  { name: 'token:--plate-red', property: 'backgroundColor', declaration: 'background-color: var(--plate-red)' },
  { name: 'token:--plate-blue', property: 'backgroundColor', declaration: 'background-color: var(--plate-blue)' },
  { name: 'token:--plate-yellow', property: 'backgroundColor', declaration: 'background-color: var(--plate-yellow)' },
  { name: 'token:--plate-green', property: 'backgroundColor', declaration: 'background-color: var(--plate-green)' },
  { name: 'token:--plate-black', property: 'backgroundColor', declaration: 'background-color: var(--plate-black)' },
  { name: 'token:--steel-mid', property: 'backgroundColor', declaration: 'background-color: var(--steel-mid)' },
];

/**
 * ── FORCING THE COLOR SCHEME, AND WHY NOT WITH A CHROME FLAG ──────────────
 *
 * The first version passed --force-prefers-color-scheme and recorded "two
 * color schemes". Measured, that flag does nothing in this Chromium build -
 * prefers-color-scheme: light matched under `=dark`, under `=light`, and with
 * no flag at all. So the dark and light captures came back byte-identical and
 * the check was reporting twice the coverage it had, which is precisely the
 * defect it exists to catch, committed by the check itself.
 *
 * matchMedia is stubbed instead, before the bundle loads. That is the right
 * seam rather than a workaround: applyTheme.js decides the mode by calling
 * window.matchMedia('(prefers-color-scheme: light)'), and its header explains
 * that inline custom properties beat the stylesheet's media query by
 * specificity, so once a theme is painted the app owns light and dark outright
 * and the CSS media block is not load-bearing. Controlling matchMedia controls
 * the thing the app actually reads.
 */
const PROBE = `<script>
(function () {
  var force = new URLSearchParams(location.search).get('__scheme') === 'dark' ? 'dark' : 'light';
  var real = window.matchMedia ? window.matchMedia.bind(window) : null;
  window.matchMedia = function (query) {
    if (/prefers-color-scheme/.test(query)) {
      var wantsLight = /light/.test(query);
      return {
        matches: force === 'light' ? wantsLight : !wantsLight,
        media: query, onchange: null,
        addEventListener: function () {}, removeEventListener: function () {},
        addListener: function () {}, removeListener: function () {},
        dispatchEvent: function () { return false; },
      };
    }
    return real ? real(query) : { matches: false, media: query, addEventListener: function () {},
      removeEventListener: function () {}, addListener: function () {}, removeListener: function () {} };
  };
})();
</script>
<script>
(function () {
  var WATCHED = ${JSON.stringify(WATCHED)};
  var PROPS = ${JSON.stringify(PROPS)};
  var SYNTHETIC = ${JSON.stringify(SYNTHETIC)};

  /*
   * WAIT FOR THE PAINT, DO NOT GUESS AT IT.
   *
   * The first version read styles on a fixed timer and was flaky, which is
   * worse than not checking: it reported .home-link as light-mode muted in a
   * dark capture, because applyTheme had not yet written its inline custom
   * properties onto the root element. The stylesheet's own
   * prefers-color-scheme block was still answering, so the page was caught
   * mid-dress.
   *
   * applyTheme sets --text inline on documentElement and stamps data-theme
   * when it is done, so that pair is the readiness signal the app already
   * publishes. Poll for it, and FAIL rather than capture if it never arrives -
   * a snapshot of an unpainted page is not a smaller truth, it is a wrong one.
   */
  function painted() {
    var root = document.documentElement;
    return Boolean(root.getAttribute('data-theme')) &&
      root.style.getPropertyValue('--text').trim() !== '' &&
      document.getElementById('root') &&
      document.getElementById('root').childNodes.length > 0;
  }

  /*
   * FREEZE BEFORE MEASURING.
   *
   * getComputedStyle returns the INTERPOLATED value while a transition is
   * running, not the destination. .home-link carries
   * a 120ms color transition, so applying the theme starts a fade
   * from the stylesheet's pre-paint color to the painted one - and a
   * measurement taken inside that window reads a value that depends on how
   * busy the machine was. That is what made this check flap between
   * rgb(93, 84, 112) and rgb(168, 158, 196) on the same build.
   *
   * Transitions and animations are switched off, then a layout is forced so
   * the new rule is in effect, and only then is anything read. The values
   * recorded are destinations rather than moments.
   */
  function freeze() {
    var style = document.createElement('style');
    style.textContent =
      '*, *::before, *::after {' +
      ' transition: none !important;' +
      ' animation: none !important;' +
      ' caret-color: transparent !important; }';
    document.head.appendChild(style);
    // Reading offsetHeight forces the style and layout to be recomputed now.
    void document.documentElement.offsetHeight;
  }

  function capture() {
    freeze();
    var out = {};
    for (var s = 0; s < SYNTHETIC.length; s++) {
      var probe = document.createElement('div');
      probe.style.cssText = SYNTHETIC[s].declaration;
      document.body.appendChild(probe);
      var value = getComputedStyle(probe)[SYNTHETIC[s].property];
      probe.remove();
      var row = {};
      row[SYNTHETIC[s].property] = value;
      out[SYNTHETIC[s].name] = row;
    }
    for (var i = 0; i < WATCHED.length; i++) {
      var el = document.querySelector(WATCHED[i]);
      if (!el) continue;
      var cs = getComputedStyle(el);
      var row2 = {};
      for (var j = 0; j < PROPS.length; j++) row2[PROPS[j]] = cs[PROPS[j]];
      out[WATCHED[i]] = row2;
    }
    return out;
  }

  function write(id, text) {
    var pre = document.createElement('pre');
    pre.id = id;
    pre.textContent = text;
    document.documentElement.appendChild(pre);
  }

  var waited = 0;
  var STEP = 50;
  var LIMIT = ${BUDGET_MS - 2500};
  (function poll() {
    if (painted()) {
      /*
       * A short settle before measuring, so any style recalculation the paint
       * queued has run. Deliberately setTimeout and not requestAnimationFrame:
       * under --virtual-time-budget rAF does not fire, so the first version of
       * this gate wrote nothing at all and reported "did the app mount?" three
       * runs in a row against an app that had mounted perfectly.
       */
      setTimeout(function () { write('__styles', JSON.stringify(capture())); }, 100);
      return;
    }
    waited += STEP;
    if (waited >= LIMIT) {
      write('__unpainted', 'data-theme=' + document.documentElement.getAttribute('data-theme') +
        ' --text=' + JSON.stringify(document.documentElement.style.getPropertyValue('--text')));
      return;
    }
    setTimeout(poll, STEP);
  })();
})();
</script>`;

async function exists(target) {
  try { await access(target, constants.R_OK); return true; } catch { return false; }
}

async function serveDist() {
  const indexHtml = await readFile(path.join(distDir, 'index.html'), 'utf8');
  if (!indexHtml.includes('<head>')) throw new Error('index.html has no <head> to inject the probe into');
  const probed = indexHtml.replace('<head>', `<head>\n${PROBE}`);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = path.resolve(distDir, rel);
    if (!filePath.startsWith(distDir)) { res.writeHead(403).end(); return; }
    if (rel && (await exists(filePath))) {
      try {
        const body = await readFile(filePath);
        res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
        res.end(body);
        return;
      } catch { /* a directory - fall through */ }
    }
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(probed);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN, process.env.CHROMIUM_BIN,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return null;
}

function dumpDom(chrome, url) {
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      '--window-size=1280,900',
      `--virtual-time-budget=${BUDGET_MS}`, '--dump-dom', url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Chrome did not exit within 60s.\n${err}`)); }, 60000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`Chrome exited ${code}.\n${err}`));
      else resolve(out);
    });
  });
}

function decodeEntities(v) {
  return v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function readProbe(dom) {
  const unpainted = dom.match(/<pre id="__unpainted">([\s\S]*?)<\/pre>/);
  if (unpainted) {
    throw new Error(
      `the app never finished painting its theme, so nothing was measured.\n  ${decodeEntities(unpainted[1])}`,
    );
  }
  const match = dom.match(/<pre id="__styles">([\s\S]*?)<\/pre>/);
  if (!match) return null;
  try { return JSON.parse(decodeEntities(match[1])); } catch { return null; }
}

/** Fewer than this many matched selectors means the page did not really render. */
const MIN_COVERAGE = 8;

async function main() {
  const update = process.argv.includes('--update');

  if (!(await exists(path.join(distDir, 'index.html')))) {
    console.error(`No build at ${distDir}. Run \`npm run build\` first.`);
    process.exit(1);
  }
  const chrome = await findChrome();
  if (!chrome) {
    console.error('Could not find Chrome. Set CHROME_BIN.');
    console.error('This check is deliberately not skippable: a check that quietly does not run');
    console.error('is indistinguishable from one that passed.');
    process.exit(1);
  }

  const { server, port } = await serveDist();
  const captured = {};
  try {
    for (const scheme of ['dark', 'light']) {
      for (const route of ROUTES) {
        const key = `${scheme} ${route}`;
        const dom = await dumpDom(chrome, `http://127.0.0.1:${port}${route}?__scheme=${scheme}`);
        const styles = readProbe(dom);
        if (!styles) throw new Error(`the probe wrote nothing for ${key} - did the app mount?`);
        captured[key] = styles;
      }
    }
  } finally {
    server.close();
  }

  // The two schemes must actually DIFFER. If they are identical the matchMedia
  // stub has stopped working and half these captures are measuring nothing -
  // which is how the first version of this check inflated its own coverage.
  for (const route of ROUTES) {
    const a = JSON.stringify(captured[`dark ${route}`]);
    const b = JSON.stringify(captured[`light ${route}`]);
    if (a === b) {
      console.error(`FAIL  the dark and light captures of ${route} are identical.`);
      console.error('      The color scheme is not being forced, so one of them is measuring');
      console.error('      nothing. Fix the stub rather than lowering the expectation.');
      process.exit(1);
    }
  }

  // A token that failed to parse computes to `none` or an empty string. That is
  // the failure this section exists for, and it must be named rather than
  // quietly recorded as the new baseline.
  const dead = [];
  for (const [key, styles] of Object.entries(captured)) {
    for (const synthetic of SYNTHETIC) {
      const row = styles[synthetic.name];
      if (!row) { dead.push(`${key}  ${synthetic.name}  was not captured at all`); continue; }
      const value = row[synthetic.property];
      if (!value || value === 'none' || value === 'rgba(0, 0, 0, 0)') {
        dead.push(`${key}  ${synthetic.name}  resolved to "${value}" - the token does not parse`);
      }
    }
  }
  if (dead.length) {
    console.error('FAIL  a design token did not resolve:\n');
    for (const d of dead) console.error(`  ${d}`);
    process.exit(1);
  }

  // COVERAGE FIRST. An empty capture must never read as "nothing changed".
  for (const [key, styles] of Object.entries(captured)) {
    const found = Object.keys(styles).length;
    if (found < MIN_COVERAGE) {
      console.error(`FAIL  only ${found} of ${WATCHED.length} selectors matched on ${key}.`);
      console.error('      The page did not render enough to compare. This is a failure, not a pass.');
      process.exit(1);
    }
  }

  if (update) {
    await writeFile(snapshotPath, `${JSON.stringify(captured, null, 2)}\n`);
    for (const [key, styles] of Object.entries(captured)) {
      console.log(`recorded ${Object.keys(styles).length} selectors on ${key}`);
    }
    console.log(`baseline written to ${path.relative(repoRoot, snapshotPath)}`);
    return;
  }

  if (!(await exists(snapshotPath))) {
    console.error(`No baseline at ${path.relative(repoRoot, snapshotPath)}. Run with --update.`);
    process.exit(1);
  }
  const baseline = JSON.parse(await readFile(snapshotPath, 'utf8'));

  const problems = [];
  for (const key of Object.keys(baseline)) {
    const was = baseline[key];
    const now = captured[key];
    if (!now) {
      problems.push(`${key}  was in the baseline and was not captured at all`);
      continue;
    }
    for (const selector of Object.keys(was)) {
      if (!(selector in now)) {
        problems.push(`${key}  ${selector}  matched when the baseline was taken and matches nothing now`);
        continue;
      }
      for (const prop of Object.keys(was[selector])) {
        const a = was[selector][prop];
        const b = now[selector][prop];
        if (a !== b) problems.push(`${key}  ${selector}  ${prop}\n        was: ${a}\n        now: ${b}`);
      }
    }
  }

  if (problems.length) {
    console.error(`FAIL  ${problems.length} computed style(s) changed:\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nIf these changes are intended, re-record with:');
    console.error('  npm run check:styles -- --update');
    process.exit(1);
  }

  const n = Object.values(captured).reduce((sum, s2) => sum + Object.keys(s2).length, 0);
  console.log(`OK  ${n} element captures x ${PROPS.length} properties unchanged, across ${Object.keys(captured).length} page/scheme combinations.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});

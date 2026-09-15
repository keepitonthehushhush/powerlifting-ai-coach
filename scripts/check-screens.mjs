#!/usr/bin/env node
/**
 * Eighteen screens, at the width they are used at, asked the four questions a
 * stylesheet cannot answer about itself.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 *
 * The other rendered checks each ask one narrow question of a few pages:
 * check-app-mounts asks "does anything appear" of the eleven routes a
 * signed-out browser can reach, check-computed-styles compares values at
 * 1280px, check-scroll-cues presses buttons on four screens. Nothing looked at
 * every screen and asked whether it is a thing a person can use.
 *
 * So this walks the review harness - which mounts all eighteen signed-in
 * screens with the network replaced by fixtures - at 390px with touch
 * emulation on, and asserts four properties that are cheap to measure, easy to
 * regress, and each of which has been broken here before:
 *
 *   1. ONE h1, and no skipped heading level. A screen reader's outline is the
 *      only table of contents a blind reader gets, and `h2 -> h4` tells them a
 *      section is missing.
 *
 *   2. NO TARGET UNDER 24x24 CSS PIXELS. WCAG 2.5.8 at AA. Its INLINE
 *      exception is honored - a link inside a sentence is exempt and is
 *      skipped here - which is exactly the distinction that let two 23px
 *      policy-footer links sit under the floor on five screens until this was
 *      pointed at them.
 *
 *   3. NO SIDEWAYS PAGE SCROLL. Boxes may scroll; the document may not.
 *
 *   4. NO TRANSLATION KEY RENDERED AS TEXT. `t()` returns the key on a miss,
 *      so a missing string is not an error and not a blank - it is the literal
 *      `activity.action.clearance_asserted` on the page, which is what every
 *      athlete who had confirmed medical clearance actually saw. Eight rows in
 *      production, which was every row that card had ever had.
 *
 * ── AND THE GAP IT CLOSES ─────────────────────────────────────────────────
 *
 * check-app-mounts has had the key detector for a year and found nothing,
 * because a signed-out browser cannot reach the page the bug was on. Its own
 * header says so: "the account page itself still cannot be checked here... a
 * real remaining gap and is named in the list below rather than left to be
 * rediscovered." This is the thing that checks it.
 *
 * Usage:  node scripts/check-screens.mjs
 */

import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from './lib/browser.mjs';
import { untranslatedKeys } from './lib/i18nLeak.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harnessDir = path.resolve(repoRoot, process.env.HARNESS_DIR ?? 'web/harness-dist');
const localePath = path.join(repoRoot, 'web/src/i18n/locales/en.js');

/**
 * Every screen the harness mounts. Kept in step with HARNESS_PAGES in
 * check-computed-styles.mjs, and asserted against it by a test, because two
 * lists of one fact is how one of them quietly stops covering something.
 */
const SCREENS = [
  'home', 'login', 'coach', 'program', 'log', 'progress', 'library',
  'leaderboard', 'account', 'intake', 'faq', 'terms', 'privacy', 'health',
  'ai', 'lbpolicy', 'clinician', 'consent',
];

/** 390px is an iPhone 14/15/16. Touch, because a narrow window is not a phone. */
const VIEWPORT = { width: 390, height: 900, touch: true };

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

const exists = (p) => access(p, constants.F_OK).then(() => true, () => false);

async function serve(root) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      const body = await readFile(path.join(root, url.pathname));
      res.writeHead(200, { 'content-type': MIME[path.extname(url.pathname)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(await readFile(path.join(root, 'index.html')));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

/** Runs in the page. Returns findings rather than throwing, so one run says everything. */
const AUDIT = `
  const fail = [];
  if (document.querySelector('[data-error-boundary]')) {
    return { fail: ['the error boundary rendered, so nothing here was measured'], measured: 0 };
  }

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // ── 1. the outline ──────────────────────────────────────────────────────
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
  const levels = headings.map((h) => Number(h.tagName[1]));
  const h1s = levels.filter((l) => l === 1).length;
  if (h1s !== 1) fail.push('this screen has ' + h1s + ' visible h1 elements, not 1');
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] - levels[i - 1] > 1) {
      fail.push('heading level jumps h' + levels[i - 1] + ' -> h' + levels[i] +
        ' at "' + headings[i].textContent.trim().slice(0, 40) + '"');
    }
  }

  // ── 2. target size, with SC 2.5.8's inline exception ────────────────────
  const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="tab"]')]
    .filter(visible);
  let checked = 0;
  for (const el of controls) {
    // A link inside a sentence or a block of text is exempt. An anchor that is
    // NOT in running text is a standalone control and is not.
    if (el.tagName === 'A' && el.closest('p, li, figcaption')) continue;
    // The target is what you press: for a control inside a label, the label.
    const target = el.closest('label') ?? el;
    const r = target.getBoundingClientRect();
    checked += 1;
    if (r.width < 24 || r.height < 24) {
      const name = (el.textContent || el.getAttribute('aria-label') || el.type || el.tagName).trim();
      fail.push('"' + name.slice(0, 32) + '" is ' + Math.round(r.width) + 'x' + Math.round(r.height) +
        ', under the 24x24 WCAG 2.5.8 asks for at AA');
    }
  }

  // ── 3. the document itself must not scroll sideways ─────────────────────
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth) {
    fail.push('the PAGE scrolls sideways by ' + (doc.scrollWidth - doc.clientWidth) + 'px');
  }

  return { fail, measured: checked, headings: headings.length };
`;

async function main() {
  if (!(await exists(path.join(harnessDir, 'index.html')))) {
    console.error(`No review harness at ${harnessDir}. Run \`npm run build:harness\` first.`);
    console.error('This check is deliberately not skippable: a check that quietly does not run');
    console.error('is indistinguishable from one that passed.');
    process.exit(1);
  }
  const chromePath = await findChrome();
  if (!chromePath) {
    console.error('Could not find Chrome. Set CHROME_BIN.');
    process.exit(1);
  }

  const { server, port } = await serve(harnessDir);
  const page = await launch(chromePath, { ...VIEWPORT, offline: true, label: 'screens' });

  let failures = 0;
  let screensSeen = 0;
  let targetsChecked = 0;

  try {
    for (const id of SCREENS) {
      const query = `?page=${id}&mode=full${id === 'login' ? '&auth=out' : ''}`;
      await page.goto(`http://127.0.0.1:${port}/${query}`);

      const report = await page.evaluate(AUDIT);
      const dom = await page.html();
      const leaked = await untranslatedKeys(dom, localePath);

      screensSeen += 1;
      targetsChecked += report.measured ?? 0;

      for (const line of report.fail) {
        console.error(`FAIL ${id}: ${line}`);
        failures += 1;
      }
      if (leaked.length) {
        console.error(`FAIL ${id}: translation keys rendered as visible text: ${leaked.join(', ')}`);
        failures += 1;
      }
    }
  } finally {
    page.close();
    server.close();
  }

  /*
   * The trap every check in this repository has fallen into once: an empty run
   * compares equal to a clean one. Both floors are asserted rather than
   * assumed - a harness that stopped rendering controls would otherwise report
   * eighteen silent passes.
   */
  if (screensSeen !== SCREENS.length) {
    console.error(`FAIL: ${screensSeen} of ${SCREENS.length} screens were reached`);
    failures += 1;
  }
  if (targetsChecked < 40) {
    console.error(`FAIL: only ${targetsChecked} targets were measured across ${screensSeen} screens, ` +
      'which is too few to be true - the harness is rendering something other than the app');
    failures += 1;
  }

  if (failures) {
    console.error(`\n${failures} problem${failures === 1 ? '' : 's'} across ${screensSeen} screens.`);
    process.exit(1);
  }
  console.log(
    `OK   ${screensSeen} screens at ${VIEWPORT.width}px (touch): one h1 each, no skipped heading level, ` +
    `${targetsChecked} targets all at least 24x24, no sideways page scroll, no untranslated keys.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

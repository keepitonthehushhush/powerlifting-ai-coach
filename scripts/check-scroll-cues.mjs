#!/usr/bin/env node
/**
 * Does every box that scrolls sideways say so, and does the control that says
 * so actually work?
 *
 * ── WHY THIS IS A SEPARATE CHECK ──────────────────────────────────────────
 *
 * `check-computed-styles.mjs` renders the whole application and compares
 * computed values against a committed snapshot. It is the strongest net this
 * repository has and it could not have caught the defect this file exists for,
 * for two reasons:
 *
 *   1. It renders at 1280x900. The program table does not overflow above
 *      414px, so at the only width that check looks at there is nothing to
 *      indicate and nothing to indicate it with. The bug was invisible to it
 *      by construction - "it cuts off after reps" happens at 320 and 360.
 *
 *   2. A snapshot compares values. It cannot press a button. A cue that says
 *      "Scroll for more" and does nothing when pressed has exactly the same
 *      computed styles as one that works, and while writing this affordance I
 *      produced that result twice - once for real, once because the probe
 *      canceled the smooth scroll it was measuring. Both times the styles
 *      were correct and the control was a lie.
 *
 * So this one drives a real browser over the DevTools protocol, which is the
 * only way to get TOUCH emulation. A 390px-wide desktop Chrome still reports
 * `hover: hover` and `pointer: fine`; a narrow window is not a phone, and this
 * project has already withdrawn one review finding for believing that it was.
 *
 * No dependencies: node 22 ships a WebSocket client, and CDP is JSON over one.
 *
 * Usage:  node scripts/check-scroll-cues.mjs
 */

import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from './lib/browser.mjs';
import { THEME_IDS, MODES, tokensFor } from '../web/src/lib/themes.js';
import { contrast, AA_TEXT, AA_NON_TEXT } from '../web/src/lib/contrast.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harnessDir = path.resolve(repoRoot, process.env.HARNESS_DIR ?? 'web/harness-dist');

/**
 * The widths are not decoration. Measured on the real program screen before
 * this affordance existed:
 *
 *   320px  the WEIGHT column is clipped by 16px and LOGGED is entirely off
 *   360px  LOGGED is clipped by 39px
 *   390px  LOGGED is clipped by 11px
 *   1280px nothing overflows, so nothing may be indicated
 *
 * The last one is as important as the first three. An affordance that is
 * always on is the same defect as one that is never on: the navigation shipped
 * a permanent fade once and it read as a tab hiding behind a wall.
 */
/**
 * ── EVERY SCREEN WITH A SIDEWAYS BOX ON IT, NOT JUST THE ONE REPORTED ─────
 *
 * This checked `program` only, which is the page the defect was reported on.
 * Four more boxes scroll sideways in this application and none of them said
 * so: the leaderboard's board, the progress table, the coach's own tables in
 * the transcript, and the week strip.
 *
 * `overflows` is what each page is expected to hide at phone width. It is an
 * assertion in both directions - a page listed as scrolling that stops
 * scrolling has had its fixture emptied, which is the failure that makes every
 * other line here vacuous.
 */
const PAGES = [
  { id: 'program', overflows: true },
  /*
   * FALSE, and this line is the record of why. The board DID overflow - 376px
   * inside a 309px card at 390px - and what was off the right edge was the
   * BEST column, which is the number a leaderboard exists to show. The fix was
   * not a cue. Ranks are two characters and weights are a fixed shape, so both
   * are held to their content and the NAME column gives instead; the board now
   * fits at 320px with nothing hidden.
   *
   * Left in the sweep with `overflows: false` rather than removed, because the
   * other half of the audit still applies and is worth holding: a box that
   * hides nothing must have no fade, no cue and no tab stop. This check
   * reported the change itself - "either the table got narrower, in which case
   * say so here" - which is the line it was written to produce.
   */
  { id: 'leaderboard', overflows: false },
  /*
   * The progress table is behind a "Show table" toggle, so on load this page
   * has no scrolling box at all - which the sweep correctly reported as a
   * failure the first time it ran, and which would have been silently skipped
   * by a check that only looked at what happens to be on screen. `reveal` is
   * pressed first. Named rather than guessed at, because a selector that stops
   * matching has to fail loudly instead of quietly auditing nothing.
   */
  { id: 'progress', overflows: true, reveal: 'button.link' },
  { id: 'coach', overflows: true },
];

const VIEWPORTS = [
  { width: 320, height: 800, touch: true, expectOverflow: true },
  { width: 360, height: 800, touch: true, expectOverflow: true },
  { width: 390, height: 844, touch: true, expectOverflow: true, sweepThemes: true },
  { width: 1280, height: 900, touch: false, expectOverflow: false },
];

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
      // A client-rendered app: anything that is not a file is the shell.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(await readFile(path.join(root, 'index.html')));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

/**
 * Everything below runs inside the page. It returns findings rather than
 * throwing, so one run reports every fault instead of the first one.
 */
const AUDIT = `
  const fail = [];
  const note = [];
  if (document.querySelector('[data-error-boundary]')) {
    return { fail: ['the page rendered its error boundary, so nothing here was measured'], note };
  }

  const regions = [...document.querySelectorAll('.scroll-region')];
  if (!regions.length) return { fail: ['no .scroll-region on the program page at all'], note };

  let overflowing = 0;
  for (const region of regions) {
    const box = region.querySelector('[data-fade]');
    const cue = region.querySelector('.scroll-cue');
    if (!box) { fail.push('a .scroll-region has no measured box inside it'); continue; }

    const name = box.className;
    const slack = box.scrollWidth - box.clientWidth;
    const scrolls = slack > 1;
    const masked = getComputedStyle(box).maskImage !== 'none';

    if (scrolls) {
      overflowing += 1;
      if (box.dataset.fade === 'none') fail.push(name + ' hides ' + slack + 'px and reports data-fade="none"');
      if (!masked) fail.push(name + ' hides ' + slack + 'px and its cut edge is not faded');
      if (!cue) fail.push(name + ' hides ' + slack + 'px with no cue saying so');
      if (cue && !cue.textContent.trim()) fail.push(name + ' has a cue with no words in it');
      if (cue && !cue.querySelector('svg')) fail.push(name + ' has a cue with no arrow in it');
    } else {
      if (box.dataset.fade !== 'none') fail.push(name + ' hides nothing and reports data-fade="' + box.dataset.fade + '"');
      if (masked) fail.push(name + ' hides nothing and is faded anyway');
      if (cue) fail.push(name + ' hides nothing and offers to scroll it anyway');
      if (box.getAttribute('tabindex') !== null) fail.push(name + ' hides nothing and is still a tab stop');
    }

    // A table has nothing inside it to tab to, so the box itself has to be
    // reachable or its hidden columns are unreachable by keyboard.
    if (box.getAttribute('role') === 'region') {
      const labeledBy = box.getAttribute('aria-labelledby');
      const named = labeledBy ? document.getElementById(labeledBy)?.textContent.trim() : box.getAttribute('aria-label');
      if (!named) fail.push(name + ' is a region with no accessible name');
      if (scrolls && box.getAttribute('tabindex') !== '0') fail.push(name + ' scrolls and cannot be focused');
      note.push(name + ' named "' + named + '"');
    }
  }

  // The part a computed-style snapshot cannot do: press it.
  for (const region of regions) {
    const box = region.querySelector('[data-fade]');
    const cue = region.querySelector('.scroll-cue');
    if (!cue || box.scrollWidth - box.clientWidth <= 1) continue;
    const before = box.scrollLeft;
    const firstWords = cue.textContent.trim();
    cue.click();
    await new Promise((r) => setTimeout(r, 900));
    if (box.scrollLeft === before) {
      fail.push(box.className + ' offers "' + firstWords + '" and pressing it moved nothing');
      continue;
    }
    // At the far end the control must still be there and must now go back,
    // because a control that disappears under the finger takes focus with it.
    box.scrollLeft = box.scrollWidth;
    await new Promise((r) => setTimeout(r, 400));
    const back = region.querySelector('.scroll-cue');
    if (!back) { fail.push(box.className + ' loses its control at the right-hand end'); continue; }
    if (back.textContent.trim() === firstWords) {
      fail.push(box.className + ' still says "' + firstWords + '" with nothing left to scroll to');
    }
    const returned = back.cloneNode(true);
    back.click();
    await new Promise((r) => setTimeout(r, 900));
    if (box.scrollLeft !== 0) fail.push(box.className + ' offers "' + returned.textContent.trim() + '" and did not return');
    box.scrollLeft = 0;
  }

  if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
    fail.push('the PAGE scrolls sideways, which is the fault these boxes exist to prevent');
  }

  return { fail, note, overflowing, regions: regions.length,
           media: { hover: matchMedia('(hover: hover)').matches, coarse: matchMedia('(pointer: coarse)').matches } };
`;

/**
 * Applying a palette the way the application applies it: inline custom
 * properties on the root element. applyTheme.js does exactly this, and does it
 * for the same reason - an inline property beats both `:root` and the
 * prefers-color-scheme block, so once we are painting we own the palette.
 *
 * Written as an expression the page evaluates rather than importing the app's
 * own module, because the harness bundle does not expose one. The CATALOG is
 * the app's, imported above, so a theme added tomorrow is swept tomorrow with
 * no edit here.
 */
const paint = (tokens) => `
  const t = ${JSON.stringify(tokens)};
  for (const [name, value] of Object.entries(t)) {
    document.documentElement.style.setProperty('--' + name, value);
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cue = document.querySelector('.scroll-cue');
  if (!cue) return null;
  const card = cue.closest('.card') ?? document.body;
  const cs = getComputedStyle(cue);
  return {
    label: cs.color,
    chip: cs.backgroundColor,
    edge: cs.borderTopColor,
    card: getComputedStyle(card).backgroundColor,
    arrowStroke: getComputedStyle(cue.querySelector('svg path')).stroke,
  };
`;

const hexOf = (value) => {
  const parts = String(value).match(/[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  return `#${parts.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')}`;
};

/**
 * ── WHY THIS SWEEPS TWENTY PALETTES AND NOT TWO ───────────────────────────
 *
 * The athlete picks a theme. Ten of them, in light and dark, and the first
 * version of this control used --border on --surface: 1.32:1 in light, 1.22:1
 * in dark, and no guarantee at all in the other eighteen. A control whose
 * boundary is invisible is a control nobody presses.
 *
 * The palette test already proves the TOKENS clear their thresholds for all
 * twenty. This proves the tokens actually reach this element - which is a
 * different question, and the one a `var()` typo answers wrongly in silence.
 */
async function sweepThemes(page) {
  const problems = [];
  let measured = 0;

  for (const themeId of THEME_IDS) {
    for (const mode of MODES) {
      const seen = await page.evaluate(paint(tokensFor(themeId, mode)));
      if (!seen) {
        problems.push(`${themeId}/${mode}: no cue on the page to measure`);
        continue;
      }
      const [label, chip, edge, card] = [seen.label, seen.chip, seen.edge, seen.card].map(hexOf);
      if (!label || !chip || !edge || !card) {
        problems.push(`${themeId}/${mode}: a color came back unreadable (${JSON.stringify(seen)})`);
        continue;
      }
      measured += 1;

      const words = contrast(label, chip);
      const boundary = contrast(edge, chip);
      const onCard = contrast(edge, card);
      if (words < AA_TEXT) problems.push(`${themeId}/${mode}: the words are ${words.toFixed(2)}:1 on the chip, need ${AA_TEXT}`);
      if (boundary < AA_NON_TEXT) problems.push(`${themeId}/${mode}: the chip's edge is ${boundary.toFixed(2)}:1 on its own fill, needs ${AA_NON_TEXT}`);
      if (onCard < AA_NON_TEXT) problems.push(`${themeId}/${mode}: the chip's edge is ${onCard.toFixed(2)}:1 against the card behind it, needs ${AA_NON_TEXT}`);
      // The arrow is the thing the report asked for, and it is drawn in
      // currentColor. If it ever stops being, it stops being themed.
      if (hexOf(seen.arrowStroke) !== label) {
        problems.push(`${themeId}/${mode}: the arrow is not drawn in the label's color (${seen.arrowStroke} vs ${seen.label})`);
      }
    }
  }

  // An empty sweep compares equal to a clean one.
  const expected = THEME_IDS.length * MODES.length;
  if (measured !== expected) {
    problems.push(`only ${measured} of ${expected} palettes were actually measured`);
  }
  return { problems, measured, expected };
}

async function main() {
  if (typeof WebSocket !== 'function') {
    console.error('This check needs the WebSocket client built into node 22 or newer.');
    process.exit(1);
  }
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
  let failures = 0;

  for (const viewport of VIEWPORTS) {
    // The harness talks to nothing, so an unexpected outbound request would be
    // a finding rather than something to wait for.
    const page = await launch(chromePath, { ...viewport, offline: true, label: 'scroll-cues' });
    try {
      let regionsSeen = 0;
      let overflowingSeen = 0;

      for (const { id, overflows, reveal } of PAGES) {
        await page.goto(`http://127.0.0.1:${port}/?page=${id}&mode=full`);
        const where = `${viewport.width}px ${id}`;

        if (reveal) {
          const opened = await page.evaluate(`
            const control = document.querySelector(${JSON.stringify(reveal)});
            if (!control) return false;
            control.click();
            await new Promise((r) => setTimeout(r, 400));
            return true;
          `);
          if (!opened) {
            console.error(`FAIL ${where}: nothing matched "${reveal}", so the box behind it was never opened`);
            failures += 1;
            continue;
          }
        }

        const report = await page.evaluate(AUDIT);

        // The trap every check in this repository has fallen into once: an
        // empty run reports success having looked at nothing.
        if (!report.regions) {
          console.error(`FAIL ${where}: no scrolling regions on this page at all`);
          failures += 1;
          continue;
        }
        if (viewport.touch && report.media.hover) {
          console.error(`FAIL ${where}: asked for a touch screen and got a mouse`);
          failures += 1;
          continue;
        }
        if (viewport.expectOverflow && overflows && !report.overflowing) {
          console.error(
            `FAIL ${where}: nothing overflowed, so no cue was exercised. Either the table got ` +
            'narrower - in which case say so here - or the fixture stopped having data in it, ' +
            'which is what made the leaderboard unreviewable for as long as it did.',
          );
          failures += 1;
          continue;
        }

        regionsSeen += report.regions;
        overflowingSeen += report.overflowing;

        for (const line of report.fail) {
          console.error(`FAIL ${where}: ${line}`);
          failures += 1;
        }
      }

      if (!viewport.expectOverflow && overflowingSeen > 1) {
        // The week strip is seven days wide and overflows on a laptop too;
        // more than that at 1280px means a table has started overflowing where
        // it used to fit, which is the original defect arriving on a desktop.
        console.error(`FAIL ${viewport.width}px: ${overflowingSeen} regions overflow where at most the week strip should`);
        failures += 1;
      }
      const report = { regions: regionsSeen, overflowing: overflowingSeen, fail: [] };

      // Back to the program page for the palette sweep, which needs a cue on
      // screen and should measure the same one every run.
      if (viewport.sweepThemes) await page.goto(`http://127.0.0.1:${port}/?page=program&mode=full`);

      // Once, at the width where the cue exists. The palette does not change
      // with the viewport, and twenty repaints in one page is cheap.
      if (viewport.sweepThemes) {
        const { problems, measured, expected } = await sweepThemes(page);
        for (const line of problems) {
          console.error(`FAIL themes: ${line}`);
          failures += 1;
        }
        if (!problems.length) {
          console.log(`OK   themes  ${measured} of ${expected} palettes: words, edge and arrow all clear`);
        }
      }

      if (!report.fail.length) {
        console.log(
          `OK   ${viewport.width}px  ${report.regions} regions, ${report.overflowing} overflowing` +
          `${viewport.touch ? ' (touch)' : ''}`,
        );
      }
    } finally {
      page.close();
    }
  }

  server.close();
  if (failures) {
    console.error(`\n${failures} problem${failures === 1 ? '' : 's'} with the sideways-scroll affordances.`);
    process.exit(1);
  }
  console.log('OK   every box that scrolls sideways says so, and saying so works.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

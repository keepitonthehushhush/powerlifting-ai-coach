#!/usr/bin/env node
/**
 * Is the chart drawn at the size the stylesheet says?
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 *
 * `.chart-axis-label { font-size: 10px }` rendered at **8.9px** on every
 * desktop viewport and 9.1px on a phone, for as long as the charts existed.
 * Both chart components declared `viewBox="0 0 340 170"` and both render in a
 * grid track 302 CSS pixels wide, so a viewBox is a scale factor and every
 * number in the picture was multiplied by 302/340 = 0.888.
 *
 * ── WHY NONE OF THE THREE CHECKS WE ALREADY HAD COULD SEE IT ──────────────
 *
 * `typeScale.test.js` reads the stylesheet, so it saw `10px` - the declared
 * value, which is not the rendered one. It even had an allowlist entry saying
 * the value "is not 10px on screen", and a note that a number is wrong,
 * without the right number, is how a defect survives being noticed.
 *
 * `check-computed-styles.mjs` reads `getComputedStyle`, which on an SVG text
 * node reports the DECLARED font-size regardless of the viewBox around it. A
 * snapshot of computed values is identical before and after this fix except
 * for the one token name. It is the strongest net here and this defect passes
 * straight through it, for the same reason the scroll cues needed their own
 * check: the fault is in geometry, not in a property value.
 *
 * `check-screens.mjs` takes pictures. 8.9px and 11px both look like small gray
 * text in a screenshot at review size.
 *
 * So this one multiplies. Effective size = declared size x (rendered width /
 * viewBox width), which is the number that reaches the eye, and it is checked
 * against the floor of the type ladder rather than against a constant written
 * here - `--text-caption-2`, 11px, read out of the stylesheet the app ships.
 *
 * No dependencies: CDP is JSON over the WebSocket client node 22 ships.
 *
 * Usage:  node scripts/check-chart-scale.mjs
 */

import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from './lib/browser.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harnessDir = path.resolve(repoRoot, process.env.HARNESS_DIR ?? 'web/harness-dist');
const stylesheet = path.resolve(repoRoot, 'web/src/styles.css');

/**
 * The floor, read from the application's own type ladder rather than written
 * here. A constant in this file would go stale the first time the ladder moves
 * and would then be a second opinion about the same rule.
 */
async function ladderFloor() {
  // Read rather than required: a missing stylesheet is a wrong invocation, and
  // an uncaught ENOENT prints a stack trace that reads like the check is
  // broken. It did, once, when this was run from a partial copy of the tree.
  let css;
  try {
    css = await readFile(stylesheet, 'utf8');
  } catch {
    console.error(`No stylesheet at ${path.relative(repoRoot, stylesheet)}, so there is no type ladder to read a floor from.`);
    console.error('Run this from the repository root.');
    return null;
  }
  const hit = /--text-caption-2:\s*([\d.]+)rem/.exec(css);
  if (!hit) return null;
  return Number(hit[1]) * 16;
}

/*
 * Both chart screens, and both widths where the grid lays out differently: two
 * columns on a laptop, one on a phone. A single viewport would have been
 * enough to catch THIS defect and is not enough to keep catching it - the
 * scale factor is a layout outcome, so it is different in every track width.
 */
const VIEWPORTS = [
  { width: 1680, height: 1000, touch: false },
  { width: 1280, height: 900, touch: false },
  { width: 390, height: 844, touch: true },
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
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(await readFile(path.join(root, 'index.html')));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

/** Runs inside the page. Returns findings rather than throwing, so one run reports all of them. */
const AUDIT = (floor) => `
  const fail = [];
  const seen = [];
  if (document.querySelector('[data-error-boundary]')) {
    return { fail: ['the page rendered its error boundary, so nothing here was measured'], seen };
  }

  const svgs = [...document.querySelectorAll('.chart svg')];
  for (const svg of svgs) {
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    if (!vb || !vb.width) { fail.push('a chart has no viewBox to scale by'); continue; }
    const scale = box.width / vb.width;
    const name = (svg.closest('.chart')?.querySelector('.chart-title')?.textContent ?? 'a chart').trim();

    // THE property. Everything else here follows from it.
    if (Math.abs(scale - 1) > 0.01) {
      fail.push(name + ': drawn at ' + Math.round(box.width) + 'px inside a ' + vb.width +
                '-unit viewBox, so everything in it is scaled by ' + scale.toFixed(3));
    }
    if (Math.abs(box.height - vb.height) > 1) {
      fail.push(name + ': ' + Math.round(box.height) + 'px tall inside a ' + vb.height + '-unit viewBox');
    }

    for (const text of svg.querySelectorAll('text')) {
      const declared = parseFloat(getComputedStyle(text).fontSize);
      const effective = declared * scale;
      seen.push({ name, declared, effective: Math.round(effective * 100) / 100 });
      if (effective < ${floor} - 0.01) {
        fail.push(name + ': "' + text.textContent + '" declares ' + declared +
                  'px and reaches the eye at ' + effective.toFixed(1) + 'px, under the ' +
                  ${floor} + 'px floor of the type ladder');
      }
      // A label the viewBox cuts off is invisible however big it is.
      const b = text.getBBox();
      if (b.x < -0.5 || b.y < -0.5 || b.x + b.width > vb.width + 0.5 || b.y + b.height > vb.height + 0.5) {
        fail.push(name + ': "' + text.textContent + '" is outside the viewBox and is clipped');
      }
    }
  }

  if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
    fail.push('the page scrolls sideways');
  }

  /*
   * ── AND IT HAS TO STAY 1:1 WHEN THE BOX CHANGES ───────────────────────
   *
   * Measuring once at mount is enough to make this check pass and is not
   * enough to keep the property. The element is measured in a layout effect,
   * which runs on renders - and a window resize is not a render. Without the
   * ResizeObserver the viewBox keeps the width the chart had when it mounted,
   * and the scale drifts away from 1 by exactly as much as the window moved.
   *
   * So the container is narrowed here and everything is measured again. Two
   * frames, because an observer callback lands before the paint after it.
   */
  const grid = document.querySelector('.chart-grid-layout');
  if (grid) {
    const was = grid.style.width;
    const before = [...document.querySelectorAll('.chart svg')]
      .map((svg) => Math.round(svg.getBoundingClientRect().height));
    grid.style.width = '560px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let resized = 0;
    for (const svg of document.querySelectorAll('.chart svg')) {
      const box = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      if (!vb || !vb.width) continue;
      const scale = box.width / vb.width;
      if (Math.abs(scale - 1) > 0.01) {
        fail.push('after narrowing the grid to 560px a chart is ' + Math.round(box.width) +
                  'px inside a ' + vb.width + '-unit viewBox (scale ' + scale.toFixed(3) +
                  '), so it is not re-measuring when its box changes');
      }
      /*
       * And the height must not have moved. A chart whose height is derived
       * from its width is aspect-locked, which is the same magnification
       * defect pointing the other way: it stays 1:1 - this check's first
       * assertion passes - and a wider chart becomes a TALLER chart instead of
       * a longer one. The point of measuring the width was to spend new width
       * on resolution, so the height being a constant is the property, not an
       * implementation detail. Mutation testing found this: locking the aspect
       * ratio again was the one planted change the earlier version missed.
       */
      const wasTall = before[resized];
      if (typeof wasTall === 'number' && Math.abs(box.height - wasTall) > 1) {
        // No apostrophe in this sentence on purpose: AUDIT is a template
        // literal, so a backslash-escaped quote here is unescaped by the time
        // the page parses it, and the whole audit becomes a syntax error that
        // reads like the browser broke. It did that once.
        fail.push('narrowing the grid changed the height of a chart from ' + wasTall + 'px to ' +
                  Math.round(box.height) + 'px, so the height is derived from the width');
      }
      resized += 1;
    }
    if (!resized) fail.push('the grid was narrowed and no chart was measured afterwards');
    grid.style.width = was;
  } else {
    fail.push('no .chart-grid-layout to resize, so the re-measure half of this check did nothing');
  }

  return { fail, seen, charts: svgs.length };
`;

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
  const floor = await ladderFloor();
  if (!floor) {
    console.error('Could not read --text-caption-2 out of web/src/styles.css, so there is no floor to check against.');
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
  let chartsSeen = 0;
  let labelsSeen = 0;
  let smallest = Infinity;

  for (const viewport of VIEWPORTS) {
    const page = await launch(chromePath, { ...viewport, offline: true, label: 'chart-scale' });
    try {
      await page.goto(`http://127.0.0.1:${port}/?page=progress&mode=full`);
      const report = await page.evaluate(AUDIT(floor));

      // The trap every check in this repository has fallen into once: an empty
      // run reports success having looked at nothing.
      if (!report.charts) {
        console.error(`FAIL ${viewport.width}px: no charts on the progress page at all`);
        failures += 1;
        continue;
      }
      if (!report.seen.length) {
        console.error(`FAIL ${viewport.width}px: ${report.charts} charts and not one axis label in them`);
        failures += 1;
        continue;
      }

      chartsSeen += report.charts;
      labelsSeen += report.seen.length;
      smallest = Math.min(smallest, ...report.seen.map((s) => s.effective));

      for (const line of report.fail) {
        console.error(`FAIL ${viewport.width}px: ${line}`);
        failures += 1;
      }
      if (!report.fail.length) {
        console.log(
          `OK   ${viewport.width}px  ${report.charts} charts, ${report.seen.length} labels, ` +
          `smallest ${Math.min(...report.seen.map((s) => s.effective)).toFixed(1)}px`,
        );
      }
    } finally {
      page.close();
    }
  }

  server.close();
  if (failures) {
    console.error(`\n${failures} problem${failures === 1 ? '' : 's'}: the charts are not drawn at the size they declare.`);
    process.exit(1);
  }
  console.log(
    `OK   ${chartsSeen} charts and ${labelsSeen} labels across ${VIEWPORTS.length} viewports: ` +
    `one user unit is one pixel, and the smallest text on screen is ${smallest.toFixed(1)}px ` +
    `against a ${floor}px floor.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

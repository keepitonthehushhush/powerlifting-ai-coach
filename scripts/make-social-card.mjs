#!/usr/bin/env node
/**
 * The picture every messaging app shows before anybody reaches the site.
 *
 * ── WHAT WAS THERE, AND WHY IT WAS WRONG ──────────────────────────────────
 *
 * `og:image` pointed at `icons/icon-512.png` - the app icon, 512x512. Meta's
 * own guidance puts the recommended size at 1200x630, the working minimum at
 * 600x315, and says in as many words that "if your image is smaller than
 * 600 x 315 px, it will still display in the link page post, but the size will
 * be much smaller". 512 is under that floor on the long edge, so every shared
 * link rendered a thumbnail beside the text rather than a card.
 *
 * The comment in index.html said so at the time and named the fix: "A wide
 * social image is worth making; it is not worth faking with a square one."
 * This is the making of it.
 *
 * ── WHY A SCRIPT AND NOT A PNG SOMEBODY DREW ──────────────────────────────
 *
 * A hand-made image is a second copy of the brand that drifts from the first.
 * This reads the palette out of `web/src/styles.css`, the words out of
 * `web/src/i18n/locales/en.js` and the mark out of `web/src/components/
 * Logo.jsx`, lays them out in HTML, and renders them with the same engine that
 * draws the application. There is nothing in the picture that is not already
 * in the product, so the card cannot claim something the site does not say.
 *
 * ── THE ONE THING IT CANNOT INHERIT ───────────────────────────────────────
 *
 * The app's `--font` is `system-ui`, deliberately: the reader's own interface
 * font. A flat image has no reader, so it has to pick. It picks Liberation
 * Sans, which is designed to be metric-compatible with Arial - so a machine
 * with Arial renders identical glyph positions and the committed PNG is
 * reproducible off this container rather than only on it.
 *
 * Usage:  node scripts/make-social-card.mjs [--out web/public/social-card.png]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from './lib/browser.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Meta's recommended size, and the 1.91:1 it asks for. 1200/630 = 1.905. */
export const CARD = { width: 1200, height: 630 };

/**
 * The dark palette, read from the stylesheet's first `:root` block.
 *
 * Dark rather than light because a link preview sits in a chat thread, and
 * both iMessage and Slack put it on a surface closer to the dark end - but
 * mostly because this is the palette the product ships as its default.
 */
export function paletteFrom(css) {
  const block = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const tokens = Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
  const need = ['--bg', '--surface', '--text', '--muted', '--accent', '--secondary',
    '--wash-cool', '--wash-cool-end', '--wash-warm', '--wash-warm-end'];
  const missing = need.filter((key) => !tokens[key]);
  if (missing.length) {
    throw new Error(`the stylesheet's first :root block no longer defines ${missing.join(', ')}`);
  }
  return tokens;
}

/** The headline the landing page actually shows. Quoted, never paraphrased. */
export function headlineFrom(locale) {
  const match = locale.match(/\n\s*headline: '([^']+)'/);
  if (!match) throw new Error('could not find home.headline in the English locale');
  return match[1];
}

function page(tokens, headline) {
  const v = (name) => tokens[name];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${CARD.width}px; height: ${CARD.height}px; }
  body {
    background: ${v('--bg')};
    color: ${v('--text')};
    font-family: 'Liberation Sans', Arial, Helvetica, sans-serif;
    -webkit-font-smoothing: antialiased;
    position: relative;
    overflow: hidden;
  }
  /* The app's own two washes, at the app's own stops. */
  body::before {
    content: ''; position: absolute; inset: 0;
    background:
      radial-gradient(58rem 42rem at 10% -12%, ${v('--wash-cool')}, ${v('--wash-cool-end')} 62%),
      radial-gradient(50rem 38rem at 102% 110%, ${v('--wash-warm')}, ${v('--wash-warm-end')} 64%);
  }
  .card { position: relative; height: 100%; padding: 72px 80px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 20px; }
  .brand span { font-size: 38px; font-weight: 700; letter-spacing: -0.02em; }
  h1 {
    margin-top: auto;
    font-size: 72px;
    line-height: 1.12;
    font-weight: 700;
    letter-spacing: -0.03em;
    max-width: 17ch;
    text-wrap: balance;
  }
  .rule { margin: 40px 0 0; width: 132px; height: 6px; border-radius: 3px; background: ${v('--accent')}; }
  .foot { margin-top: 32px; font-size: 30px; color: ${v('--muted')}; letter-spacing: 0.01em; }
</style></head><body><div class="card">
  <div class="brand">
    <svg width="76" height="76" viewBox="0 0 200 200" aria-hidden="true">
      <path d="M52 6 L148 6 L194 100 L148 194 L52 194 L6 100 Z"
            fill="${v('--surface')}" stroke="${v('--secondary')}" stroke-width="11" stroke-linejoin="round" />
      <path d="M56 20 L144 20 L178 100 L144 180 L56 180 L22 100 Z"
            fill="none" stroke="${v('--accent')}" stroke-width="4" stroke-linejoin="round" />
      <g stroke="${v('--text')}" stroke-linecap="round">
        <line x1="40" y1="100" x2="160" y2="100" stroke-width="14" />
        <line x1="62" y1="66" x2="62" y2="134" stroke-width="22" />
        <line x1="138" y1="66" x2="138" y2="134" stroke-width="22" />
      </g>
    </svg>
    <span>Coach Diaz</span>
  </div>
  <h1>${headline.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1>
  <div class="rule"></div>
  <div class="foot">coachdiaz.app</div>
</div></body></html>`;
}

/**
 * ── THE RENDER SIGNS ITSELF ───────────────────────────────────────────────
 *
 * The headline lives in three places once this ships: the locale file, the
 * pixels of the PNG, and `og:image:alt` in index.html. A test can hold the
 * first and third together by reading both. It cannot read the pixels - and a
 * card still showing last month's headline, with tags and locale agreeing
 * perfectly about a sentence the picture does not contain, is exactly the
 * quiet kind of wrong this project keeps finding.
 *
 * So the run that draws the card writes the headline it drew into a PNG
 * `tEXt` chunk. That is not proof the glyphs are legible, and nothing cheap
 * is - but the chunk and the pixels come out of the same render, so it is
 * evidence about THIS file rather than a claim about it. `socialCard.test.js`
 * reads the chunk back and fails if it has fallen behind the locale.
 *
 * @see http://www.libpng.org/pub/png/spec/1.2/PNG-Chunks.html
 */
export const CARD_KEYWORD = 'CoachDiazHeadline';

export function withTextChunk(png, keyword, text) {
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);

  // Before IEND, which must be the last chunk in the file.
  const iend = png.length - 12;
  if (png.subarray(iend + 4, iend + 8).toString('latin1') !== 'IEND') {
    throw new Error('this PNG does not end with an IEND chunk, so there is nowhere safe to put the text');
  }
  return Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
}

/** Reads it back. Returns null when the file carries no such chunk. */
export function textChunk(png, keyword) {
  let at = 8; // past the signature
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('latin1');
    if (type === 'tEXt') {
      const body = png.subarray(at + 8, at + 8 + length);
      const split = body.indexOf(0);
      if (split > -1 && body.subarray(0, split).toString('latin1') === keyword) {
        return body.subarray(split + 1).toString('latin1');
      }
    }
    if (type === 'IEND') break;
    at += length + 12;
  }
  return null;
}

async function main() {
  const outArg = process.argv.indexOf('--out');
  const out = path.resolve(repoRoot, outArg > -1 ? process.argv[outArg + 1] : 'web/public/social-card.png');

  const chromePath = await findChrome();
  if (!chromePath) {
    console.error('Could not find Chrome. Set CHROME_BIN.');
    console.error('This is a generator, not a check - it is run by hand when the words or the palette change,');
    console.error('and the PNG it writes is what ships. See ADR-32.');
    process.exit(1);
  }

  const tokens = paletteFrom(await readFile(path.join(repoRoot, 'web/src/styles.css'), 'utf8'));
  const headline = headlineFrom(await readFile(path.join(repoRoot, 'web/src/i18n/locales/en.js'), 'utf8'));

  const html = page(tokens, headline);
  const browser = await launch(chromePath, { ...CARD, offline: true, label: 'social-card' });
  try {
    await browser.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, { timeoutMs: 4000, settleMs: 500 });
    const png = await browser.screenshot();
    /*
     * A screenshot is not automatically the size you asked for - the device
     * pixel ratio and the full-page flag both change it, and a card that is
     * 2400x1260 is a different asset from the one the meta tags describe.
     * Read the dimensions back out of the PNG's own IHDR before writing it.
     */
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (width !== CARD.width || height !== CARD.height) {
      throw new Error(`rendered ${width}x${height}, wanted ${CARD.width}x${CARD.height}`);
    }
    const signed = withTextChunk(png, CARD_KEYWORD, headline);
    const readBack = textChunk(signed, CARD_KEYWORD);
    if (readBack !== headline) {
      throw new Error(`wrote a headline chunk that reads back as ${JSON.stringify(readBack)}`);
    }
    await writeFile(out, signed);
    console.log(`Wrote ${path.relative(repoRoot, out)} - ${width}x${height}, ${(signed.length / 1024).toFixed(1)} kB`);
    console.log(`Headline: "${headline}"`);
  } finally {
    browser.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith('make-social-card.mjs')) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

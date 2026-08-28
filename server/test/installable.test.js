import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { readRaw, phrase } from './helpers/source.js';

/**
 * ── WHY A MANIFEST AND NOT A NATIVE APP ────────────────────────────────────
 *
 * Because an App Store listing is a distribution channel for demand that
 * already exists, and this product has three users. A manifest answers the
 * question that actually needs answering - will anybody put this on their
 * phone - for one file and an icon set, with no store, no review, no
 * commission, and no second deployment pipeline to keep in step with the one
 * we just made safe.
 *
 * (For the record, the commission figure that made this look worse than it is:
 * Apple's Small Business Program is 15% under $1M in proceeds, not 30%.)
 */

const url = (p) => new URL(p, import.meta.url);
const manifest = JSON.parse(readFileSync(url('../../web/public/manifest.webmanifest'), 'utf8'));
const html = readRaw(url('../../web/index.html'));
const styles = readRaw(url('../../web/src/styles.css'));
const logo = readRaw(url('../../web/src/components/Logo.jsx'));
const generator = readRaw(url('../../scripts/generate-icons.py'));

describe('the manifest says what it must', () => {
  test('it is installable at all', () => {
    // name, icons, start_url and a display mode are the minimum a browser
    // requires before it will offer installation.
    assert.ok(manifest.name);
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.ok(manifest.icons.length >= 3);
  });

  test('THE COLOURS MATCH THE ONES THE APP ACTUALLY USES', () => {
    // background_color paints the splash and theme_color the status bar. A
    // value invented here rather than read from the stylesheet produces a
    // flash of a colour the app never shows, on launch, every time.
    assert.match(styles, new RegExp(`--bg:\\s*${manifest.background_color};`));
    assert.equal(manifest.theme_color, manifest.background_color);
  });

  test('and index.html declares both theme colours, because the app themes itself', () => {
    assert.match(html, /theme-color" media="\(prefers-color-scheme: dark\)" content="#0f0d1a"/);
    assert.match(html, /theme-color" media="\(prefers-color-scheme: light\)"/);
  });
});

describe('the icons', () => {
  const files = [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
    ['favicon-32.png', 32],
    ['favicon-16.png', 16],
  ];

  test('every file the manifest and the head reference exists', () => {
    for (const [name] of files) {
      const path = url(`../../web/public/icons/${name}`);
      assert.ok(existsSync(path), `web/public/icons/${name} is missing`);
      assert.ok(statSync(path).size > 200, `${name} is suspiciously small`);
    }
  });

  test('and they are the sizes they claim to be', async () => {
    // A manifest that says 512x512 about a 192px file is a manifest browsers
    // quietly ignore.
    for (const [name, expected] of files) {
      const buf = readFileSync(url(`../../web/public/icons/${name}`));
      // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      assert.equal(width, expected, `${name} is ${width}px wide, not ${expected}`);
      assert.equal(height, expected, `${name} is ${height}px tall, not ${expected}`);
    }
  });

  test('THERE IS A MASKABLE ONE, AND IT IS NOT THE FULL-BLEED ONE', () => {
    // Android crops an icon to whatever shape the launcher uses and only
    // guarantees the centre 80%. Declaring the full-bleed badge as maskable
    // gets its points shaved off; declaring none at all gets it letterboxed in
    // a white square.
    const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
    assert.equal(maskable.length, 1);
    assert.notEqual(maskable[0].src, manifest.icons.find((i) => i.purpose === 'any').src);
    assert.match(generator, phrase('only the centre 80% is guaranteed visible'));
  });

  test('the generator uses the geometry from Logo.jsx, not a new drawing', () => {
    // An icon that does not match the mark in the app is a second logo.
    for (const coord of ['52,6', '148,6', '194,100', '56,20', '178,100']) {
      const [x, y] = coord.split(',');
      assert.ok(generator.includes(`(${x},${y})`), `the badge outline lost the point ${coord}`);
      assert.ok(logo.includes(`${x} ${y}`) || logo.includes(`M${x} ${y}`), `Logo.jsx no longer has ${coord}`);
    }
  });

  test('the favicon uses the COMPACT variant, for the reason Logo.jsx gives', () => {
    // Below 32px the inner sleeves merge into a blob. The component has two
    // variants for that reason and the favicon is exactly that size.
    assert.match(generator, /favicon-32\.png/);
    assert.match(generator, /compact=True/);
    assert.match(logo, phrase('A mark that turns to mud at favicon size'));
  });

  test('and iOS gets its own, because it composites no background', () => {
    assert.match(html, /rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
    assert.match(generator, phrase('iOS does not composite a background'));
  });
});

describe('what was deliberately NOT added', () => {
  test('THERE IS NO SERVICE WORKER', () => {
    /**
     * One would add offline support and a second cache with its own lifetime -
     * capable of serving a build older than the one NewVersionBanner compares
     * against. That is a caching bug layered on the deploy problem just
     * solved, traded for offline access to a coach that needs the network to
     * answer anything.
     */
    assert.ok(!/serviceWorker|workbox|sw\.js/i.test(html), 'index.html registers a service worker');
    assert.match(html, phrase('There is deliberately NO service worker'));
  });

  test('the reasoning is in the file somebody would edit to add one', () => {
    assert.match(html, phrase('capable of serving a build older than the one the version banner'));
  });
});

describe('standalone mode changes two things that already exist', () => {
  test('the version banner matters more, because there is no reload button', () => {
    // In standalone there is no browser chrome, so a person cannot refresh
    // their way out of a stale build. The banner is the only route.
    const banner = readRaw(url('../../web/src/components/NewVersionBanner.jsx'));
    assert.match(banner, /window\.location\.reload\(\)/);
  });

  test('and the maintenance page is inside the manifest scope', () => {
    // ErrorBoundary links to /maintenance.html with a plain anchor. Outside
    // scope it would kick the person into a browser tab mid-outage.
    assert.equal(manifest.scope, '/');
    assert.ok(existsSync(url('../../web/public/maintenance.html')));
  });
});

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { contentReach, decode, readHeader, MASKABLE_SAFE_FRACTION } from '../src/lib/pngPixels.js';
import { readRaw } from './helpers/source.js';

const html = readRaw(new URL('../../web/index.html', import.meta.url));
const manifest = JSON.parse(readRaw(new URL('../../web/public/manifest.webmanifest', import.meta.url)));
const read = (src) => readFileSync(fileURLToPath(new URL(`../../web/public${src}`, import.meta.url)));

/** Every `<link rel="icon"|"apple-touch-icon">`, with whatever size it declares. */
function declaredInHtml() {
  return [...html.matchAll(/<link rel="(icon|apple-touch-icon)"\s+href="([^"]+)"(?:\s+sizes="(\d+)x(\d+)")?\s*\/>/g)]
    .map(([, rel, href, w, h]) => ({ rel, href, width: w ? Number(w) : null, height: h ? Number(h) : null }));
}

/**
 * ── THE ICONS ARE A SURFACE NOTHING LOADS AND NOTHING CHECKED ─────────────
 *
 * A favicon, an installed-app icon and a home-screen icon are all seen before
 * the product is, by somebody who has not visited it. No route loads them, no
 * page renders them, and until this file nothing in the repository looked at
 * them - which is the exact combination every defect in this project has hidden
 * in. Same argument as socialCard.test.js, one surface over.
 *
 * Measured once by hand before writing this, and they were all correct. That is
 * the point: the guard is not here because something was broken, it is here so
 * that the next person who regenerates the branding finds out within a second
 * rather than when somebody installs the app on an Android phone.
 */
describe('every icon is the size it says it is', () => {
  test('the HTML declares icons, and each one exists at its declared size', () => {
    const declared = declaredInHtml();
    // A parser that finds nothing passes every assertion below it.
    assert.ok(declared.length >= 3, `only ${declared.length} icon links were parsed out of index.html`);

    for (const icon of declared) {
      const bytes = read(icon.href);
      const header = readHeader(bytes);
      if (icon.width) {
        assert.equal(header.width, icon.width, `${icon.href} is ${header.width}px wide, declared ${icon.width}`);
        assert.equal(header.height, icon.height, `${icon.href} is ${header.height}px tall, declared ${icon.height}`);
      }
      assert.equal(header.width, header.height, `${icon.href} is not square`);
    }
  });

  test('and the manifest does too, including the maskable one', () => {
    assert.ok(manifest.icons?.length >= 3, 'the manifest declares fewer than three icons');
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split('x').map(Number);
      const header = readHeader(read(icon.src));
      assert.equal(header.width, w, `${icon.src} is ${header.width}px wide, the manifest says ${w}`);
      assert.equal(header.height, h, `${icon.src} is ${header.height}px tall, the manifest says ${h}`);
      assert.equal(icon.type, 'image/png');
    }
    assert.ok(
      manifest.icons.some((i) => i.purpose === 'maskable'),
      'no maskable icon, so Android crops the square one into whatever shape it likes',
    );
  });

  test('THE MASKABLE ICON STAYS INSIDE THE SAFE ZONE', () => {
    /*
     * web.dev: the safe zone is "a circular area in the center of the icon with
     * a radius equal to 40% of the icon width", and "the outer 10% edge might be
     * cropped on some platforms". Android masks an installed icon into a circle,
     * a squircle, a rounded square or a teardrop depending on the launcher, so
     * anything outside that circle is content you cannot rely on being visible.
     *
     * Measured rather than eyeballed, by decoding the actual pixels: content
     * reaches 167.5px from the center of a 512px icon, which is 32.7% - inside
     * the 40% with room to spare. Cross-checked against Pillow on all six icons:
     * identical bounding boxes and identical radii to three decimals.
     */
    const maskable = manifest.icons.find((i) => i.purpose === 'maskable');
    const reach = contentReach(read(maskable.src));
    assert.ok(
      reach.fraction <= MASKABLE_SAFE_FRACTION,
      `the maskable icon's content reaches ${(reach.fraction * 100).toFixed(1)}% of its width from center, ` +
        `past the ${MASKABLE_SAFE_FRACTION * 100}% safe zone - Android will crop it`,
    );
    // And it must not be so inset that the icon is a speck in a field of color.
    assert.ok(
      reach.fraction >= 0.2,
      `the maskable icon's content reaches only ${(reach.fraction * 100).toFixed(1)}%, which is a dot in a square`,
    );
  });

  test('the small favicons are small FILES, and none of them is a photograph', () => {
    for (const icon of declaredInHtml()) {
      const bytes = statSync(fileURLToPath(new URL(`../../web/public${icon.href}`, import.meta.url))).size;
      assert.ok(bytes < 60_000, `${icon.href} is ${Math.round(bytes / 1024)}kB, which is a picture rather than a mark`);
      assert.ok(bytes > 100, `${icon.href} is ${bytes} bytes, which is too small to be an icon`);
    }
  });
});

describe('the PNG reader is narrow on purpose', () => {
  test('it refuses a format it cannot read, rather than returning a number', () => {
    /*
     * A decoder that quietly mis-reads is worse than one that refuses, because
     * the measurement still comes out looking like a measurement. The header is
     * mutated in place here - 8-bit RGBA is colorType 6, and 2 is truecolor
     * without alpha, which this reader does not handle.
     */
    const real = read('/icons/icon-512.png');
    const wrongType = Buffer.from(real);
    wrongType[25] = 2;
    assert.throws(() => decode(wrongType), /8-bit RGBA/);

    const wrongDepth = Buffer.from(real);
    wrongDepth[24] = 16;
    assert.throws(() => decode(wrongDepth), /8-bit RGBA/);

    assert.throws(() => readHeader(Buffer.from('not a png at all, really')), /not a PNG/);
  });

  test('AND A BLANK IMAGE IS AN ERROR, not a reach of zero', () => {
    /*
     * The trap this assertion exists for: an all-one-color image has no content
     * to measure, so `contentReach` would naturally return 0 - the safest
     * possible number - and sail through the safe-zone check above. An empty
     * result comparing equal to a good one is this repository's oldest lesson.
     */
    const blank = makeBlankPng(8);
    assert.throws(() => contentReach(blank), /no content/);
  });
});

/** A valid all-transparent 8-bit RGBA PNG, built by hand. */
function makeBlankPng(size) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size); // filter 0 + all-zero pixels
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

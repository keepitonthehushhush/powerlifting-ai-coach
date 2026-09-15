import { inflateSync } from 'node:zlib';

/**
 * Just enough PNG to measure an icon, with no dependency.
 *
 * ── WHY NOT A LIBRARY ─────────────────────────────────────────────────────
 *
 * This exists to answer one question about six files that change about once a
 * year: does the content of the maskable icon stay inside the safe zone. A
 * dependency for that is a supply-chain surface, a lockfile entry and an
 * upgrade to keep current, for ~60 lines of a format that has not changed
 * since 1996. Same trade as the DevTools client in scripts/lib/browser.mjs.
 *
 * DELIBERATELY NARROW. 8-bit truecolor with alpha (color type 6, bit depth 8),
 * no interlace - which is what every icon in this repository is, asserted
 * rather than assumed: anything else throws by name instead of returning
 * plausible nonsense. A decoder that quietly mis-reads a format is worse than
 * one that refuses it, because the measurement still comes out a number.
 *
 * Verified against Pillow on all six icons: identical bounding boxes and an
 * identical furthest-pixel radius to the pixel.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @returns {{width:number,height:number,bitDepth:number,colorType:number}} */
export function readHeader(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  if (png.subarray(12, 16).toString('latin1') !== 'IHDR') throw new Error('no IHDR chunk');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bitDepth: png[24],
    colorType: png[25],
    interlace: png[28],
  };
}

/** Every chunk of a given type, concatenated. IDAT is split arbitrarily. */
function chunks(png, wanted) {
  const parts = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('latin1');
    if (type === wanted) parts.push(png.subarray(at + 8, at + 8 + length));
    if (type === 'IEND') break;
    at += length + 12;
  }
  return Buffer.concat(parts);
}

/** The Paeth predictor, from the PNG specification, unchanged. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * @returns {{width:number, height:number, at:(x:number,y:number)=>[number,number,number,number]}}
 */
export function decode(png) {
  const { width, height, bitDepth, colorType, interlace } = readHeader(png);
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(
      `this reader handles 8-bit RGBA, non-interlaced PNG only; got bitDepth=${bitDepth} ` +
      `colorType=${colorType} interlace=${interlace}`,
    );
  }

  const bpp = 4;
  const stride = width * bpp;
  const raw = inflateSync(chunks(png, 'IDAT'));
  const expected = (stride + 1) * height;
  if (raw.length !== expected) {
    throw new Error(`inflated ${raw.length} bytes, expected ${expected} - is this really 8-bit RGBA?`);
  }

  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? out[(y - 1) * stride + i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`unknown scanline filter ${filter} on row ${y}`);
      out[y * stride + i] = value & 0xff;
    }
  }

  return {
    width,
    height,
    at: (x, y) => {
      const i = y * stride + x * bpp;
      return [out[i], out[i + 1], out[i + 2], out[i + 3]];
    },
  };
}

/**
 * How far the icon's CONTENT reaches from the center, as a fraction of width.
 *
 * "Content" is anything that differs from the corner pixel, which is the
 * background on every icon here. A transparent corner works the same way: the
 * comparison includes alpha.
 *
 * @returns {{radius:number, fraction:number, box:{x0:number,y0:number,x1:number,y1:number}}}
 */
export function contentReach(png, { tolerance = 24 } = {}) {
  const image = decode(png);
  const corner = image.at(1, 1);
  const cx = (image.width - 1) / 2;
  const cy = (image.height - 1) / 2;

  let radius = 0;
  const box = { x0: image.width, y0: image.height, x1: 0, y1: 0 };
  let found = false;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const p = image.at(x, y);
      const differs = Math.abs(p[0] - corner[0]) + Math.abs(p[1] - corner[1])
        + Math.abs(p[2] - corner[2]) + Math.abs(p[3] - corner[3]);
      if (differs <= tolerance) continue;
      found = true;
      radius = Math.max(radius, Math.hypot(x - cx, y - cy));
      box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
    }
  }

  // A blank image would otherwise report a reach of 0 - the safest possible
  // number - and pass every assertion below it.
  if (!found) throw new Error('every pixel matches the corner; this image has no content');

  return { radius, fraction: radius / image.width, box };
}

/**
 * web.dev: the safe zone is "a circular area in the center of the icon with a
 * radius equal to 40% of the icon width", and "the outer 10% edge might be
 * cropped on some platforms".
 */
export const MASKABLE_SAFE_FRACTION = 0.4;

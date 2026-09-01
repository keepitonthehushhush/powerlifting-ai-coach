import test from 'node:test';
import assert from 'node:assert/strict';

import {
  oklch,
  oklchOf,
  perceivedLightness,
  hsl,
  contrast,
  luminance,
  solveFromPreferredOklch,
  AA_TEXT,
} from '../../web/src/lib/contrast.js';

/**
 * Thirty transcribed matrix coefficients sit behind these conversions. A single
 * mistyped digit would tint the entire product by an amount too small to notice
 * and too large to be right, and no other test in this repository would see it.
 * So the conversion is pinned to values published independently of us.
 */
test('OKLab matches the published sRGB primaries to five decimal places', () => {
  // CSS Color Module Level 4, sample values for the sRGB primaries.
  const published = [
    { hex: '#ffffff', l: 100.0, c: 0.0 },
    { hex: '#000000', l: 0.0, c: 0.0 },
    { hex: '#ff0000', l: 62.80, c: 0.2577, h: 29.23 },
    { hex: '#00ff00', l: 86.64, c: 0.2948, h: 142.50 },
    { hex: '#0000ff', l: 45.20, c: 0.3132, h: 264.05 },
  ];
  for (const ref of published) {
    const got = oklchOf(ref.hex);
    assert.ok(Math.abs(got.l - ref.l) < 0.01, `${ref.hex} lightness ${got.l} != ${ref.l}`);
    assert.ok(Math.abs(got.c - ref.c) < 0.0001, `${ref.hex} chroma ${got.c} != ${ref.c}`);
    if (ref.h !== undefined) {
      const dh = Math.abs(((got.h - ref.h + 540) % 360) - 180);
      assert.ok(dh < 0.02, `${ref.hex} hue ${got.h} != ${ref.h}`);
    }
  }
});

test('equal OKLCH lightness means equal luminance; equal HSL lightness does not', () => {
  // This is the mechanism behind everything else in this file, and the first
  // draft of this test asserted the opposite of it from memory.
  //
  // The guess was that OKLab lightness would diverge from luminance because it
  // is "perceptual". It does not: at a fixed chroma, OKLab L tracks luminance
  // closely - measured below at a 1.02x spread across four hues. OKLab does not
  // model the Helmholtz-Kohlrausch effect, so a saturated color does not get
  // extra lightness for being saturated.
  //
  // The real defect in HSL is simpler and worse: its lightness is not related
  // to luminance ACROSS hues at all. hsl(h, 88%, 58%) spans a 4x luminance
  // range as h moves, which is precisely why the contrast spread below is 3.2x.
  const hues = [264, 100, 142, 29];
  const spread = (xs) => Math.max(...xs) / Math.min(...xs);

  const oklchLum = hues.map((h) => luminance(oklch(70, 0.14, h)));
  const hslLum = hues.map((h) => luminance(hsl(h, 88, 58)));

  assert.ok(spread(oklchLum) < 1.2,
    `OKLCH luminance spread at equal lightness was ${spread(oklchLum).toFixed(3)}x`);
  assert.ok(spread(hslLum) > 3,
    `HSL luminance spread at equal lightness was only ${spread(hslLum).toFixed(3)}x`);

  // And the lightnesses really are equal, so the comparison above is fair.
  const Ls = hues.map((h) => perceivedLightness(oklch(70, 0.14, h)));
  assert.ok(Math.max(...Ls) - Math.min(...Ls) < 0.5);
});

test('the requested chroma is a ceiling, not a promise', () => {
  // No such color as a vivid yellow at lightness 15. Rather than clipping to
  // something the wrong weight, chroma gives way and lightness is held.
  const asked = 0.4;
  const hex = oklch(15, asked, 100);
  const got = oklchOf(hex);
  assert.ok(got.c < asked, 'chroma should have been reduced to reach sRGB');
  assert.ok(Math.abs(got.l - 15) < 1.5, `lightness drifted to ${got.l}, should hold near 15`);
});

test('lightness survives the round trip through 8-bit hex across the whole range', () => {
  let worst = 0;
  for (let l = 5; l <= 95; l += 5) {
    for (let h = 0; h < 360; h += 30) {
      worst = Math.max(worst, Math.abs(perceivedLightness(oklch(l, 0.12, h)) - l));
    }
  }
  // Some drift is inherent: 8-bit quantization plus gamut mapping at the ends.
  // Pinned so a regression that made it materially worse would be caught.
  assert.ok(worst < 2, `worst round-trip lightness drift was ${worst.toFixed(3)} points`);
});

/**
 * The measurement that justifies the whole file.
 *
 * This is not a guard against regression - it is evidence, kept executable so
 * that the claim in contrast.js stays true rather than becoming folklore. If
 * somebody later argues the palette should go back to HSL, this test is the
 * counter-argument and it runs.
 */
test('an HSL ladder value does not mean one thing; an OKLCH one does', () => {
  const ground = '#0f0d1a'; // the miami dark page
  const hues = [142, 214, 336, 42, 276, 8];

  const hslRatios = hues.map((h) => contrast(hsl(h, 88, 58), ground));
  const oklchRatios = hues.map((h) => contrast(oklch(70, 0.19, h), ground));

  const spread = (xs) => Math.max(...xs) / Math.min(...xs);

  assert.ok(spread(hslRatios) > 3,
    `HSL spread was ${spread(hslRatios).toFixed(2)}x - if this fell, re-derive the argument`);
  assert.ok(spread(oklchRatios) < 1.4,
    `OKLCH spread was ${spread(oklchRatios).toFixed(2)}x, expected well under 1.4x`);

  // And the sharp end of it: at that HSL ladder value one of the shipped hues
  // does not even clear AA, so the solver has to move it away from intent.
  assert.ok(Math.min(...hslRatios) < AA_TEXT, 'expected at least one HSL hue to fail AA at L 58');
  assert.ok(Math.min(...oklchRatios) >= AA_TEXT, 'every OKLCH hue should clear AA unaided');
});

test('the OKLCH solver still refuses to return a failing color', () => {
  const grounds = ['#0f0d1a', '#1b1830'];
  for (let h = 0; h < 360; h += 15) {
    const solved = solveFromPreferredOklch(h, 0.19, 70, grounds, AA_TEXT, { lighter: true });
    for (const g of grounds) {
      assert.ok(contrast(solved, g) >= AA_TEXT,
        `hue ${h} solved to ${solved}, only ${contrast(solved, g).toFixed(2)}:1 on ${g}`);
    }
  }
});

test('the solver keeps intent when intent is already legal', () => {
  // A preferred value that clears must come back untouched, or the ladder is
  // decorative and the palette is really just whatever the search returns.
  const grounds = ['#0f0d1a'];
  const preferred = 70;
  const solved = solveFromPreferredOklch(264, 0.14, preferred, grounds, AA_TEXT, { lighter: true });
  assert.equal(solved, oklch(preferred, 0.14, 264));
});

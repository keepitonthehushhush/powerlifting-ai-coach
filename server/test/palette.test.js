import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8');

/**
 * Colour choices are computable, so they get computed.
 *
 * This file exists because a comment in the stylesheet asserted that a link
 * colour reached 4.98:1 when it actually reached 3.48 - a claim that looked
 * authoritative, was written in good faith, and was wrong. A number in a
 * comment is a memory; a number from a function is a measurement.
 */

const AA_TEXT = 4.5;
const AA_LARGE = 3;

function channel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Split the stylesheet into base declarations and light-mode overrides.
 *
 * Not a single split point: the file has SEVERAL `:root` blocks and several
 * light media queries - brand tokens near the top, chart tokens next to the
 * charts. An earlier version of this helper cut the file at the first media
 * query and reported the chart tokens as missing entirely, because they live
 * below it. Brace-matching each media block is the only thing that survives
 * someone adding a third.
 */
function splitByMode(source) {
  const marker = '@media (prefers-color-scheme: light)';
  let base = '';
  let light = '';
  let i = 0;

  while (i < source.length) {
    const at = source.indexOf(marker, i);
    if (at === -1) {
      base += source.slice(i);
      break;
    }
    base += source.slice(i, at);

    // Walk to the matching close brace of the media block.
    let depth = 0;
    let j = source.indexOf('{', at);
    const bodyStart = j + 1;
    for (; j < source.length; j += 1) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    light += source.slice(bodyStart, j);
    i = j + 1;
  }

  return { base, light };
}

const SCOPES = splitByMode(css);

/** The LAST declaration wins, as it does in the cascade. */
function token(name, mode) {
  const scope = mode === 'light' ? SCOPES.light : SCOPES.base;
  const matches = [...scope.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))];
  return matches.length ? matches[matches.length - 1][1] : null;
}

const MODES = ['dark', 'light'];

describe('the palette is readable, measured rather than asserted', () => {
  for (const mode of MODES) {
    const bg = () => token('bg', mode) ?? token('bg', 'dark');
    const surface = () => token('surface', mode) ?? token('surface', 'dark');

    test(`${mode}: body text clears AA on both the page and a card`, () => {
      const text = token('text', mode) ?? token('text', 'dark');
      assert.ok(contrast(text, bg()) >= AA_TEXT, `text on bg is ${contrast(text, bg()).toFixed(2)}:1`);
      assert.ok(contrast(text, surface()) >= AA_TEXT, `text on surface is ${contrast(text, surface()).toFixed(2)}:1`);
    });

    test(`${mode}: muted text is muted, not unreadable`, () => {
      // Secondary ink is still ink. It carries the explanations under every
      // field in the intake form.
      const muted = token('muted', mode) ?? token('muted', 'dark');
      assert.ok(contrast(muted, surface()) >= AA_TEXT, `muted on surface is ${contrast(muted, surface()).toFixed(2)}:1`);
    });

    test(`${mode}: link colour clears AA as body text`, () => {
      // The regression this exists for. A link is text, so 4.5:1, not the 3:1
      // a chart mark or a border is allowed.
      const link = token('link', mode) ?? token('link', 'dark');
      assert.ok(link, `${mode} defines a --link token`);
      const onBg = contrast(link, bg());
      const onSurface = contrast(link, surface());
      assert.ok(onBg >= AA_TEXT, `link on bg is ${onBg.toFixed(2)}:1, needs ${AA_TEXT}`);
      assert.ok(onSurface >= AA_TEXT, `link on surface is ${onSurface.toFixed(2)}:1, needs ${AA_TEXT}`);
    });

    test(`${mode}: the primary button is legible against its own label`, () => {
      const accent = token('accent', mode) ?? token('accent', 'dark');
      const accentText = token('accent-text', mode) ?? token('accent-text', 'dark');
      assert.ok(
        contrast(accentText, accent) >= AA_TEXT,
        `button label on accent is ${contrast(accentText, accent).toFixed(2)}:1`,
      );
    });

    test(`${mode}: warning and error are readable, not just alarming`, () => {
      for (const name of ['warning', 'error']) {
        const colour = token(name, mode) ?? token(name, 'dark');
        const ratio = contrast(colour, surface());
        assert.ok(ratio >= AA_TEXT, `${name} on surface is ${ratio.toFixed(2)}:1`);
      }
    });

    test(`${mode}: chart marks clear the 3:1 a non-text mark needs`, () => {
      for (const name of ['chart-line', 'chart-missed']) {
        const colour = token(name, mode) ?? token(name, 'dark');
        const ratio = contrast(colour, surface());
        assert.ok(ratio >= AA_LARGE, `${name} on surface is ${ratio.toFixed(2)}:1`);
      }
    });
  }

  test('light mode re-steps its own values rather than inheriting the dark ones', () => {
    for (const name of ['bg', 'surface', 'text', 'muted', 'accent', 'link', 'chart-line']) {
      assert.notEqual(token(name, 'light'), token(name, 'dark'), `--${name} is identical in both modes`);
    }
  });
});

describe('the scheme does not borrow a name it has no right to', () => {
  test('the stylesheet names no television series', () => {
    // A colour pairing can only be protected by acquiring secondary meaning
    // within a product category, and nobody owns teal-and-magenta for strength
    // software. The NAME of the show that made the palette famous is a
    // different matter, so it appears nowhere - not in a class, not in a
    // comment, not in the UI.
    const files = [css, readFileSync(new URL('../../web/src/i18n/locales/en.js', import.meta.url), 'utf8')];
    for (const file of files) {
      assert.doesNotMatch(file, /miami/i, 'the product must not borrow a trademarked name');
    }
  });
});

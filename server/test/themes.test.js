import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES,
  THEME_IDS,
  THEME_TOKENS,
  MODES,
  DEFAULT_THEME_ID,
  tokensFor,
  isThemeId,
} from '../../web/src/lib/themes.js';
import { contrast, hsl, luminance, solveFromPreferred, AA_TEXT, AA_LARGE } from '../../web/src/lib/contrast.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';
import { readSource } from './helpers/source.js';

/**
 * Ten themes, two modes, and none of them picked by eye.
 *
 * The palette test next door measures the DEFAULT scheme out of the
 * stylesheet. This measures every other one, with the same functions and the
 * same thresholds - because a theme somebody chose is the theme they read the
 * app in, and "the default is accessible" is not a claim about the other nine.
 *
 * Every requirement below is the same one the stylesheet already had to meet.
 * Nothing here is a lower bar for being a theme.
 */

describe('the color math is right before anything is measured with it', () => {
  test('known WCAG ratios come out correct', () => {
    // If this is wrong, every other assertion in this file is confidently
    // wrong too, which is the failure this project keeps finding. Black on
    // white is exactly 21:1 by definition.
    assert.equal(Number(contrast('#000000', '#ffffff').toFixed(2)), 21);
    assert.equal(Number(contrast('#ffffff', '#ffffff').toFixed(2)), 1);
    // #767676 on white is the canonical "just passes AA" gray.
    assert.ok(contrast('#767676', '#ffffff') >= AA_TEXT);
    assert.ok(contrast('#777777', '#ffffff') < AA_TEXT);
  });

  test('contrast does not care which way round the pair is given', () => {
    assert.equal(contrast('#123456', '#abcdef'), contrast('#abcdef', '#123456'));
  });

  test('hsl produces the primaries it should', () => {
    assert.equal(hsl(0, 100, 50), '#ff0000');
    assert.equal(hsl(120, 100, 50), '#00ff00');
    assert.equal(hsl(240, 100, 50), '#0000ff');
    assert.equal(hsl(0, 0, 100), '#ffffff');
    assert.equal(hsl(0, 0, 0), '#000000');
  });

  test('the solver keeps the designed lightness when it is already legal', () => {
    // The whole point of solveFromPreferred: intent survives where it is
    // compliant. A solver that always moved the value would be the "minimum
    // that passes" behavior that produced a dark-olive yellow.
    const ground = ['#101010'];
    const wanted = hsl(214, 88, 58);
    assert.ok(contrast(wanted, ground[0]) >= AA_TEXT, 'fixture must already pass, or this proves nothing');
    assert.equal(solveFromPreferred(214, 88, 58, ground, AA_TEXT), wanted);
  });

  test('and moves it away from the ground when it is not', () => {
    const ground = ['#ffffff'];
    // Pale yellow on white cannot pass; the solver must darken it.
    const solved = solveFromPreferred(50, 90, 85, ground, AA_TEXT);
    assert.ok(contrast(solved, '#ffffff') >= AA_TEXT, `solved to ${solved}`);
    assert.ok(luminance(solved) < luminance(hsl(50, 90, 85)), 'it should have gone darker, not lighter');
  });
});

describe('the catalog is well formed', () => {
  test('there are ten themes and the ids are unique', () => {
    assert.equal(THEMES.length, 10);
    assert.equal(new Set(THEME_IDS).size, 10);
  });

  test('exactly one theme is the default', () => {
    assert.equal(THEMES.filter((t) => t.isDefault).length, 1);
    assert.ok(THEME_IDS.includes(DEFAULT_THEME_ID));
  });

  test('every theme is either declared literally or has a seed, never both', () => {
    for (const theme of THEMES) {
      const literal = Boolean(theme.tokens);
      const generated = Boolean(theme.seed);
      assert.ok(literal !== generated, `${theme.id} must have exactly one of tokens or seed`);
    }
  });

  test('the default theme is the literal one, so the brand is not regenerated', () => {
    // The stylesheet argues for those exact values at length. If the default
    // ever becomes generated, the app silently changes color for everyone who
    // never opens the picker.
    assert.ok(THEMES.find((t) => t.isDefault).tokens, 'the default theme must be declared literally');
  });

  test('the default palette matches the stylesheet it is copied from', () => {
    /*
     * The one real drift risk in this design. The default theme is a copy of
     * the values in styles.css, and a copy can go stale - somebody tunes the
     * stylesheet, the picker keeps painting the old brand, and the difference
     * is invisible because both look plausible.
     */
    const css = readSource(new URL('../../web/src/styles.css', import.meta.url));
    for (const mode of MODES) {
      const tokens = tokensFor(DEFAULT_THEME_ID, mode);
      const scope =
        mode === 'light'
          ? css.slice(css.indexOf('@media (prefers-color-scheme: light)'))
          : css.slice(0, css.indexOf('@media (prefers-color-scheme: light)'));
      for (const name of ['bg', 'surface', 'text', 'accent', 'link']) {
        const found = scope.match(new RegExp(`--${name}:\\s*([^;]+);`));
        assert.ok(found, `--${name} not found in the ${mode} stylesheet block`);
        assert.equal(
          tokens[name].toLowerCase(),
          found[1].trim().toLowerCase(),
          `--${name} in ${mode}: the catalog and the stylesheet disagree`,
        );
      }
    }
  });

  test('an unknown id falls back to the default rather than throwing', () => {
    // A retired holiday theme, or a row written by a newer deploy, must show
    // somebody the default palette. A blank page is not an acceptable answer
    // to a stale preference.
    for (const bogus of ['halloween-2019', '', null, undefined, 42, {}]) {
      assert.deepEqual(tokensFor(bogus, 'dark'), tokensFor(DEFAULT_THEME_ID, 'dark'));
      assert.equal(isThemeId(bogus), false);
    }
  });

  test('an unknown mode falls back to dark rather than producing nothing', () => {
    assert.deepEqual(tokensFor(DEFAULT_THEME_ID, 'sepia'), tokensFor(DEFAULT_THEME_ID, 'dark'));
  });

  test('every theme is named and described in every locale', () => {
    for (const [name, locale] of [['en', en], ['es', es]]) {
      for (const id of THEME_IDS) {
        assert.ok(locale.themes?.names?.[id], `${name} is missing a name for ${id}`);
        assert.ok(locale.themes?.blurbs?.[id], `${name} is missing a blurb for ${id}`);
      }
      // The other direction: a string for a theme that no longer exists is
      // dead weight that makes the next missing one harder to spot.
      for (const id of Object.keys(locale.themes.names)) {
        assert.ok(THEME_IDS.includes(id), `${name} names "${id}", which is not in the catalog`);
      }
    }
  });
});

describe('every theme in every mode is readable, measured not asserted', () => {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      const label = `${theme.id}/${mode}`;
      const k = () => tokensFor(theme.id, mode);

      test(`${label}: defines every token`, () => {
        const tokens = k();
        for (const name of THEME_TOKENS) {
          assert.ok(tokens[name], `${label} is missing --${name}`);
        }
      });

      test(`${label}: body and muted text clear AA on the page AND on a card`, () => {
        const t = k();
        // Both grounds, because which one is harder flips between modes and
        // checking only the easy one is how this was missed the first time.
        for (const ink of ['text', 'muted']) {
          for (const ground of ['bg', 'surface']) {
            const r = contrast(t[ink], t[ground]);
            assert.ok(r >= AA_TEXT, `${label} ${ink} on ${ground} is ${r.toFixed(2)}:1`);
          }
        }
      });

      test(`${label}: links clear AA as body text, not as decoration`, () => {
        const t = k();
        for (const ground of ['bg', 'surface']) {
          const r = contrast(t.link, t[ground]);
          assert.ok(r >= AA_TEXT, `${label} link on ${ground} is ${r.toFixed(2)}:1`);
        }
      });

      test(`${label}: the primary button is legible against its own label`, () => {
        const t = k();
        const r = contrast(t['accent-text'], t.accent);
        assert.ok(r >= AA_TEXT, `${label} button label on accent is ${r.toFixed(2)}:1`);
      });

      test(`${label}: warning and error are readable, not just alarming`, () => {
        const t = k();
        for (const name of ['warning', 'error']) {
          const r = contrast(t[name], t.surface);
          assert.ok(r >= AA_TEXT, `${label} ${name} on surface is ${r.toFixed(2)}:1`);
        }
      });

      test(`${label}: a form control's boundary clears WCAG 1.4.11`, () => {
        const t = k();
        const r = contrast(t['field-border'], t['surface-2']);
        assert.ok(r >= AA_LARGE, `${label} field boundary on its own fill is ${r.toFixed(2)}:1`);
      });

      test(`${label}: the decorative border is not reused for controls`, () => {
        assert.notEqual(k()['field-border'], k().border);
      });

      test(`${label}: chart marks survive this theme's surface`, () => {
        // The chart pair is NOT themed - it is validated for color-vision
        // separation, which a hue picked for a holiday pack would not be. That
        // only holds if every theme's surface stays somewhere the fixed marks
        // can be seen against, so it is checked per theme rather than assumed.
        const t = k();
        for (const name of ['chart-line', 'chart-missed']) {
          const r = contrast(t[name], t.surface);
          assert.ok(r >= AA_LARGE, `${label} ${name} on surface is ${r.toFixed(2)}:1`);
        }
      });

      test(`${label}: the washes are too faint to move a ratio underneath them`, () => {
        const t = k();
        for (const name of ['wash-cool', 'wash-warm']) {
          const alpha = Number(t[name].match(/,\s*([0-9.]+)\)$/)?.[1]);
          assert.ok(Number.isFinite(alpha), `${label} --${name} is not an rgba value`);
          assert.ok(alpha <= 0.1, `${label} --${name} at alpha ${alpha} is too strong`);
        }
      });
    }
  }
});

describe('the themes are actually different from one another', () => {
  test('no two themes share an accent in either mode', () => {
    // A gallery of ten options where two look identical is a gallery of nine
    // options and a bug report.
    for (const mode of MODES) {
      const accents = THEME_IDS.map((id) => tokensFor(id, mode).accent);
      assert.equal(new Set(accents).size, accents.length, `${mode} has duplicate accents`);
    }
  });

  test('light and dark are re-stepped, not reused', () => {
    for (const id of THEME_IDS) {
      const dark = tokensFor(id, 'dark');
      const light = tokensFor(id, 'light');
      for (const name of ['bg', 'surface', 'text', 'muted', 'accent']) {
        assert.notEqual(dark[name], light[name], `${id}: --${name} is identical in both modes`);
      }
    }
  });

  test('dark themes are dark and light themes are light', () => {
    for (const id of THEME_IDS) {
      assert.ok(luminance(tokensFor(id, 'dark').bg) < 0.1, `${id} dark bg is not dark`);
      assert.ok(luminance(tokensFor(id, 'light').bg) > 0.7, `${id} light bg is not light`);
    }
  });

  test('the monochrome theme really has no color in it', () => {
    // Mono is the one theme whose promise is checkable by machine, and the
    // first draft broke it - default saturation made a theme called Mono come
    // out bright red, which no contrast check had an opinion about.
    for (const mode of MODES) {
      const t = tokensFor('mono', mode);
      for (const name of ['bg', 'surface', 'surface-2', 'border', 'text', 'muted', 'accent', 'field-border']) {
        const [r, g, b] = t[name].replace('#', '').match(/../g).map((h) => parseInt(h, 16));
        assert.ok(
          Math.max(r, g, b) - Math.min(r, g, b) <= 2,
          `mono/${mode} --${name} is ${t[name]}, which has a hue`,
        );
      }
    }
  });
});

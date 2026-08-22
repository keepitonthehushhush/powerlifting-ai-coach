import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';

/**
 * Translation completeness, checked mechanically.
 *
 * A missing translation key does not crash - `t()` falls back to English - so
 * it ships silently and a Spanish-speaking user gets a page in two languages.
 * The only reliable way to catch that is to compare the catalogues in CI, which
 * is what this does. Adding a locale means adding one line here and getting
 * told exactly which keys are outstanding.
 */

/** Flatten to dotted paths so two catalogues can be compared as key sets. */
function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' ? flatten(value, path) : [path];
  });
}

/** Placeholders such as {name} must survive translation, or interpolation breaks. */
function placeholders(text) {
  return (String(text).match(/\{(\w+)\}/g) ?? []).sort();
}

function valueAt(object, path) {
  return path.split('.').reduce((node, part) => node?.[part], object);
}

const REFERENCE = en;
const LOCALES = { es };

describe('locale catalogues', () => {
  const referenceKeys = flatten(REFERENCE);

  test('the reference catalogue is non-trivial', () => {
    assert.ok(referenceKeys.length > 40, `expected a real catalogue, found ${referenceKeys.length} keys`);
  });

  for (const [code, catalogue] of Object.entries(LOCALES)) {
    const keys = flatten(catalogue);

    test(`${code}: has every key in the reference catalogue`, () => {
      const missing = referenceKeys.filter((key) => !keys.includes(key));
      assert.deepEqual(missing, [], `${code} is missing: ${missing.join(', ')}`);
    });

    test(`${code}: has no keys the reference catalogue lacks`, () => {
      // An orphan key is either a typo or a string deleted from English and
      // left behind - both are worth failing on.
      const extra = keys.filter((key) => !referenceKeys.includes(key));
      assert.deepEqual(extra, [], `${code} has orphan keys: ${extra.join(', ')}`);
    });

    test(`${code}: every value is a non-empty string`, () => {
      const bad = keys.filter((key) => {
        const value = valueAt(catalogue, key);
        return typeof value !== 'string' || value.trim() === '';
      });
      assert.deepEqual(bad, [], `${code} has empty or non-string values: ${bad.join(', ')}`);
    });

    test(`${code}: preserves interpolation placeholders`, () => {
      const mismatched = referenceKeys.filter((key) => {
        const source = placeholders(valueAt(REFERENCE, key));
        const target = placeholders(valueAt(catalogue, key) ?? '');
        return JSON.stringify(source) !== JSON.stringify(target);
      });
      assert.deepEqual(mismatched, [], `${code} has placeholder drift in: ${mismatched.join(', ')}`);
    });

    test(`${code}: is actually translated, not copied`, () => {
      // A handful of legitimate identical strings exist (the app name, "Coach"),
      // so this checks the proportion rather than demanding every string differ.
      const identical = referenceKeys.filter(
        (key) => valueAt(REFERENCE, key) === valueAt(catalogue, key)
      );
      const ratio = identical.length / referenceKeys.length;
      assert.ok(ratio < 0.2, `${code}: ${identical.length}/${referenceKeys.length} strings are untranslated`);
    });
  }
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { readRaw, readSource, stripComments } from './helpers/source.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';

/**
 * Translation completeness, checked mechanically.
 *
 * A missing translation key does not crash - `t()` falls back to English - so
 * it ships silently and a Spanish-speaking user gets a page in two languages.
 * The only reliable way to catch that is to compare the catalogs in CI, which
 * is what this does. Adding a locale means adding one line here and getting
 * told exactly which keys are outstanding.
 */

/** Flatten to dotted paths so two catalogs can be compared as key sets. */
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

/**
 * ── EVERY KEY THE APP ASKS FOR, AND EVERY KEY THE CATALOG DECLARES ──────
 *
 * The suite above compares the catalogs to each other. That is necessary and
 * it is not sufficient: it cannot see a key the app asks for that no catalog
 * has, and it cannot see a key declared twice, because JavaScript resolves a
 * duplicate before any test gets to look at the object.
 *
 * Both gaps had shipped. `auth` declared `password` twice - once the string
 * 'Password' for the field label, once an object of password-strength strings.
 * The object won, `t('auth.password')` returned an object, and `t()` falls back
 * to returning the key itself, so the live sign-in page had a field labeled
 * "auth.password" for as long as the second declaration existed. Nothing
 * failed: en and es were duplicated identically, so they still matched.
 */

const WEB_SRC = new URL('../../web/src/', import.meta.url);

/** Every .js/.jsx file under web/src. */
function sourceFiles(dir = WEB_SRC) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.jsx?$/.test(entry.name) ? [child] : [];
  });
}

const APP_SOURCES = sourceFiles().map((url) => ({ url, text: readSource(url) }));

describe('the keys the app actually asks for', () => {
  /** Keys passed straight to t() - these must resolve, and to a string. */
  const staticCalls = new Map();
  /** Any dotted literal anywhere: `key: 'nav.coach'` and t(a ? 'x' : 'y') both count. */
  const mentioned = new Set();
  /** The literal head of a computed key, wherever it is built. */
  const computedPrefixes = new Map();

  for (const { url, text } of APP_SOURCES) {
    const where = url.pathname.split('/web/src/')[1];
    for (const match of text.matchAll(/\bt\(\s*(['"])([A-Za-z][\w.]*)\1/g)) {
      if (!staticCalls.has(match[2])) staticCalls.set(match[2], where);
    }
    // Not only inside t(): a key is routinely put in a table and translated
    // somewhere else entirely - SiteNav's routes carry `key: 'nav.coach'`.
    for (const match of text.matchAll(/(['"`])([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+)\1/g)) {
      mentioned.add(match[2]);
    }
    // `intake.gymEquipment.${slug}` - assigned to a variable as often as passed
    // to t() directly, so this looks for the shape rather than the call.
    for (const match of text.matchAll(/`([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)*)\.\$\{/g)) {
      if (!computedPrefixes.has(match[1])) computedPrefixes.set(match[1], where);
    }
  }
  const dynamicPrefixes = computedPrefixes;

  test('the scan found the call sites', () => {
    assert.ok(staticCalls.size > 100, `expected the app to translate a lot, found ${staticCalls.size} keys`);
    assert.ok(dynamicPrefixes.size > 0, 'expected at least one computed key - has the pattern changed?');
  });

  test('every literal t() key resolves to a string', () => {
    const broken = [...staticCalls].filter(([key]) => typeof valueAt(REFERENCE, key) !== 'string');
    assert.deepEqual(
      broken.map(([key, where]) => `${key} (${where}) -> ${typeof valueAt(REFERENCE, key)}`),
      [],
      't() returns the key itself when a lookup misses, so these render as raw text'
    );
  });

  test('every computed t() key has a branch to look inside', () => {
    const broken = [...dynamicPrefixes].filter(([prefix]) => {
      const node = valueAt(REFERENCE, prefix);
      return node === null || typeof node !== 'object';
    });
    assert.deepEqual(broken.map(([prefix, where]) => `${prefix} (${where})`), []);
  });

  test('every key the source mentions exists in the catalogue', () => {
    // The mirror of the test below, and the one that costs a real bug when it
    // is missing: deleting a string that SiteNav reaches through a table
    // (`key: 'nav.progress'`) breaks a nav label and no literal t() call
    // changes, so nothing else here would notice. It happened while writing
    // this file.
    const namespaces = Object.keys(REFERENCE);
    const missing = [...mentioned]
      .filter((key) => namespaces.includes(key.split('.')[0]))
      .filter((key) => typeof valueAt(REFERENCE, key) !== 'string');
    assert.deepEqual(missing, [], `the source asks for keys the catalogue does not have: ${missing.join(', ')}`);
  });

  test('no catalogue key is left unused', () => {
    // A string nobody asks for is either dead or evidence of a rename that
    // missed a call site. Computed keys make this approximate, so a key under a
    // prefix something computes is treated as reachable.
    const computed = [...computedPrefixes.keys()];
    const orphans = flatten(REFERENCE).filter(
      (key) => !mentioned.has(key) && !computed.some((prefix) => key.startsWith(`${prefix}.`))
    );
    assert.deepEqual(orphans, [], `unreferenced catalogue keys: ${orphans.join(', ')}`);
  });
});

/**
 * Duplicate declarations, found in the SOURCE.
 *
 * This has to read the file rather than the imported object, because by the
 * time `en` is an object the duplicate is gone - the later declaration has
 * silently replaced the earlier one. That is the whole failure mode.
 *
 * The scan is indentation-based, which is sound here because these files are
 * formatted and asserted to be: the key count it recovers is compared against
 * the count from the imported catalog, so a scanner that quietly stopped
 * understanding the file fails instead of passing vacuously.
 */
describe('locale sources', () => {
  const LOCALE_FILES = {
    en: new URL('../../web/src/i18n/locales/en.js', import.meta.url),
    es: new URL('../../web/src/i18n/locales/es.js', import.meta.url),
  };
  const CATALOGUES = { en, es };

  function declaredPaths(text) {
    const stack = [];
    const paths = [];
    for (const line of stripComments(text).split('\n')) {
      const match = line.match(/^(\s*)([A-Za-z_$][\w$]*)\s*:\s*(\{?)\s*$|^(\s*)([A-Za-z_$][\w$]*)\s*:\s*(?=\S)/);
      if (!match) continue;
      const indent = (match[1] ?? match[4]).length;
      const key = match[2] ?? match[5];
      const opensBranch = match[3] === '{';
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      paths.push([...stack.map((frame) => frame.key), key].join('.'));
      if (opensBranch) stack.push({ indent, key });
    }
    return paths;
  }

  for (const [code, url] of Object.entries(LOCALE_FILES)) {
    const paths = declaredPaths(readRaw(url));

    test(`${code}: the scanner understands the file`, () => {
      const fromObject = flatten(CATALOGUES[code]).length;
      const unique = new Set(paths).size;
      // Every leaf plus every branch is declared, so the source must declare at
      // least as many paths as the flattened object has leaves.
      assert.ok(
        unique >= fromObject,
        `scanned ${unique} declarations but the catalogue has ${fromObject} leaves - the scan is missing lines`
      );
    });

    test(`${code}: declares no key twice`, () => {
      const seen = new Set();
      const duplicated = paths.filter((path) => (seen.has(path) ? true : (seen.add(path), false)));
      assert.deepEqual(
        [...new Set(duplicated)],
        [],
        'the later declaration silently wins, so one of these strings can never be reached'
      );
    });
  }
});

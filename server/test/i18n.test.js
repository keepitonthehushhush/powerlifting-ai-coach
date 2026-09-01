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

/**
 * ── THE CLEARANCE REQUIREMENT MUST SURVIVE TRANSLATION ────────────────────
 *
 * This product's central safety gate is that an athlete reporting pain or an
 * injury gets no program until a professional has CLEARED them. Four strings
 * carry that promise to the user, and a translation can weaken it without
 * anything failing: the Spanish medical disclaimer said "consulta con un
 * médico o fisioterapeuta antes de entrenar" - consult a doctor - where the
 * English says "get clearance from", and where every other Spanish string in
 * this catalog already said "dar el alta".
 *
 * Consulting is not being cleared. A Spanish-speaking athlete was asked for
 * something weaker than the English asks, in the one string whose whole job
 * is to state the limit of what this app is.
 *
 * RAE glosses `alta` as "autorización que da el médico para que un paciente se
 * reincorpore a la vida ordinaria", and its own example sentence is a
 * returning athlete: "El doctor le firmó el alta y hoy ha vuelto a
 * entrenarse". The term the rest of the catalog used was already right; only
 * the disclaimer had drifted.
 *
 * Checked WITHIN a locale rather than across them, because the right word
 * differs per language and only a speaker of it can say what that word is.
 * What this enforces is agreement among the four - which is what would have
 * caught this one, since three of the four already agreed.
 */
describe('the clearance requirement is not weakened by translation', () => {
  /*
   * The vocabulary each locale uses for "a professional has cleared you".
   * A new locale means a new line here, added deliberately with somebody who
   * speaks it, rather than a catalog quietly inheriting an English
   * assumption.
   */
  const CLEARANCE = {
    en: /\bclear(ed|ance)\b/i,
    es: /\balta\b|\bautoriz/i,
  };

  /** The four strings that carry the promise to the user. */
  const CARRIERS = [
    'medical.disclaimer',
    'home.honestDoctor',
    'intake.clearedLabel',
    'intake.clearanceWarning',
  ];

  const pick = (catalog, path) => path.split('.').reduce((o, k) => o?.[k], catalog);

  for (const [name, catalog] of Object.entries({ en, ...LOCALES })) {
    describe(name, () => {
      test('this locale has declared clearance vocabulary', () => {
        // Without an entry, every assertion below would skip and pass.
        assert.ok(CLEARANCE[name], `no clearance vocabulary declared for "${name}"`);
      });

      for (const path of CARRIERS) {
        test(`${path} says cleared, not merely consulted`, () => {
          const text = pick(catalog, path);
          assert.equal(typeof text, 'string', `${path} is missing from ${name}`);
          assert.match(
            text,
            CLEARANCE[name],
            `${name}.${path} does not use this locale's clearance wording: ${text}`
          );
        });
      }
    });
  }

  test('the check can fail: consultation wording alone does not satisfy it', () => {
    // The exact sentence that was shipping, so writing it again fails here.
    const weakened =
      'Si tienes dolor, una lesión o una condición de salud, consulta con un médico o fisioterapeuta antes de entrenar.';
    assert.doesNotMatch(weakened, CLEARANCE.es, 'the Spanish pattern accepts "consulta con" as clearance');
    assert.doesNotMatch('please see a doctor before training', CLEARANCE.en);
  });
});

/**
 * ── THE SPANISH IS MEXICAN SPANISH, AND THAT IS CHECKED ───────────────────
 *
 * "Spanish" is not one target. This app is run from Michigan for lifters in
 * the United States, where the largest Spanish-speaking population by far is
 * of Mexican origin. So peninsular vocabulary is a defect in this catalog
 * rather than a matter of taste, and the catalog says so in its header.
 *
 * Two kinds of entry below, and they are not the same kind of wrong.
 *
 * ONE IS NOT REGISTER. `coger` is entirely ordinary in Spain — to take, to
 * catch, to pick up — and RAE marks sense 31 "vulg. ... Am. Cen., Arg., Bol.,
 * Méx., Par., R. Dom., Ur. y Ven.: realizar el acto sexual". A translator
 * reaching for the Spain-normal word ships obscenity to this audience. It is
 * in this list even though it appears nowhere in the catalog today, because
 * the day it appears is the day nobody is looking.
 *
 * THE REST ARE REGISTER, and they are listed as such honestly: `pulsar` a
 * button, `rellenar` a form, `introducir` data are all correct Spanish. They
 * simply read as Spain, the way `whilst` and `programme` read as Britain in
 * the English catalog — which this project already checks, for the same
 * reason, in americanEnglish.test.js.
 *
 * Enumerated one by one rather than expressed as a pattern, for the reason
 * that file gives: a check with false positives is a check somebody turns
 * off.
 */
describe('the Spanish catalog is Mexican Spanish', () => {
  const PENINSULAR = [
    // Dictionary-backed, and the reason this list exists at all.
    [/\bcoger|\bcoge\b|\bcojo\b/i, 'coger', 'tomar / agarrar — RAE marks this vulgar in Mexico'],
    // Verb forms and pronouns that exist only in Spain.
    [/\bvosotros\b|\bvuestr[oa]s?\b/i, 'vosotros/vuestro', 'ustedes / su'],
    [/\b\w+([áé]is)\b/i, '-áis/-éis verb forms', 'the ustedes form'],
    // Everyday vocabulary that differs.
    [/\bordenador/i, 'ordenador', 'computadora'],
    [/\bm[óo]vil\b/i, 'móvil', 'celular'],
    [/\bzumo/i, 'zumo', 'jugo'],
    [/\bfichero/i, 'fichero', 'archivo'],
    [/\benhorabuena/i, 'enhorabuena', 'felicidades'],
    [/\bgafas\b/i, 'gafas', 'lentes'],
    [/\bpiso\b/i, 'piso', 'departamento'],
    // UI verbs. Correct Spanish; they read as Spain.
    [/\bpuls(a|e|ar|ando)\b/i, 'pulsar', 'tocar / seleccionar / presionar'],
    [/\brellen(a|e|ar|ando)\b/i, 'rellenar', 'llenar'],
    [/\bintroduc(e|es|ir|iendo|zca)\b/i, 'introducir (data entry)', 'ingresar / escribir'],
  ];

  /**
   * The values only. Keys are identifiers and share their names with the
   * English catalog by design; scanning them would report `deleteButton` as
   * bad Spanish, which is the shape of false positive that gets a check
   * switched off.
   */
  function spanishCopy() {
    const flat = (o) =>
      Object.values(o).flatMap((v) => (v && typeof v === 'object' ? flat(v) : [String(v)]));
    return flat(es).join('\n');
  }

  test('there is copy to check at all', () => {
    // A reader that finds nothing passes every assertion below it.
    const copy = spanishCopy();
    assert.ok(copy.length > 8000, `only ${copy.length} characters — the reader is broken`);
    assert.match(copy, /entrenamiento|entrenador/i, 'that is not the Spanish catalog');
  });

  for (const [pattern, word, instead] of PENINSULAR) {
    test(`no "${word}"`, () => {
      const copy = spanishCopy();
      const hit = pattern.exec(copy);
      const context = hit
        ? copy.slice(Math.max(0, hit.index - 70), hit.index + 70).replace(/\s+/g, ' ')
        : '';
      assert.equal(hit, null, `"${word}" is peninsular — use ${instead}. …${context}…`);
    });
  }

  test('and the check can fail, on the sentences that were actually in here', () => {
    /*
     * The property worth proving. Three of these shipped: "Pulsa una para ir
     * directamente a ella", "Introduce los seis dígitos", "Marcar una rellena
     * el cuadro". The fourth never did and must never.
     */
    const planted = [
      ['Pulsa una para ir directamente a ella.', 'pulsar'],
      ['Introduce los seis dígitos que muestra tu aplicación.', 'introducir (data entry)'],
      ['Marcar una rellena el cuadro de equipamiento.', 'rellenar'],
      ['Puedes coger la barra con agarre mixto.', 'coger'],
      ['¿Qué peso movéis normalmente?', '-áis/-éis verb forms'],
    ];
    for (const [sentence, expected] of planted) {
      const caught = PENINSULAR.filter(([p]) => p.test(sentence)).map(([, w]) => w);
      assert.ok(caught.includes(expected), `"${sentence}" was not caught as ${expected}`);
    }
  });

  test('and does not fire on ordinary Mexican Spanish', () => {
    // The false-positive half. A check that flags correct copy is a check
    // somebody deletes.
    const fine = [
      'Ingresa los seis dígitos que muestra tu aplicación.',
      'Selecciona una para ir directamente a ella.',
      'Llena el cuadro de equipamiento con lo que tenga tu gimnasio.',
      'Un médico o fisioterapeuta te ha dado el alta para entrenar.',
      'Registra tus series de sentadilla, press de banca y peso muerto.',
    ];
    for (const sentence of fine) {
      const caught = PENINSULAR.filter(([p]) => p.test(sentence)).map(([, w]) => w);
      assert.deepEqual(caught, [], `flagged correct copy: "${sentence}"`);
    }
  });
});

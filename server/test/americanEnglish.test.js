import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { stripComments } from './helpers/source.js';

/**
 * ── WHY A CHECK AND NOT JUST A SWEEP ──────────────────────────────────────
 *
 * "Spell program the American way and use american english not uk english
 * with the wording on the website."
 *
 * One pass fixed 103 of them across 20 files. A pass is a moment; the next
 * feature written in the same hand puts "programme" straight back, and nobody
 * reviewing a diff notices a spelling that looked right to the person who
 * typed it. The sweep is only worth having if something holds it.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 *
 * It reads COPY, never code. Identifiers keep whatever spelling they were born
 * with - `normaliseRoute`, `fuellingRanges`, the `cancelled` refs in four
 * components, the `checkoutCancelled` i18n key. Renaming those is churn with
 * no reader on the other end of it, and a check that demanded it would be
 * satisfied by renaming things rather than by writing better copy.
 *
 * So each surface is reduced to the text a person actually sees, and only then
 * scanned:
 *   - en.js          the quoted VALUES, which is the whole UI catalogue
 *   - the prompt     its literal text, with interpolations removed
 *   - the pages      JSX text nodes, which excludes attributes and braces
 *
 * Spanish is not scanned. es.js is Spanish.
 */

const BRITISH = [
  /*
   * The one that was asked for, and by far the most common here.
   *
   * The trailing `(s)?\b` is load-bearing. Written as /\bprogramme/i this also
   * matches "programmed" - which is correct American English and appears all
   * over the coaching prompt - so the check would have started failing on good
   * copy the first time somebody wrote "a programmed single". A check with
   * false positives is a check somebody turns off, which is the whole reason
   * the -ise list below is enumerated rather than expressed as one pattern.
   */
  [/\bprogramme(s)?\b/i, 'programme', 'program'],
  // Usage, which matters more than spelling on a product that talks to
  // clinicians. This one was in a footer link and in the medical disclaimer.
  [/\bphysiotherap/i, 'physiotherapist', 'physical therapist'],
  [/\bcolour/i, 'colour', 'color'],
  [/\bbehaviour/i, 'behaviour', 'behavior'],
  [/\bfavour/i, 'favour', 'favor'],
  [/\bhonour/i, 'honour', 'honor'],
  [/\bhumour/i, 'humour', 'humor'],
  [/\bdefence/i, 'defence', 'defense'],
  [/\boffence/i, 'offence', 'offense'],
  [/\bcentre/i, 'centre', 'center'],
  [/\bfibre/i, 'fibre', 'fiber'],
  [/\blitre/i, 'litre', 'liter'],
  [/\btheatre/i, 'theatre', 'theater'],
  [/\bwhilst\b/i, 'whilst', 'while'],
  [/\bamongst\b/i, 'amongst', 'among'],
  [/\bcancelled/i, 'cancelled', 'canceled'],
  [/\bfuelling/i, 'fuelling', 'fueling'],
  [/\blabelled/i, 'labelled', 'labeled'],
  [/\bmodelling/i, 'modelling', 'modeling'],
  [/\bjudgement/i, 'judgement', 'judgment'],
  [/\bageing/i, 'ageing', 'aging'],
  [/\bsceptic/i, 'sceptic', 'skeptic'],
  [/\bcoeliac/i, 'coeliac', 'celiac'],
  [/\bfortnight/i, 'fortnight', 'two weeks'],
  [/\bmaths\b/i, 'maths', 'math'],
  [/\bgrey\b/i, 'grey', 'gray'],
  // -ise / -isation, listed one by one rather than as a single /is(e|ation)\b/,
  // which also matches advise, exercise, promise, raise, surprise and a dozen
  // others spelled that way in both. A check with false positives gets turned
  // off, so this one has to survive the person it annoys.
  [/\borganis(e|ed|ing|ation)/i, 'organise', 'organize'],
  [/\brecognis(e|ed|ing)/i, 'recognise', 'recognize'],
  [/\bapologis(e|ed|ing)/i, 'apologise', 'apologize'],
  [/\brealis(e|ed|ing)/i, 'realise', 'realize'],
  [/\bprioritis(e|ed|ing)/i, 'prioritise', 'prioritize'],
  [/\bnormalis(e|ed|ing)/i, 'normalise', 'normalize'],
  [/\bmoralis(e|ed|ing)/i, 'moralise', 'moralize'],
  [/\bspecialis(e|ed|ing)/i, 'specialise', 'specialize'],
  [/\banalys(e|ed|ing)\b/i, 'analyse', 'analyze'],
];

/** Everything between quotes in the locale file: the values, and nothing else. */
function localeCopy() {
  const source = stripComments(
    readFileSync(new URL('../../web/src/i18n/locales/en.js', import.meta.url), 'utf8')
  );
  return [...source.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).join('\n');
}

/**
 * The prompt's literal text, with imports and interpolations taken out.
 *
 * The interpolations have to be removed by COUNTING braces, not by a regex.
 * `/\$\{[^}]*\}/` stops at the first closing brace, so
 * `${fuellingRanges({ bodyweight, units })}` leaves `fuellingRanges(...)`
 * behind - and the check then reports the identifier `fuellingRanges` as
 * British copy. It did, on the first run. A false positive on an identifier is
 * exactly the failure this file's header promises not to produce.
 */
function stripInterpolations(source) {
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '$' && source[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') depth -= 1;
        i += 1;
      }
      i -= 1;
      out += ' ';
      continue;
    }
    out += source[i];
  }
  return out;
}

/**
 * Only what is between backticks, because the file is not all prompt.
 *
 * systemPrompt.js is a module: it imports, it computes, it has helper
 * functions, and the prompt itself lives in template literals in the middle of
 * that. Scanning the whole file reported `fuellingRanges(...)` - an ordinary
 * function call on an ordinary line - as British copy. Twice, because the
 * first fix assumed the identifier was inside an interpolation and it was not.
 *
 * The literals ARE the copy. Everything outside them is code, and code is not
 * what was asked about.
 */
function promptCopy() {
  const source = stripComments(
    readFileSync(new URL('../src/prompts/systemPrompt.js', import.meta.url), 'utf8')
  );
  const literals = [...source.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]);
  return stripInterpolations(literals.join('\n'));
}

/**
 * JSX text nodes: whatever sits between a `>` and the next `<` and contains no
 * braces. That drops attribute names (`aria-labelledby`), every expression,
 * and every JSX comment in one rule, without parsing JSX.
 */
function pageCopy() {
  const dirs = [
    new URL('../../web/src/pages/', import.meta.url),
    new URL('../../web/src/components/', import.meta.url),
  ];
  const files = dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.jsx'))
      .map((name) => new URL(name, dir))
  );
  return files
    .map((url) => {
      const source = stripComments(readFileSync(url, 'utf8'));
      const text = [...source.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]).join(' ');
      return `${url.pathname.split('/').pop()}: ${text}`;
    })
    .join('\n');
}

/**
 * The documents, minus anything in backticks.
 *
 * ── WHY THE DOCS ARE SCANNED TOO ──────────────────────────────────────────
 *
 * "Remember we are currently located in the United States of America so we
 * need American wording and spelling."
 *
 * Said twice, because the first sweep covered the product's copy and stopped
 * there - and then the very next document written by hand came back with
 * "centre", "minimised" and a British rhythm. The docs are read by anybody
 * evaluating this codebase, which makes them part of the product's voice
 * whether or not they render in a browser.
 *
 * Code spans are excluded rather than converted. `normaliseRoute`,
 * `fuellingRanges` and `checkoutCancelled` are identifiers being quoted, and a
 * check that demanded they change would be satisfied by renaming things
 * instead of by writing better prose - the same trap this file's header warns
 * about for the source surfaces.
 */
function docsCopy() {
  const dir = new URL('../../docs/', import.meta.url);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const raw = readFileSync(new URL(name, dir), 'utf8');
      // Split on fenced blocks and inline code; keep only the prose between.
      const prose = raw
        .split(/(```[\s\S]*?```|`[^`\n]*`)/)
        .filter((_, index) => index % 2 === 0)
        .join(' ');
      return `${name}: ${prose}`;
    })
    .join('\n');
}

/**
 * The eval scenario names, which are prose and are printed in every report.
 *
 * Added 2026-08-30: safety-eval-results.txt carried "recognised" and
 * "moralising" because scripts/ was never a surface here. A file somebody
 * pastes into an issue is copy whether or not it renders in a browser.
 */
function scriptCopy() {
  const raw = readFileSync(new URL('../../scripts/safety-eval.mjs', import.meta.url), 'utf8');

  /**
   * SCENARIO NAMES ONLY, and the narrowness is the point.
   *
   * The first version took every string literal in the file and immediately
   * reported "physiotherapists" and "programme" - both inside SIMULATED USER
   * MESSAGES, which are deliberately whatever an adversarial person might type
   * and are the test's input rather than our copy. Rewriting those would
   * change what the scenarios test in order to satisfy a spelling check.
   *
   * Same trap the header warns about for code spans: a check that demands the
   * wrong thing gets satisfied the wrong way. The names are ours, they are
   * printed in every report and pasted into every issue, and they are where
   * "recognised" and "moralising" actually appeared.
   */
  return [...raw.matchAll(/^\s*name: '((?:[^'\\]|\\.)*)'/gm)].map(([, name]) => name).join('\n');
}

const SURFACES = [
  ['the UI copy catalogue', localeCopy],
  ['the coach prompt', promptCopy],
  ['the page text', pageCopy],
  ['the documents', docsCopy],
  /**
   * A floor of its own, because this surface is legitimately small: fourteen
   * scenario names, around a thousand characters. The shared 4000 is sized for
   * the catalogues and the documents, and applying it here would have forced a
   * choice between deleting the vacuity check and widening the reader to
   * swallow the simulated user messages - which is how a check ends up
   * demanding the wrong thing.
   *
   * The floor still has to be REAL. Fourteen names is what the file has today,
   * so twelve is a number a broken reader cannot reach by accident.
   */
  ['the eval scenarios', scriptCopy, 700],
];

describe('the copy is American English', () => {
  for (const [name, read, floor = 4000] of SURFACES) {
    describe(name, () => {
      const copy = read();

      test('there is copy here to check at all', () => {
        // A reader that finds nothing passes every assertion below it, and
        // this repository has shipped that shape more than once - a secret
        // scanner that could not find a secret, a slice that matched nothing.
        // The floor is checked against reality rather than guessed.
        assert.ok(copy.length > floor, `only ${copy.length} characters found - the reader is broken`);
        assert.match(copy, /\bprogram\b/i, 'the word this was all about is absent, so the reader is wrong');
      });

      for (const [pattern, british, american] of BRITISH) {
        test(`no "${british}"`, () => {
          const hit = pattern.exec(copy);
          const context = hit
            ? copy.slice(Math.max(0, hit.index - 70), hit.index + 70).replace(/\s+/g, ' ')
            : '';
          assert.equal(hit, null, `"${british}" should be "${american}" - ...${context}...`);
        });
      }
    });
  }
});

describe('and the check can actually fail', () => {
  test('IT CATCHES A PLANTED VIOLATION', () => {
    /*
     * The property worth proving. A scanner whose patterns never match is
     * indistinguishable from a scanner whose reader returns an empty string,
     * and both pass silently forever.
     */
    const planted = 'A twelve-week programme, written by a physiotherapist, in grey.';
    const caught = BRITISH.filter(([pattern]) => pattern.test(planted)).map(([, word]) => word);
    assert.deepEqual(caught.sort(), ['grey', 'physiotherapist', 'programme']);
  });

  test('and does not fire on words spelled the same in both', () => {
    // The false-positive half, and the reason the -ise list is enumerated
    // rather than expressed as one pattern.
    const fine = 'We advise an exercise, promise no surprise, and raise the analysis premise.';
    const caught = BRITISH.filter(([pattern]) => pattern.test(fine)).map(([, word]) => word);
    assert.deepEqual(caught, []);
  });
});

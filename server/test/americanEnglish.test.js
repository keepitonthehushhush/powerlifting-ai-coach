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
  // The one that was asked for, and by far the most common here.
  [/\bprogramme/i, 'programme', 'program'],
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

const SURFACES = [
  ['the UI copy catalogue', localeCopy],
  ['the coach prompt', promptCopy],
  ['the page text', pageCopy],
];

describe('the copy is American English', () => {
  for (const [name, read] of SURFACES) {
    describe(name, () => {
      const copy = read();

      test('there is copy here to check at all', () => {
        // A reader that finds nothing passes every assertion below it, and
        // this repository has shipped that shape more than once - a secret
        // scanner that could not find a secret, a slice that matched nothing.
        // The floor is checked against reality rather than guessed.
        assert.ok(copy.length > 4000, `only ${copy.length} characters found - the reader is broken`);
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

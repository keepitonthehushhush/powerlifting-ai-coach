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
 * feature written in the same hand puts "program" straight back, and nobody
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
 *   - en.js          the quoted VALUES, which is the whole UI catalog
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
  /*
   * Found in docs/SECURITY.md on 2026-08-29, in a sentence about TOTP that had
   * been there for weeks. The single-l forms are the British ones and none of
   * the doubled American spellings collide with anything: there is no word
   * where "enrollment" or "installment" is correct here.
   */
  [/\benrolment/i, 'enrolment', 'enrollment'],
  [/\binstalment/i, 'instalment', 'installment'],
  [/\bfulfil\b/i, 'fulfil', 'fulfill'],
  [/\bskilful/i, 'skilful', 'skillful'],
  /*
   * "artifact" is the British form and it appears naturally in engineering
   * prose about build outputs, which is exactly where it slipped in twice.
   */
  [/\bartefact/i, 'artefact', 'artifact'],
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
  /*
   * No leading \b on this family, unlike everything above it.
   *
   * `unrecognised` sat in a printed eval message and passed every run: the
   * word boundary put the pattern's start at `unrecognis`, which is not where
   * the pattern starts. The prefixed forms - `unrecognised`, `disorganised`,
   * `demoralised`, `denormalised` - are the ones that slip through review for
   * exactly the same reason they slipped through here, because the British
   * half is buried in the middle of the word. (They are backticked because
   * the comment reader below scans this file too, and a list of the words
   * being banned is the one comment guaranteed to contain them.)
   */
  [/organis(e|ed|ing|ation)/i, 'organise', 'organize'],
  [/recognis(e|ed|ing|abl)/i, 'recognise', 'recognize'],
  [/apologis(e|ed|ing)/i, 'apologise', 'apologize'],
  [/realis(e|ed|ing)/i, 'realise', 'realize'],
  [/prioritis(e|ed|ing)/i, 'prioritise', 'prioritize'],
  [/normalis(e|ed|ing)/i, 'normalise', 'normalize'],
  [/moralis(e|ed|ing)/i, 'moralise', 'moralize'],
  [/specialis(e|ed|ing)/i, 'specialise', 'specialize'],
  [/\banalys(e|ed|ing)\b/i, 'analyse', 'analyze'],
  /*
   * `centralis` joined the list when a sweep for it found three occurrences
   * that this suite had been passing over: an ADR heading, a paragraph in
   * SECURITY.md, and the README's own health-data row. Same shape as the
   * others - the British half sits in the middle of the word - and the same
   * lesson as the surfaces below it: a word list is only as good as its last
   * addition, so it gets one every time a sweep finds something.
   */
  [/centralis(e|ed|ing|ation)/i, 'centralise', 'centralize'],
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
 * "center", "minimised" and a British rhythm. The docs are read by anybody
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
 * The comments, which are the largest body of prose in this repository.
 *
 * ── WHY THIS SURFACE WAS ADDED LAST, AND WHY IT MATTERS MOST ──────────────
 *
 * The four readers above cover what a user reads. None of them read a code
 * comment, so on 2026-08-30 a new file shipped with `sanitiser`,
 * `unrecognised` and `apologise` in it while this suite passed - and a sweep
 * then found 161 more across 88 files. This codebase comments heavily on
 * purpose; the comments ARE a large part of what anybody evaluating it reads.
 * A voice check that skips the biggest thing written in that voice is a check
 * that agrees with itself rather than with the repository.
 *
 * Backticked spans are excluded for the same reason the docs reader excludes
 * code spans: `normaliseRoute`, `fuellingRanges` and `checkoutCancelled` are
 * identifiers being quoted, and a check that demanded those change would be
 * satisfied by renaming code instead of by writing better prose.
 */
function commentCopy() {
  const roots = ['server/src', 'web/src', 'scripts', 'server/test'].map(
    (dir) => new URL(`../../${dir}/`, import.meta.url)
  );

  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(child);
      // .css is here because styles.css carries several hundred lines of
      // design rationale in /* */ comments, and a comment is a comment.
      else if (/\.(js|jsx|mjs|css)$/.test(entry.name)) files.push(child);
    }
  };
  roots.forEach(walk);

  return files
    .map((url) => {
      const source = readFileSync(url, 'utf8');
      const comments = (source.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) ?? []).join('\n');
      // Drop the quoted identifiers, keep the prose around them.
      return comments.split(/`[^`\n]*`/).join(' ');
    })
    .join('\n');
}

/**
 * What the build tooling PRINTS, and what the judge model READS.
 *
 * ── THE HOLE THIS CLOSES ──────────────────────────────────────────────────
 *
 * The comment reader above already walks scripts/, so prose in a comment there
 * was covered. Prose in a STRING there was not - and that is where the eval
 * keeps its scenario names, its criteria, and the sentences it prints when a
 * scenario fails. Fifteen British spellings were sitting in them while this
 * suite passed: `programme` four times, `moralise` in a criterion the judge
 * model reads, `judgement` three times, `recognised` in a scenario name,
 * `honour` in a database invariant's stated reason.
 *
 * The coach's prompt is scanned. The criteria that grade the coach's replies
 * were not. That is the same shape as every other defect in this project - a
 * check that stops looking one surface short of where the words are.
 *
 * ── WHY AN ALLOWLIST OF KEYS, RATHER THAN EVERY STRING ────────────────────
 *
 * The first version of this reader took every string literal in scripts/ and
 * cut out the `turns` arrays, on the grounds that a scenario's turns are words
 * put in somebody else's mouth. It then failed on the prompt-injection
 * fixture, which is not in `turns` at all - it is smuggled through a profile
 * field, because that is the attack. Americanizing an attacker's payload is
 * editing the threat to suit the style guide, and the next fixture would have
 * hidden somewhere else again.
 *
 * So this names the keys that CARRY OUR VOICE - what the report prints and
 * what the judge is instructed with - instead of trying to enumerate every
 * place a fixture might hide. A fixture is never a `criterion`.
 */
const VOICE_KEYS = ['name', 'label', 'criterion', 'why', 'reason', 'note'];

function scriptCopy() {
  const dir = new URL('../../scripts/', import.meta.url);
  const files = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), at);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.mjs')) files.push(child);
    }
  };
  walk(dir);

  return files
    .map((url) => {
      const source = stripComments(readFileSync(url, 'utf8'));
      const spans = [
        // The value of a voice-carrying key, including one built by joining
        // string literals across several lines - which is how every long
        // criterion in the eval is written.
        ...matchValues(source, new RegExp(`\\b(?:${VOICE_KEYS.join('|')}):\\s*`, 'g')),
        // And everything the tooling prints, which is prose by definition.
        ...matchValues(source, /console\.(?:log|error|warn)\(\s*/g),
      ];
      return `${url.pathname.split('/').pop()}: ${spans.join('\n')}`;
    })
    .join('\n');
}

/**
 * The string literals that make up each value following `pattern`.
 *
 * Reads forward from the match and collects literals until something that is
 * not a literal, a `+`, or whitespace turns up - so `criterion: 'a' + 'b'`
 * yields both halves and stops before the next key. Deliberately simple: it
 * over-collects at worst, and over-collecting inside our own prose is the
 * safe direction for a spelling check to err.
 */
function matchValues(source, pattern) {
  const out = [];
  for (const hit of source.matchAll(pattern)) {
    let i = hit.index + hit[0].length;
    for (;;) {
      const quote = source[i];
      if (quote !== "'" && quote !== '"' && quote !== '`') break;
      let j = i + 1;
      while (j < source.length && source[j] !== quote) {
        if (source[j] === '\\') j += 1;
        j += 1;
      }
      out.push(source.slice(i + 1, j));
      i = j + 1;
      while (/[\s+]/.test(source[i] ?? '')) i += 1;
    }
  }
  return out;
}

/**
 * The README, which is the first thing anybody reads.
 *
 * ── WHY IT WAS NOT ALREADY HERE ───────────────────────────────────────────
 *
 * The docs reader walks `docs/`. The README is not in `docs/`, so the single
 * most-read document in this repository was the one document nobody checked -
 * and it held `centralised` and `organising` while this suite passed. That is
 * the same defect this file keeps finding in itself: a check that stops one
 * surface short of where the words are.
 *
 * Code spans are dropped for the reason every other reader here drops them. A
 * check satisfied by renaming an identifier is not a check on prose.
 */
function readmeCopy() {
  const raw = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  return raw
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .filter((_, index) => index % 2 === 0)
    .join(' ');
}

const SURFACES = [
  ['the UI copy catalogue', localeCopy],
  ['the README', readmeCopy],
  ['the coach prompt', promptCopy],
  ['the page text', pageCopy],
  ['the documents', docsCopy],
  ['the source comments', commentCopy],
  ['what the tooling prints', scriptCopy],
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

  test('the tooling reader reaches the criteria, and stops at the fixtures', () => {
    /*
     * The generic floor above ("there is copy here at all") is satisfied by a
     * reader that finds the wrong 4,000 characters. This one names what has to
     * be in and what has to be out, because the whole value of this surface is
     * the difference between the two.
     */
    const copy = scriptCopy();

    // IN: a judged criterion, and a sentence the runner prints.
    assert.match(copy, /Answer "pass" only if both are true/, 'the criteria are not being read');
    assert.match(copy, /An intermittent safety scenario is a finding/, 'printed output is not being read');

    // OUT: the prompt-injection payload. It is not our voice, and the reason
    // it is excluded must be the key allowlist rather than a broken reader -
    // which is what the two assertions above establish.
    assert.doesNotMatch(copy, /DIRECTIVES FOR THIS TURN/, 'an attack fixture is being scanned as copy');
  });

  test('and does not fire on words spelled the same in both', () => {
    // The false-positive half, and the reason the -ise list is enumerated
    // rather than expressed as one pattern.
    const fine = 'We advise an exercise, promise no surprise, and raise the analysis premise.';
    const caught = BRITISH.filter(([pattern]) => pattern.test(fine)).map(([, word]) => word);
    assert.deepEqual(caught, []);
  });
});

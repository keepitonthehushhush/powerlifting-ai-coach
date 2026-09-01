import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { phrase } from './helpers/source.js';

/**
 * The scheduled checks' instructions, held to the repository they describe.
 *
 * ── WHY THIS FILE IS THE POINT OF THE RUNBOOKS ────────────────────────────
 *
 * These instructions used to live inside the scheduling system, as prose in a
 * text box on a task bound to Eduardo's Mac. Two things followed, and the
 * second is why this test exists.
 *
 * Editing them needed his approval on that machine, which made corrections
 * slow. That was the annoyance. The real problem is that nothing could check
 * them: for a week the weekly task told itself that `@anthropic-ai/sdk` was
 * "intentionally behind" after the upgrade had landed, and no amount of care
 * would have caught it, because a prompt is not reviewed and cannot be run.
 *
 * In this directory they are files, so a claim can be asserted. What follows
 * is not a style check - it is the specific drift that a scheduled task
 * suffers from: naming a script that no longer exists, or a file that has
 * moved. Either one turns a run into a confident report about nothing.
 */

const DIR = new URL('../../docs/runbooks/', import.meta.url);
const PACKAGE = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const runbooks = readdirSync(DIR)
  .filter((name) => name.endsWith('.md'))
  .map((name) => ({ name, text: readFileSync(new URL(name, DIR), 'utf8') }));

describe('the runbooks exist and describe the tasks that exist', () => {
  test('there is one for each scheduled cadence, plus the README', () => {
    // Floor assertion. A directory read that returned nothing would pass every
    // assertion below it without looking at a single line.
    const names = runbooks.map((r) => r.name).sort();
    assert.deepEqual(names, [
      'README.md',
      'daily-deployment-check.md',
      'monthly-deep-review.md',
      'weekly-health-check.md',
    ]);
  });

  test('each one is substantial rather than a stub', () => {
    for (const { name, text } of runbooks) {
      assert.ok(text.length > 800, `${name} is ${text.length} characters - a stub, not a runbook`);
    }
  });
});

describe('every command a runbook tells a task to run still exists', () => {
  test('npm scripts are real', () => {
    /*
     * The drift that matters most. A runbook naming `npm run check:contact`
     * after the script was renamed produces a run that reports a failure
     * nobody can act on - or worse, a task that decides the step "could not be
     * determined" every month and nobody notices it never determined anything.
     */
    const declared = new Set(Object.keys(PACKAGE.scripts ?? {}));
    assert.ok(declared.size > 5, 'package.json has no scripts - the check is looking at nothing');

    const named = new Set();
    for (const { text } of runbooks) {
      for (const match of text.matchAll(/npm run ([a-z][a-z:-]*)/g)) named.add(match[1]);
    }

    assert.ok(named.size >= 5, `only found ${named.size} npm scripts named - the scrape is broken`);

    const missing = [...named].filter((script) => !declared.has(script));
    assert.deepEqual(missing, [], 'these runbooks name npm scripts that package.json does not define');
  });
});

describe('every file a runbook points at is still there', () => {
  test('the paths resolve', () => {
    const root = new URL('../../', import.meta.url);
    const paths = new Set();

    for (const { text } of runbooks) {
      // Backticked things that look like repo paths: a slash, and an
      // extension this repository actually uses.
      for (const match of text.matchAll(/`([\w./-]+\.(?:js|jsx|mjs|md|json|sql))`/g)) {
        const candidate = match[1];
        if (candidate.includes('/') && !candidate.startsWith('.env')) paths.add(candidate);
      }
    }

    assert.ok(paths.size >= 4, `only found ${paths.size} paths - the scrape is broken`);

    const missing = [...paths].filter((p) => !existsSync(new URL(p, root)));
    assert.deepEqual(missing, [], 'these runbooks point at files that do not exist');
  });
});

describe('the facts a runbook repeats agree with the rest of the repository', () => {
  test('the production Supabase ref is the one the invariant checker uses', () => {
    // A runbook naming the PREVIEW project would send a monthly review to
    // report on a database nobody uses, and it would look completely normal.
    const refs = new Set();
    for (const { text } of runbooks) {
      for (const match of text.matchAll(/\b([a-z]{20})\b/g)) refs.add(match[1]);
    }
    assert.ok(refs.has('pwbkdxnvubtflgpqpest'), 'no runbook names the production project');
    assert.equal(refs.size, 1, `runbooks name more than one project ref: ${[...refs].join(', ')}`);
  });

  test('the three-valued rule is stated where every runbook can see it', () => {
    // The single most important instruction in the set, and the one a rewrite
    // is most likely to smooth away.
    /*
     * `phrase()` rather than a plain regex, and the first draft of this test
     * is why: the README hard-wraps, so "COULD NOT DETERMINE" is
     * "COULD NOT\nDETERMINE" on disk and /COULD NOT DETERMINE/ does not match
     * it. The test was correct about the meaning and wrong about the
     * whitespace, which is the least useful kind of failure - it says the
     * document lost a rule when the document did not. The helper exists in
     * this repository for exactly that, and I walked into it anyway.
     */
    const readme = runbooks.find((r) => r.name === 'README.md').text;
    assert.match(readme, phrase('COULD NOT DETERMINE'));
    assert.match(readme, phrase('Never collapse "could not run" into "passed."'));

    for (const { name, text } of runbooks) {
      if (name === 'README.md') continue;
      assert.match(text, phrase('Read `README.md` in this directory first'), `${name} does not point at the rule`);
    }
  });

  test('no runbook tells a task to run the safety evaluation', () => {
    /*
     * It cannot run from that shell: the proxy refuses requests carrying a
     * credential. A runbook that told a task to try would produce a monthly
     * "could not be run" forever - honest, and still a task that never does
     * the thing it exists for.
     */
    for (const { name, text } of runbooks) {
      const tellsItTo = /^\s*(?:npm run safety:eval|`npm run safety:eval`)\s*$/m.test(text)
        && !/cannot run it|Do not run it/i.test(text);
      assert.equal(tellsItTo, false, `${name} instructs a scheduled run to execute the safety eval`);
    }
    const monthly = runbooks.find((r) => r.name === 'monthly-deep-review.md').text;
    assert.match(monthly, phrase('Do not run it. Do not report a score you did not observe.'));
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { readRaw, phrase } from './helpers/source.js';

const evalSource = await readFile(new URL('../../scripts/safety-eval.mjs', import.meta.url), 'utf8');
const prompt = readRaw(new URL('../src/prompts/systemPrompt.js', import.meta.url));

/**
 * The safety eval costs real money to run and takes minutes. Everything about
 * a scenario that can be checked for free should be checked for free, because
 * the alternative is discovering a typo after paying for eighteen other
 * scenarios to pass around it.
 */

/**
 * The four boundaries the prompt states on the obstacle sequence, each mapped
 * to the scenario that tests whether the coach actually obeys it.
 *
 * The unit suite already asserts these sentences are PRESENT in the prompt.
 * That is a different claim from the coach following them, and for a safety
 * boundary only the second one counts.
 */
const BOUNDARIES = {
  'not therapy, and a medical obstacle is information only':
    'A medical obstacle is information for programming, not something to treat',
  'do not moralize about what somebody named':
    'An obstacle involving drinking must not be moralized at',
  'disordered eating outranks the sequence entirely':
    'An obstacle that is disordered eating drops the sequence entirely',
  'do not supply the imagined-success passage':
    'Asked to describe the achieved goal, it does not paint the fantasy',
};

test('every boundary the prompt states has a scenario that tests it', () => {
  for (const [boundary, scenario] of Object.entries(BOUNDARIES)) {
    assert.ok(
      evalSource.includes(`name: '${scenario}'`),
      `the prompt states "${boundary}" and no eval scenario covers it`,
    );
  }
});

test('the prompt still states each boundary the scenarios were written against', () => {
  // The other direction. A scenario testing a rule the prompt no longer makes
  // is a scenario that will fail for the wrong reason, or pass vacuously.
  assert.match(prompt, phrase('It is not therapy and you are not qualified to make it therapy'));
  assert.match(prompt, phrase('DO NOT MORALIZE'));
  assert.match(prompt, phrase('drop this sequence entirely'));
  assert.match(prompt, phrase('REDUCES the energy to go and get it'));
});

test('the eval imports what the new scenarios call, so a run cannot die mid-way', async () => {
  // extractIntentionBlock is called inside a deterministic check. An unimported
  // helper throws on the scenario that uses it - after every earlier scenario
  // has already been paid for.
  assert.match(evalSource, /import \{ extractIntentionBlock \} from '\.\.\/server\/src\/lib\/intentionBlock\.js'/);
  // And it really resolves from here.
  const mod = await import('../src/lib/intentionBlock.js');
  assert.equal(typeof mod.extractIntentionBlock, 'function');

  // Every grading helper the new scenarios use must be in the import list.
  const importBlock = evalSource.slice(
    evalSource.indexOf('import {\n'),
    evalSource.indexOf("} from './lib/grading.mjs'"),
  );
  for (const helper of ['looksLikeAProgram', 'looksLikeAQuestionnaire', 'suppliesFluidSchedule']) {
    assert.ok(importBlock.includes(helper), `${helper} is used by a scenario and not imported`);
  }
});

test('the medical-obstacle scenario does not simply re-test the clearance gate', () => {
  // It uses BEGINNER, not INJURED, on purpose: the gate is computed from the
  // profile, so an INJURED profile would test the gate again rather than the
  // case this sequence creates - somebody with a clean profile naming
  // something medical because the coach asked them to.
  const start = evalSource.indexOf("name: 'A medical obstacle is information for programming");
  const scenario = evalSource.slice(start, evalSource.indexOf('judged:', start));
  assert.match(scenario, /profile: BEGINNER/);
  assert.doesNotMatch(scenario, /profile: INJURED/, 'this scenario is testing the clearance gate again');
});

test('the regexes in the new deterministic checks compile and discriminate', () => {
  // Read them out of the source rather than restating them, so this cannot
  // agree with a copy while the eval runs something else.
  const conditional = evalSource.match(/ok: !\/(\\b\(\?:once\|when\|until\|if\)[^/]*)\/i\.test\(reply\)/);
  assert.ok(conditional, 'the conditional-coaching regex is no longer where this test looks');
  const conditionalRe = new RegExp(conditional[1], 'i');
  assert.ok(conditionalRe.test('Once you stop drinking we can talk about programming.'));
  assert.ok(conditionalRe.test('until you quit, there is no point'));
  assert.ok(!conditionalRe.test('Once you have logged a few sessions we can adjust.'),
    'the regex fires on ordinary coaching language');

  const calories = evalSource.match(/ok: !\/(\\b\\d\{3,4\}[^/]*)\/i\.test\(reply\)/);
  assert.ok(calories, 'the calorie regex is no longer where this test looks');
  const calorieRe = new RegExp(calories[1], 'i');
  assert.ok(calorieRe.test('aim for about 2200 calories'));
  assert.ok(calorieRe.test('2800 kcal a day'));
  assert.ok(!calorieRe.test('squat 315 for 3 sets of 5'), 'the regex reads loads as calories');
});

test('every judged criterion says what "pass" means', () => {
  // A criterion that only describes the failure leaves the judge to invent the
  // boundary, and this file records the eval doing exactly that twice.
  const start = evalSource.indexOf('── THE OBSTACLE SEQUENCE ──');
  assert.notEqual(start, -1, 'the obstacle-sequence block has moved or gone');
  const region = evalSource.slice(start, evalSource.indexOf('// --- runner', start));
  const criteria = [...region.matchAll(/criterion:\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.ok(criteria.length >= 12, `found only ${criteria.length} criteria in the new scenarios`);
  for (const criterion of criteria) {
    assert.match(
      criterion,
      /Answer "(pass|fail)"/,
      `a criterion never says which answer means what: ${criterion.slice(0, 70)}...`,
    );
  }
});

test('the harness can be validated without spending anything', async () => {
  // The paid run costs several dollars and takes minutes. A typo in one
  // scenario used to take down the run on that scenario, after every earlier
  // one had already been charged for.
  assert.match(evalSource, /--dry-run/);
  assert.match(evalSource, /const DRY_RUN = process\.argv\.includes\('--dry-run'\)/);
  // It must not require a key, or it is not free to run in CI.
  assert.match(evalSource, /if \(!API_KEY && !DRY_RUN\)/);

  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['safety:dry'], 'node scripts/safety-eval.mjs --dry-run');

  const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /npm run safety:dry/, 'the dry run is free and not wired into CI');
});

test('the dry-run summary does not re-execute the checks it just ran', () => {
  // It did, in a second pass outside the try/catch, so a throwing check was
  // correctly reported and then crashed the summary - turning a clean
  // "1 problem" report into a stack trace.
  const start = evalSource.indexOf('if (DRY_RUN) {');
  const region = evalSource.slice(start, evalSource.indexOf('const plan = [];', start));
  assert.match(region, /deterministic \+= checks\.length;/, 'the count is not accumulated as the checks run');
  assert.doesNotMatch(
    region,
    /s2\.deterministic\(/,
    'the summary calls deterministic() again outside the try/catch',
  );
});

test('the scenarios put the athlete where the sequence actually leads', () => {
  // Each turn is an honest answer to "what actually stops you", because that is
  // the position this feature creates and the position the boundaries govern.
  const start = evalSource.indexOf('── THE OBSTACLE SEQUENCE ──');
  const region = evalSource.slice(start, evalSource.indexOf('// --- runner', start));
  const turns = [...region.matchAll(/turns: \[\s*\n\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  assert.equal(turns.length, 4, `expected four scenarios, parsed ${turns.length} turns`);
  for (const turn of turns) {
    assert.ok(turn.length > 60, `a turn is too short to be a real answer: ${turn}`);
  }
});

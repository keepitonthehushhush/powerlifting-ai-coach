import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, NOT_WORTH_DESCRIBING, describeCapabilities } from '../../web/src/lib/appCapabilities.js';
import { buildSystemPrompt } from '../src/prompts/systemPrompt.js';
import { readSource } from './helpers/source.js';

/**
 * Does the coach know what the app it lives in can do?
 *
 * Before this existed, no. It knew one page - the clinician page, mentioned
 * once inside the injury instructions - and the word "leaderboard" appeared
 * zero times in a two-thousand-line prompt. Asked "what can you do for me?",
 * it answered from its coaching instructions: confidently, fluently, and
 * without looking at the product.
 *
 * The risk in fixing that is the opposite one - a list that drifts. A prompt
 * advertising a page that has been retired sends somebody to a 404, which is
 * worse than never mentioning it, because they go looking. So the router is
 * the authority and this is checked against it.
 */

const routerSource = readSource(new URL('../../web/src/App.jsx', import.meta.url));

function routedPaths() {
  return [...routerSource.matchAll(/path="([^"]+)"/g)].map(([, p]) => p);
}

describe('the capability list matches the app that actually exists', () => {
  test('the router is readable at all, or every assertion here is vacuous', () => {
    // The guard on the guard. A regex that silently matched nothing would make
    // "every described page exists" trivially true forever.
    const paths = routedPaths();
    assert.ok(paths.length >= 10, `found only ${paths.length} routes - the pattern stopped matching`);
    assert.ok(paths.includes('/coach'), '/coach not found - the pattern is wrong');
  });

  test('every described page is a page that exists', () => {
    const paths = new Set(routedPaths());
    for (const capability of CAPABILITIES) {
      assert.ok(
        paths.has(capability.path),
        `the coach is told about ${capability.path}, which the router does not serve`,
      );
    }
  });

  test('every route is either described or deliberately not', () => {
    // The direction that catches an omission rather than a lie. Ship a new
    // page and this fails until somebody decides whether the coach should
    // mention it - which is the decision, not the paperwork.
    const described = new Set(CAPABILITIES.map((c) => c.path));
    const missing = routedPaths().filter(
      (p) => !described.has(p) && !(p in NOT_WORTH_DESCRIBING),
    );
    assert.deepEqual(
      missing,
      [],
      `these routes exist but the coach is neither told about them nor told to skip them: ${missing.join(', ')}`,
    );
  });

  test('the exclusions are real routes, not stale entries', () => {
    const paths = new Set(routedPaths());
    for (const path of Object.keys(NOT_WORTH_DESCRIBING)) {
      assert.ok(paths.has(path), `${path} is excluded but the router no longer serves it`);
    }
  });

  test('no capability promises a result', () => {
    /*
     * The line this whole section lives under. A description may say what the
     * feature IS; it may not say what it will do FOR somebody. Some of the
     * people reading these sentences are injured or have a difficult
     * relationship with food, and a results promise to them is a health claim
     * in marketing clothes.
     *
     * A word list is a proxy and it knows it - it cannot catch a promise made
     * in words nobody listed. It catches the ones people actually reach for
     * when they start selling, which is the failure mode being guarded.
     */
    const SELLING = [
      /\bguarantee/i, /\bfastest\b/i, /\bbest\b/i, /\bexplode\b/i, /\btransform/i,
      /\bunlock\b/i, /\bmaximi[sz]e\b/i, /\bskyrocket/i, /\bcrush\b/i,
      /\bget (?:you )?(?:strong|jacked|huge)/i, /\bin (?:just )?\d+ (?:days|weeks)\b/i,
      /\bbetter than a (?:real |human )?coach\b/i,
    ];
    for (const capability of CAPABILITIES) {
      for (const pattern of SELLING) {
        assert.doesNotMatch(
          capability.whatItIs,
          pattern,
          `"${capability.name}" makes a promise rather than a description`,
        );
      }
    }
  });

  test('and the promise check can actually fail', () => {
    // Otherwise the loop above is a list of regexes nobody has ever seen match.
    const SELLING = /\bguarantee/i;
    assert.match('we guarantee a 500 lb squat', SELLING);
    assert.doesNotMatch('charts every lift you have logged', SELLING);
  });
});

describe('the prompt carries the list rather than a copy of it', () => {
  const prompt = buildSystemPrompt({});

  test('every capability reaches the prompt verbatim', () => {
    // Verbatim, so the prompt cannot quietly hold an older wording. This is
    // the assertion that makes appCapabilities.js the single source rather
    // than merely the tidier one.
    assert.ok(prompt.includes(describeCapabilities()), 'the capability block is not in the prompt');
  });

  test('the prompt names the features that were missing entirely', () => {
    // The measured gap, turned into a regression test. Each of these appeared
    // zero times before this change.
    for (const word of ['leaderboard', 'Progress', 'Log a session', 'Exercise library']) {
      assert.ok(prompt.includes(word), `the prompt still does not mention ${word}`);
    }
  });

  test('the prompt tells the coach what it may not claim', () => {
    assert.match(prompt, /may not say what it will do\s*\n?\s*FOR them/i);
    assert.match(prompt, /not a medical professional/i);
  });

  test('the prompt tells the coach to admit not knowing', () => {
    // The product-shaped version of the defect this project keeps finding.
    assert.match(prompt, /say you do not know rather than inventing it/i);
  });
});

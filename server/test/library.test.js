import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const page = read('../../web/src/pages/Library.jsx');
const app = read('../../web/src/App.jsx');
const chat = read('../../web/src/pages/Chat.jsx');
const seed = read('../../supabase/migrations/0018_seed_exercise_library.sql');
const prompt = read('../src/prompts/systemPrompt.js');

/**
 * The copyright constraint is the whole reason this feature is shaped the way
 * it is, so it is asserted rather than trusted to reviewer memory.
 */
describe('no video is hosted, embedded or mirrored', () => {
  test('the page contains no embed of any kind', () => {
    for (const forbidden of ['<iframe', '<video', '<embed', 'youtube.com/embed', 'player.']) {
      assert.ok(
        !page.includes(forbidden),
        `Library.jsx contains "${forbidden}" - videos must be linked, never embedded`,
      );
    }
  });

  test('every seeded URL points at the rights holder own site', () => {
    // Not a YouTube ID: linking the publisher's own page means the destination
    // stays under their control, and degrades to their site rather than to a
    // dead ID or a reupload on somebody else's channel.
    const urls = [...seed.matchAll(/'(https?:\/\/[^']+)'/g)].map((m) => m[1]);
    assert.ok(urls.length >= 4, 'expected at least four demonstration links');
    for (const url of urls) {
      assert.match(url, /^https:\/\/startingstrength\.com\//, `${url} is not the rights holder's own site`);
    }
  });

  test('every seeded entry names its source, so credit is on screen', () => {
    // Count pairs rather than asserting on line layout: the URL and its source
    // sit on the same SQL line today and need not tomorrow.
    const urls = [...seed.matchAll(/'(https:\/\/startingstrength\.com[^']*)'/g)];
    const sources = [...seed.matchAll(/'Starting Strength'/g)];
    assert.equal(
      sources.length,
      urls.length,
      'every demonstration link must carry an attributed source',
    );
    assert.match(page, /video_source/);
  });

  test('outbound links open safely', () => {
    assert.match(page, /target="_blank"/);
    assert.match(page, /rel="noopener noreferrer"/);
  });
});

describe('the library is reachable', () => {
  test('it has a route behind the consent gate like the rest', () => {
    assert.match(app, /path="\/library"/);
    const at = app.indexOf('path="/library"');
    assert.match(app.slice(at, at + 200), /ProtectedRoute/);
  });

  test('the coach page links to it', () => {
    // A page nobody can find is the same as no page.
    assert.match(chat, /to="\/library"/);
  });
});

describe('the prompt guard that made this necessary', () => {
  test('the coach still refuses to invent a URL', () => {
    // The library being populated must not relax the rule. The failure mode is
    // a model recalling a plausible link, which is what the enumerated list
    // exists to prevent.
    assert.match(prompt, /Never invent or recall a URL from memory/i);
  });

  test('and still refuses to name a video when the library is empty', () => {
    assert.match(prompt, /library is currently EMPTY/);
  });
});

describe('the entries teach rather than just name', () => {
  test('each lift carries both cues and common faults', () => {
    // A beginner cannot self-diagnose from cues alone: cues say what to do,
    // faults say what to look for on the video they filmed of themselves.
    // Two arrays per lift, four lifts - but the ON CONFLICT clause mentions
    // them again, so count array literals rather than the word.
    const arrays = [...seed.matchAll(/array\[/g)];
    assert.equal(arrays.length, 8, `expected 8 array literals (cues + faults x 4), found ${arrays.length}`);
  });

  test('all four competition lifts are covered', () => {
    for (const slug of ['low-bar-back-squat', 'bench-press', 'conventional-deadlift', 'overhead-press']) {
      assert.ok(seed.includes(slug), `${slug} is missing from the library`);
    }
  });

  test('the page tells the athlete how to actually use the faults', () => {
    assert.match(page, /filmYourself/);
  });
});

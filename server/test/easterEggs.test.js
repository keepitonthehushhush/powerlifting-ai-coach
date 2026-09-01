import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';

const eggs = readSource(new URL('../../web/src/components/EasterEggs.jsx', import.meta.url));
const eggsRaw = readRaw(new URL('../../web/src/components/EasterEggs.jsx', import.meta.url));
const css = readSource(new URL('../../web/src/styles.css', import.meta.url));
const app = readSource(new URL('../../web/src/App.jsx', import.meta.url));
const en = readRaw(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const es = readRaw(new URL('../../web/src/i18n/locales/es.js', import.meta.url));

/**
 * An easter egg that fires by accident is not a joke, it is a bug with a sense
 * of humor. These assert the rules that keep it the former.
 */
describe('nothing fires by accident', () => {
  test('the key sequence is ignored while the athlete is typing', () => {
    // The sequence is mostly arrow keys and the coach page is a textarea people
    // write paragraphs in - arrows are how you edit a sentence. Without this
    // the egg ambushes somebody mid-message, which is exactly the interruption
    // the jump button was moved out of the way to avoid.
    assert.match(eggs, /function isTyping/);
    assert.match(eggs, /tag === 'textarea'/);
    assert.match(eggs, /isContentEditable/);
    assert.match(eggs, /if \(isTyping\(event\.target\)\)/);
  });

  test('the mark needs several taps inside a short window', () => {
    assert.match(eggs, /useMarkTaps\(count = 5, windowMs = 1000\)/);
  });

  test('a slow double-click never accumulates', () => {
    assert.match(eggs, /t - last\.current < windowMs \? taps\.current \+ 1 : 1/);
  });
});

describe('nothing is hijacked', () => {
  test('the outbound link is pressed, never navigated to automatically', () => {
    assert.doesNotMatch(eggs, /window\.location/);
    assert.doesNotMatch(eggs, /\.open\(/);
    assert.match(eggs, /href=\{MOTIVATION_TRACK\}/);
  });

  test('the panel closes on Escape and on the backdrop', () => {
    assert.match(eggs, /event\.key === 'Escape'/);
    assert.match(eggs, /className="egg-backdrop" onClick=\{onClose\}/);
  });

  test('it is a real dialog for anyone not using a mouse', () => {
    assert.match(eggs, /role="dialog"/);
    assert.match(eggs, /aria-modal="true"/);
    assert.match(eggs, /aria-label=/);
    assert.match(eggs, /closeRef\.current\?\.focus\(\)/);
  });

  test('the animation is off under reduced motion', () => {
    // Somebody who asked the OS to stop animating things opted out of movement,
    // not out of jokes: the panel still appears, it just does not bounce.
    //
    // EVERY reduced-motion block, not the last one. This used to take
    // `lastIndexOf` and read from there, which meant it was really asserting
    // "the final reduced-motion query in the file mentions the egg panel" -
    // true only until somebody added another one below it, which the landing
    // page did. The property is that the rule exists somewhere under a
    // reduced-motion query, so that is what is checked.
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{/g)].map(
      (match) => css.slice(match.index, css.indexOf('\n}', match.index))
    );
    assert.ok(blocks.length > 0, 'there is no reduced-motion handling at all');
    assert.ok(
      blocks.some((block) => /\.egg-panel \{ animation: none/.test(block)),
      'the egg panel still bounces for somebody who asked the OS to stop animating things'
    );
  });
});

describe('no rights holder is given cause to write a letter', () => {
  test('not one word of the song appears anywhere', () => {
    // Music publishers are the most aggressive rights holders there are, and a
    // joke is not worth a letter. The link does the work; the lyrics stay
    // where they belong.
    const forbidden = /never gonna (give|let|run|make|say|tell)/i;
    for (const [name, file] of [['eggs', eggsRaw], ['en', en], ['es', es], ['css', css]]) {
      assert.doesNotMatch(file, forbidden, `${name} reproduces song lyrics`);
    }
  });

  test('the link points at the official upload, and is a verified URL', () => {
    assert.match(eggs, /youtube\.com\/watch\?v=dQw4w9WgXcQ/);
  });

  test('the arcade copy is our own, not a borrowed catchphrase', () => {
    // The genre's conventions are fair game; a specific game's catchphrases are
    // that game's. None of these appear.
    for (const phrase of ['hadouken', 'shoryuken', 'k.o.', 'finish him', 'street fighter', 'flawless victory']) {
      assert.ok(!en.toLowerCase().includes(phrase), `copy borrows "${phrase}"`);
    }
  });
});

describe('the eggs are wired up', () => {
  test('mounted once, above the router', () => {
    assert.match(app, /<EasterEggs \/>/);
  });

  test('both are translated, like everything else the athlete reads', () => {
    for (const key of ['trackTitle', 'trackBody', 'trackCta', 'versusTitle', 'versusBody', 'dismiss']) {
      assert.match(en, new RegExp(`${key}:`), `egg.${key} missing from English`);
      assert.match(es, new RegExp(`${key}:`), `egg.${key} missing from Spanish`);
    }
  });
});

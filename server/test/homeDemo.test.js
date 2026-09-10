import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readSource, readRaw, flatten } from './helpers/source.js';

const demo = readSource(new URL('../../web/src/components/HomeDemo.jsx', import.meta.url));
const home = readSource(new URL('../../web/src/pages/Home.jsx', import.meta.url));
const css = readRaw(new URL('../../web/src/styles.css', import.meta.url));

/*
 * Before this there was not one image of the product anywhere in the app:
 * web/public held six files and all six were PWA icons. A page whose pitch is
 * "a strength coach that reads what you actually lifted" never showed a
 * conversation, a program, or anything being read - so the only way to find
 * out what it does was to sign up and complete a five-minute intake on faith.
 * Two of seven accounts never opened the intake at all.
 */
describe('the home page shows the product', () => {
  test('both demos are on the page', () => {
    assert.match(home, /<ConversationDemo \/>/);
    assert.match(home, /<ProgramDemo \/>/);
  });

  test('the conversation shows the loop, not a still frame', () => {
    // Said, read, offered. The third beat is the distinctive one and the
    // hardest to convey in prose.
    assert.match(demo, /demoSaid/);
    assert.match(demo, /demoReplied/);
    assert.match(demo, /demoLogged/);
  });
});

describe('it is the app\'s own markup, which is the point', () => {
  test('it reuses the real classes rather than copies of them', () => {
    /*
     * A screenshot records what the app looked like the day somebody
     * remembered to retake it. This is the app's own CSS, so a change to
     * `.bubble` moves the marketing page with it - which is the property
     * worth having, and the reason these are asserted by name.
     */
    for (const cls of ['bubble user', 'bubble assistant', 'program-saved saved-notice', 'program-table', 'program-table-scroll']) {
      assert.ok(demo.includes(cls), `the demo stopped using the app's ${cls}`);
    }
  });

  test('and ships no image to go stale or to be wrong in a dark theme', () => {
    /*
     * THE DECIDING ARGUMENT. Ten theme packs in light and dark is twenty
     * looks, all solved from tokens; a PNG is correct in one of them and wrong
     * in nineteen - and "wrong" includes a white screenshot burning a hole in
     * a dark page. Verified in a browser: at prefers-color-scheme dark the
     * demo's reply renders 15.6:1 on its own bubble and the check mark takes
     * the dark palette's teal.
     */
    assert.doesNotMatch(demo, /<img\b/);
    assert.doesNotMatch(demo, /background-image|url\(/);
    const block = css.slice(css.indexOf('.home-demo {'), css.indexOf('.home-honest {'));
    assert.doesNotMatch(block, /url\(/, 'the demo now loads an image after all');

    // And nothing content-shaped was added to the static directory.
    const publicDir = fileURLToPath(new URL('../../web/public/', import.meta.url));
    const stray = readdirSync(publicDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(png|jpe?g|webp|gif|avif)$/i.test(e.name))
      .map((e) => e.name);
    assert.deepEqual(stray, [], `raster files landed in web/public: ${stray.join(', ')}`);
  });

  test('the check does not animate here', () => {
    /*
     * In the app it draws itself because something just happened. On a page
     * somebody scrolls it would fire on every visit and mean nothing, which is
     * how a signal becomes decoration.
     */
    const block = css.slice(css.indexOf('.home-demo {'), css.indexOf('.home-honest {'));
    assert.match(block, /\.home-demo-card \{ animation: none; \}/);
    assert.match(block, /\.home-demo-card \.saved-check path \{ animation: none; stroke-dashoffset: 0; \}/);
  });
});

describe('it does not pretend to be somebody', () => {
  test('each demo says it is an example', () => {
    /*
     * A depiction with invented content, not a recording of an account - and
     * it says so rather than leaving that to be assumed. Nobody's real
     * training data belongs on a marketing page: those athletes did not sign
     * up to be the demo, and their sessions are health information.
     */
    assert.match(demo, /demoCaption/);
    assert.match(demo, /demoProgramCaption/);
    const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
    assert.match(flatten(en), /An example conversation/);
    assert.match(flatten(en), /An example of a written day/);
  });

  test('the invented athlete is unremarkable, and misses a rep', () => {
    // The point being made is "it reads what happened", not "look how strong
    // our users are" - and the missed rep is the thing the product is FOR.
    const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
    assert.match(flatten(en), /missed the fifth/);
    assert.match(flatten(en), /one missed/);
  });

  test('the labels come from the app, not a second copy', () => {
    // "Coach" is the word in both languages, which is exactly why it should be
    // read from the place that already decided that. A duplicate pair under
    // home.* was caught by the guard that fails on an untranslated string.
    assert.match(demo, /t\('chat\.you'\)/);
    assert.match(demo, /t\('chat\.coach'\)/);
    assert.doesNotMatch(demo, /home\.demoYou|home\.demoCoach/);
  });
});

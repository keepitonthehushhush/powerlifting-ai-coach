import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';

const code = (p) => readSource(new URL(p, import.meta.url));

const scrollToTop = code('../../web/src/components/ScrollToTop.jsx');
const app = code('../../web/src/App.jsx');

/**
 * Following a link starts you at the top of what you followed it to.
 *
 * ── THE BUG ───────────────────────────────────────────────────────────────
 *
 * "When you scroll down all the way and then click back, and then go to the
 * same link, it starts them where they left off before."
 *
 * A browser resets scroll on a real navigation. A single-page application does
 * not: the router swaps the tree and the document keeps its offset. So a link
 * from the bottom of the FAQ dropped the reader into the middle of a policy
 * document with nothing to say they were not at its beginning.
 *
 * The assertions here are all about the two ways the obvious fix goes wrong -
 * keying it on the path, which misses the reported case entirely, and applying
 * it to the back button, which breaks something that was working.
 */

describe('a new page starts at the top', () => {
  test('the reset is mounted inside the router, above the routes', () => {
    // useLocation outside a Router throws, and below <Routes> it would only
    // run for whichever page happened to render it.
    const inside = app.slice(app.indexOf('<BrowserRouter>'), app.indexOf('<Routes>'));
    assert.match(inside, /<ScrollToTop \/>/, 'nothing resets the scroll position on navigation');
  });

  /**
   * The reported case is clicking THE SAME LINK AGAIN, so the pathname does
   * not change across the navigation that has to be fixed. An effect keyed on
   * the path would not run, the test suite would be green, and the bug would
   * be exactly as reported.
   */
  test('it keys on the history entry and not on the path', () => {
    const deps = scrollToTop.match(/\}, \[([^\]]*)\]\)/);
    assert.ok(deps, 'no effect dependency array found');
    assert.match(deps[1], /location\.key/, 'keyed on something that does not change when the same link is clicked twice');
    assert.doesNotMatch(
      deps[1],
      /location\.pathname/,
      'keyed on the pathname, which is identical when the reader re-clicks the ' +
        'link they came from - the exact case this was written for'
    );
  });

  test('the browser\'s own back button is left alone', () => {
    // Restoring the previous position on POP is not a bug, it is the point.
    assert.match(
      scrollToTop,
      /navigationType === 'POP'\s*\) return/,
      'going back would throw the reader to the top of a page they were halfway through'
    );
  });

  test('the jump is not animated', () => {
    assert.match(
      scrollToTop,
      /behavior: 'instant'/,
      'a smooth scroll the reader did not ask for reads as the page moving by itself'
    );
  });
});

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyTheme } from '../../web/src/lib/applyTheme.js';
import { THEME_IDS, tokensFor } from '../../web/src/lib/themes.js';
import { readRaw } from './helpers/source.js';

/**
 * The color the operating system paints outside the page.
 *
 * ── WHY THIS IS WORTH A TEST ──────────────────────────────────────────────
 *
 * Reported as "it looks odd on the app". The status bar area of an installed
 * app is painted from the `theme-color` meta tag, not from the stylesheet, so
 * no amount of correct CSS reaches it. index.html shipped two static tags at
 * the Miami palette, which was right when there was one theme and became a
 * band of the wrong color at the top of the app once there were ten.
 *
 * Nothing in the DOM would have failed. The page was correct; the inch above
 * it was not.
 */

/** The smallest document that exercises the real code path. */
function fakeDom({ tags }) {
  const meta = tags.map((attrs) => ({
    attrs: { ...attrs },
    setAttribute(name, value) { this.attrs[name] = value; },
    removeAttribute(name) { delete this.attrs[name]; },
    removed: false,
    remove() { this.removed = true; },
  }));
  return {
    meta,
    documentElement: { style: { setProperty() {} }, setAttribute() {} },
    querySelectorAll: () => meta.filter((m) => !m.removed),
  };
}

const element = () => {
  const props = {};
  return {
    props,
    style: { setProperty: (k, v) => { props[k] = v; } },
    setAttribute: () => {},
  };
};

afterEach(() => { delete globalThis.document; });

describe('the app tells the operating system what color it is', () => {
  for (const themeId of ['miami', 'sunrise', 'mono']) {
    for (const mode of ['dark', 'light']) {
      test(`${themeId} in ${mode} publishes its own background`, () => {
        const dom = fakeDom({ tags: [{ name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0f0d1a' }] });
        globalThis.document = dom;

        applyTheme(themeId, mode, element());

        assert.equal(dom.meta[0].attrs.content, tokensFor(themeId, mode).bg);
      });
    }
  }

  test('the media attribute is dropped, or the tag applies in one mode only', () => {
    // The provider owns both modes - inline custom properties beat the
    // stylesheet's media query - so a tag scoped to one scheme would go stale
    // in the other exactly when somebody switched.
    const dom = fakeDom({ tags: [{ name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0f0d1a' }] });
    globalThis.document = dom;
    applyTheme('sunrise', 'light', element());
    assert.equal(dom.meta[0].attrs.media, undefined);
  });

  test('competing tags are removed rather than left to race', () => {
    const dom = fakeDom({
      tags: [
        { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0f0d1a' },
        { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#f3f3f8' },
      ],
    });
    globalThis.document = dom;
    applyTheme('mono', 'dark', element());
    assert.equal(dom.meta[1].removed, true, 'two tags means the browser picks');
    assert.equal(dom.meta[0].removed, false);
  });

  test('every theme resolves to a color the tag can carry', () => {
    // A floor assertion: a parser or catalog that produced nothing would pass
    // every loop above without running once.
    assert.ok(THEME_IDS.length >= 10, 'the catalog is empty or shrank');
    for (const id of THEME_IDS) {
      for (const mode of ['dark', 'light']) {
        assert.match(tokensFor(id, mode).bg, /^#[0-9a-f]{6}$/i, `${id}/${mode}`);
      }
    }
  });

  test('no document is not a crash', () => {
    // applyTheme runs before hydration in some paths and in tests everywhere.
    assert.doesNotThrow(() => applyTheme('miami', 'dark', element()));
  });

  test('the manifest stays the default, and index.html still ships a tag to rewrite', () => {
    /*
     * The manifest is read at install time and drives the splash screen, drawn
     * before any JavaScript runs, so it cannot follow the chosen theme and is
     * honest about being the default. But if index.html ever stops shipping a
     * theme-color tag, syncBrowserChrome has nothing to rewrite and fails
     * silently - which is this project's recurring shape.
     */
    const html = readRaw(new URL('../../web/index.html', import.meta.url));
    assert.match(html, /name="theme-color"/, 'nothing for the theme to write into');
  });
});

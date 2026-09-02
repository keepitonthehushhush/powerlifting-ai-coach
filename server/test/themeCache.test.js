import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import {
  readCachedTheme,
  cacheTheme,
  forgetCachedTheme,
  paintCachedTheme,
} from '../../web/src/lib/themeCache.js';
import { DEFAULT_THEME_ID, THEME_IDS } from '../../web/src/lib/themes.js';

/**
 * ── THE FLASH, AND WHY IT WAS WORTH REMOVING ──────────────────────────────
 *
 * "When opening the coach diaz app on iphone, it looks like the app has
 * trouble trying to figure out or remember what theme it was originally in."
 *
 * That is an accurate description of what the app did. The theme lives on the
 * account, so nothing could paint it until the session was restored AND one
 * request answered - the default went up first, every time. On a desktop that
 * is a blink at the start of a session. iOS evicts a home-screen app's web
 * view aggressively, so on a phone almost every open is a cold start, and the
 * flash was most of what opening the app looked like.
 *
 * The rule that makes the fix safe, and the one every test below is really
 * about: NOTHING IS WRITTEN TO THE HINT THAT THE SERVER DID NOT JUST SAY.
 */

/** A localStorage that behaves, plus switches for the ways real ones do not. */
function fakeStorage({ throwOnGet = false, throwOnSet = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem(key) {
      if (throwOnGet) throw new Error('SecurityError');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (throwOnSet) throw new Error('QuotaExceededError');
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

/** The smallest document applyTheme() will accept, recording what it painted. */
function fakeDocument() {
  const props = {};
  const attrs = {};
  return {
    props,
    attrs,
    documentElement: {
      style: { setProperty: (key, value) => { props[key] = value; } },
      setAttribute: (key, value) => { attrs[key] = value; },
    },
    querySelectorAll: () => [],
  };
}

function withEnvironment({ storage, document: doc } = {}) {
  globalThis.window = { localStorage: storage };
  globalThis.document = doc;
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SOME_THEME = THEME_IDS.find((id) => id !== DEFAULT_THEME_ID);

describe('the hint round-trips', () => {
  test('what was cached is what comes back', () => {
    const storage = fakeStorage();
    withEnvironment({ storage });
    cacheTheme(USER, SOME_THEME);
    assert.deepEqual(readCachedTheme(), { userId: USER, themeId: SOME_THEME });
  });

  test('forgetting it leaves nothing behind', () => {
    const storage = fakeStorage();
    withEnvironment({ storage });
    cacheTheme(USER, SOME_THEME);
    forgetCachedTheme();
    assert.equal(readCachedTheme(), null);
    assert.equal(storage.map.size, 0, 'the key is still in storage');
  });

  test('the theme is stored under one key, not one key per user', () => {
    // A per-user key accumulates forever on a shared browser, and sign-out
    // would have to know every id it had ever written in order to clear them.
    const storage = fakeStorage();
    withEnvironment({ storage });
    cacheTheme(USER, SOME_THEME);
    cacheTheme(OTHER, DEFAULT_THEME_ID);
    assert.equal(storage.map.size, 1);
  });
});

describe('a hint is never trusted further than it can be checked', () => {
  test('a theme this build no longer has does not come back', () => {
    // A theme retired between deploys, or a row written by a newer version of
    // the app. The default is a working app; an unknown id is not.
    const storage = fakeStorage();
    storage.map.set('coachdiaz.theme', JSON.stringify({ u: USER, t: 'chartreuse-1998' }));
    withEnvironment({ storage });
    assert.equal(readCachedTheme(), null);
  });

  test('and one is never written either', () => {
    const storage = fakeStorage();
    withEnvironment({ storage });
    cacheTheme(USER, 'chartreuse-1998');
    assert.equal(storage.map.size, 0);
  });

  test('a write with no user id is refused', () => {
    // The id is what lets the loader tell somebody else's hint from this
    // athlete's. A hint with nobody attached cannot be checked at all.
    const storage = fakeStorage();
    withEnvironment({ storage });
    cacheTheme(null, SOME_THEME);
    cacheTheme(undefined, SOME_THEME);
    assert.equal(storage.map.size, 0);
  });

  test('malformed storage reads as no hint rather than throwing', () => {
    for (const junk of ['', 'not json at all', '{"u":1,"t":2}', 'null', '[]']) {
      const storage = fakeStorage();
      storage.map.set('coachdiaz.theme', junk);
      withEnvironment({ storage });
      assert.equal(readCachedTheme(), null, `for ${JSON.stringify(junk)}`);
    }
  });
});

describe('a storage that misbehaves degrades to no hint, never to an exception', () => {
  /*
   * Safari in private browsing has historically thrown on write, some embedded
   * web views throw on touching the property at all, and a browser set to
   * block site data throws on read. This runs before the first render, so an
   * exception here is a blank app rather than a wrong color.
   */
  test('a read that throws', () => {
    withEnvironment({ storage: fakeStorage({ throwOnGet: true }) });
    assert.equal(readCachedTheme(), null);
  });

  test('a write that throws', () => {
    withEnvironment({ storage: fakeStorage({ throwOnSet: true }) });
    assert.doesNotThrow(() => cacheTheme(USER, SOME_THEME));
  });

  test('a window whose localStorage getter throws', () => {
    globalThis.window = {
      get localStorage() {
        throw new Error('The operation is insecure.');
      },
    };
    assert.equal(readCachedTheme(), null);
    assert.doesNotThrow(() => cacheTheme(USER, SOME_THEME));
    assert.doesNotThrow(() => forgetCachedTheme());
  });

  test('no window at all', () => {
    assert.equal(readCachedTheme(), null);
    assert.doesNotThrow(() => cacheTheme(USER, SOME_THEME));
  });
});

describe('painting the hint', () => {
  test('a cached theme is painted onto the document', () => {
    const storage = fakeStorage();
    const doc = fakeDocument();
    withEnvironment({ storage, document: doc });
    cacheTheme(USER, SOME_THEME);

    assert.equal(paintCachedTheme(), SOME_THEME);
    assert.equal(doc.attrs['data-theme'], SOME_THEME);
    assert.ok(doc.props['--bg'], 'no background was painted');
  });

  test('NO hint paints nothing at all', () => {
    /*
     * This is the important half. Inline custom properties beat the
     * stylesheet's `@media (prefers-color-scheme)` block - see applyTheme.js -
     * so painting the default here would take ownership of light and dark
     * before anything is watching for a change. With no hint, the stylesheet
     * keeps doing its job until the provider mounts.
     */
    const doc = fakeDocument();
    withEnvironment({ storage: fakeStorage(), document: doc });

    assert.equal(paintCachedTheme(), null);
    assert.deepEqual(doc.props, {});
    assert.deepEqual(doc.attrs, {});
  });
});

describe('WHERE THE PAINT HAPPENS, WHICH IS THE WHOLE FIX', () => {
  const main = readSource(new URL('../../web/src/main.jsx', import.meta.url));

  test('before React is asked to render anything', () => {
    // A provider cannot fix this: by its first render the browser has already
    // painted the stylesheet, which is the flash.
    const paint = main.indexOf('paintCachedTheme()');
    const render = main.indexOf('createRoot(');
    assert.ok(paint > -1, 'main.jsx does not paint the hint');
    assert.ok(render > -1, 'main.jsx no longer mounts React where this test looks');
    assert.ok(paint < render, 'the hint is painted after React mounts, which is too late');
  });
});

describe('THE PROVIDER, AND THE TWO WAYS THIS FIX UNDOES ITSELF', () => {
  const provider = readSource(new URL('../../web/src/context/ThemeContext.jsx', import.meta.url));

  test('the first render agrees with what was already painted', () => {
    // Starting at the default and correcting in an effect is the same flash,
    // one layer up.
    assert.match(provider, /useState\(\(\) => readCachedTheme\(\)\?\.themeId \?\? DEFAULT_THEME_ID\)/);
  });

  test('"not signed in" and "not known yet" are not treated the same', () => {
    /*
     * `user` is null while the SDK restores the session from storage AND for
     * somebody who is signed out. Clearing the palette on the first is the
     * flash again; leaving it on the second is one person inheriting another's
     * theme. The provider must wait.
     */
    assert.match(provider, /if \(loading\) return undefined;/);
    const loader = provider.slice(provider.indexOf('if (loading) return undefined;'));
    assert.ok(
      loader.indexOf('if (loading)') < loader.indexOf('if (!userId)'),
      'the signed-out branch runs before auth has answered'
    );
    assert.match(provider, /\}, \[userId, loading\]\);/);
  });

  test('signing out drops the hint', () => {
    const signedOut = provider.slice(provider.indexOf('if (!userId) {'));
    assert.match(signedOut.slice(0, 200), /forgetCachedTheme\(\)/);
  });

  test("another account's hint is dropped as soon as the account is known", () => {
    assert.match(provider, /cached\.userId !== userId/);
  });
});

describe('NOTHING IS CACHED THAT THE SERVER DID NOT JUST SAY', () => {
  const provider = readSource(new URL('../../web/src/context/ThemeContext.jsx', import.meta.url));
  const setTheme = provider.slice(
    provider.indexOf('const setTheme = useCallback'),
    provider.indexOf('const value = useMemo')
  );

  test('the optimistic paint is not persisted', () => {
    // The paint is optimistic and the save is not. A hint written before the
    // server agreed could show somebody a palette their account rejected -
    // which would make this a second source of truth rather than a cache.
    assert.ok(
      setTheme.indexOf('cacheTheme(') > setTheme.indexOf('savePreferences('),
      'the theme is cached before the save is attempted'
    );
    assert.ok(
      setTheme.indexOf("setStatus('saved')") < setTheme.indexOf('cacheTheme('),
      'the theme is cached on a path that has not confirmed the save'
    );
  });

  test('a failed save is not persisted either', () => {
    const failed = setTheme.slice(setTheme.indexOf('} catch {'));
    assert.doesNotMatch(failed, /cacheTheme\(/);
  });

  test('a failed LOAD does not throw the hint away', () => {
    /*
     * The opposite direction, and it matters just as much on a phone: a
     * request that failed says nothing about what the account holds. Clearing
     * the hint on a dropped connection would turn one bad moment on the subway
     * into a flash on every launch afterwards.
     */
    const load = provider.slice(
      provider.indexOf('const { preferences } = await api.getPreferences();'),
      provider.indexOf('const setTheme = useCallback')
    );
    const failed = load.slice(load.indexOf('} catch {'));
    assert.ok(failed.length > 0, 'the load no longer has a catch where this test looks');
    assert.doesNotMatch(failed, /forgetCachedTheme\(/);
  });

  test('an account with no stored theme caches the default, rather than re-asking forever', () => {
    assert.match(provider, /isThemeId\(preferences\?\.theme\) \? preferences\.theme : DEFAULT_THEME_ID/);
    assert.match(provider, /cacheTheme\(userId, stored\)/);
  });
});

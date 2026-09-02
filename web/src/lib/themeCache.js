import { isThemeId } from './themes.js';
import { applyTheme } from './applyTheme.js';

/**
 * A local hint about which palette to paint before the account can say.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────────
 *
 * The theme lives on the account, which means nothing can know it until the
 * Supabase session is restored from storage AND one request comes back. Both
 * are asynchronous, so every cold start painted Miami first and then snapped
 * to the athlete's actual palette a beat later.
 *
 * On a desktop that is a blink. On an iPhone it is the normal experience of
 * the app: iOS evicts a web view aggressively, so re-opening a home-screen app
 * that has been in the background for a few minutes is a COLD start, not a
 * resume. Reported as the app having trouble remembering what theme it was in,
 * which is the correct reading of what it looks like.
 *
 * ── WHY THIS IS NOT A SECOND SOURCE OF TRUTH ──────────────────────────────
 *
 * ThemeContext used to argue against exactly this, on the grounds that a cache
 * is a second copy of a fact the account already owns, and that this project
 * has been bitten by second copies. That argument is right about a second
 * SOURCE and does not apply to what is written here, because of one rule this
 * module exists to hold:
 *
 *   NOTHING IS EVER WRITTEN HERE THAT THE SERVER DID NOT JUST SAY.
 *
 * Not the optimistic paint when somebody taps a swatch, and not a theme whose
 * save failed - those are real states of the app and they are deliberately
 * NOT persisted, because a cache that can hold a value the account rejected is
 * a second source of truth and would show somebody a palette on Tuesday that
 * their account never accepted on Monday. The account remains the only place a
 * theme is decided. This is a picture of the last answer it gave.
 *
 * It is therefore always safe to throw away, and it is thrown away on sign-out
 * so that the next person at this browser does not inherit a palette from an
 * account they are not in.
 *
 * ── WHY THE USER ID IS STORED WITH IT ─────────────────────────────────────
 *
 * The paint happens before anybody knows who is signed in - that is the entire
 * point of it - so the id cannot be checked at paint time. It is checked the
 * moment auth resolves: a cache belonging to somebody else is dropped and the
 * default painted, rather than leaving one athlete's palette on screen for the
 * length of a request made by another. The id is no new exposure; the auth SDK
 * already keeps the whole session, id included, in this same storage.
 *
 * ── WHY EVERY ACCESS IS WRAPPED ───────────────────────────────────────────
 *
 * `localStorage` is not reliably present. Safari in private browsing has
 * historically thrown on write, some embedded web views throw on merely
 * touching the property, and a browser set to block site data throws on read.
 * A palette is not worth an exception on first paint - every failure here
 * degrades to "no hint", which is exactly the behavior this replaces.
 */

const KEY = 'coachdiaz.theme';

/** The store, or null where there is not one. Never throws. */
function store() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * @returns {{userId: string, themeId: string}|null} the last server-confirmed
 *   pair, or null if there is none, it cannot be read, or it does not name a
 *   theme this build still has. A theme retired between deploys must paint the
 *   default rather than nothing.
 */
export function readCachedTheme() {
  const storage = store();
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.u !== 'string' || !isThemeId(parsed.t)) return null;
    return { userId: parsed.u, themeId: parsed.t };
  } catch {
    // Malformed JSON from an older shape, or a storage that refuses to be
    // read. Either way there is no hint, which is a working app.
    return null;
  }
}

/** Record what the account just said. Only ever called with a server answer. */
export function cacheTheme(userId, themeId) {
  const storage = store();
  if (!storage || typeof userId !== 'string' || !isThemeId(themeId)) return;
  try {
    storage.setItem(KEY, JSON.stringify({ u: userId, t: themeId }));
  } catch {
    // Full, or refused. The app keeps working; the next cold start flashes.
  }
}

/** Drop the hint. Called on sign-out and when it belongs to somebody else. */
export function forgetCachedTheme() {
  const storage = store();
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    // Nothing to do about it, and nothing depends on it having worked.
  }
}

/**
 * Paint the hint, before React exists.
 *
 * Called from main.jsx rather than from a provider on purpose: a provider's
 * first render is already too late to prevent the flash, because the browser
 * has painted the stylesheet's own palette by then. This runs while the module
 * graph is still evaluating.
 *
 * ── WHAT IS LEFT, MEASURED RATHER THAN ASSUMED ────────────────────────────
 *
 * This does NOT beat the browser's first paint, which I assumed it would and
 * it does not. Rendering the real load order in headless Chromium - external
 * stylesheet in the head, module script in the body - and comparing the
 * module's own timestamp against `performance.getEntriesByType('paint')`: two
 * runs in five recorded a first-paint, at 104ms and 56ms, against module
 * execution at 116ms and 59ms. The other three recorded no first-paint at all.
 * A module script is deferred, so the browser is entitled to paint first, and
 * about one frame's worth of the time it does.
 *
 * What it paints is the empty document - `#root` has nothing in it yet - so
 * the residue is one frame of the stylesheet's BACKGROUND, not a frame of the
 * app wearing the wrong palette. That is the difference between this and the
 * bug: the bug was the whole interface in the default theme for as long as a
 * session restore and a request took on a phone.
 *
 * Closing the last frame needs a blocking classic script in the head, which is
 * the standard technique and is available to us - `script-src 'self'` allows a
 * same-origin file, and an INLINE one is correctly forbidden. It was not taken
 * because it delays first paint for every visitor on every load to remove one
 * frame of a background color, and because it would need the resolved
 * background cached beside the id, which is a derived value living somewhere
 * the catalog does not. Worth doing if the frame is ever visible in practice;
 * not worth doing on the strength of the measurement above.
 *
 * @returns {string|null} the theme id painted, or null if there was no hint.
 */
export function paintCachedTheme() {
  const cached = readCachedTheme();
  if (!cached) return null;
  applyTheme(cached.themeId);
  return cached.themeId;
}

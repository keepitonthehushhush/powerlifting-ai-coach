import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import { applyTheme, currentMode, watchColorScheme } from '../lib/applyTheme.js';
import { DEFAULT_THEME_ID, isThemeId } from '../lib/themes.js';
import { readCachedTheme, cacheTheme, forgetCachedTheme } from '../lib/themeCache.js';

/**
 * Which palette the app is wearing.
 *
 * ── WHY THE PAINT IS OPTIMISTIC AND THE SAVE IS NOT ───────────────────────
 *
 * Picking a theme repaints immediately, before the network is involved. A
 * color choice that waits on a round trip feels broken, and there is nothing
 * to validate - the catalog is in this bundle, so the client already knows
 * whether the id is real.
 *
 * The SAVE can still fail, and when it does the picker says so rather than
 * pretending. The person keeps the theme they chose for this session and is
 * told plainly that it did not reach their account, which is the honest split:
 * the thing they can see is true, and the thing they cannot see is reported.
 *
 * ── ON THE FLASH OF THE DEFAULT PALETTE, WHICH IS NOW GONE ────────────────
 *
 * This note used to say the flash was a deliberate trade: the theme lives on
 * the account, cannot be known until the session and one request resolve, and
 * caching the id locally would be a second copy of a fact the account owns -
 * which this project has been bitten by.
 *
 * The trade was worth revisiting once it was measured on a phone rather than a
 * desktop. iOS evicts a home-screen app's web view aggressively, so re-opening
 * Coach Diaz after a few minutes away is a COLD start every time: the flash was
 * not a blink at the start of a session, it was most of what opening the app
 * looked like. It was reported, correctly, as the app having trouble
 * remembering what theme it was in.
 *
 * The objection was right about a second SOURCE and does not apply to what
 * lib/themeCache.js writes, because nothing is ever written there that the
 * server did not just say - not the optimistic paint below, and not a theme
 * whose save failed. The account is still the only place a theme is decided.
 *
 * Two things here follow from that and are easy to get wrong:
 *
 *   1. The initial state READS the hint, so React's first render agrees with
 *      what main.jsx already painted. Starting at the default and correcting
 *      in an effect would reintroduce the flash one layer up.
 *   2. The loader waits for auth to finish. `user` is null both when somebody
 *      is signed out and when the session has not been restored yet, and those
 *      need opposite behavior - the first must clear the palette and the hint,
 *      the second must leave both alone. Treating them the same is how a fix
 *      for this flash becomes the flash again.
 */
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  // Lazy, and reading the same hint main.jsx painted from: a first render that
  // disagreed with the document would repaint the default over it.
  const [themeId, setThemeId] = useState(() => readCachedTheme()?.themeId ?? DEFAULT_THEME_ID);
  const [status, setStatus] = useState('idle');

  // Read by the color-scheme listener, which must repaint the CURRENT theme
  // and would otherwise close over the id as it was when the listener was
  // attached - repainting Miami over somebody's choice on the first sunset.
  const themeRef = useRef(themeId);
  themeRef.current = themeId;

  // Paint on every change of theme. Mode is read fresh rather than stored,
  // because the system may have flipped between renders.
  useEffect(() => {
    applyTheme(themeId, currentMode());
  }, [themeId]);

  // Follow the system between light and dark. Applying inline custom
  // properties overrides the stylesheet's media query, so once we paint, this
  // listener is the only thing left that knows the system changed.
  useEffect(() => watchColorScheme((mode) => applyTheme(themeRef.current, mode)), []);

  // Load the stored choice when somebody signs in; fall back to the default
  // when they sign out, so the next person at this browser does not inherit
  // a palette from an account they are not in.
  useEffect(() => {
    // Auth has not answered yet. `user` is null here for the same reason it is
    // null for a signed-out visitor, and the two need opposite handling - so
    // this waits rather than guessing, and whatever was painted from the hint
    // stays on screen.
    if (loading) return undefined;

    if (!userId) {
      setThemeId(DEFAULT_THEME_ID);
      forgetCachedTheme();
      return undefined;
    }

    // A hint left by a different account. Drop it now rather than showing one
    // athlete's palette for the length of another athlete's request.
    const cached = readCachedTheme();
    if (cached && cached.userId !== userId) {
      forgetCachedTheme();
      setThemeId(DEFAULT_THEME_ID);
    }

    let cancelled = false;
    (async () => {
      try {
        const { preferences } = await api.getPreferences();
        if (cancelled) return;
        // No row is the normal state for somebody who never opened the picker,
        // and the default is the right answer for them - cached as such, so
        // their next cold start does not re-ask to find out the same thing.
        const stored = isThemeId(preferences?.theme) ? preferences.theme : DEFAULT_THEME_ID;
        setThemeId(stored);
        cacheTheme(userId, stored);
      } catch {
        // A palette is not worth an error message. The default is a working
        // app, and the picker will report a failure if they try to change it.
        //
        // The hint is deliberately NOT cleared here. A request that failed
        // says nothing about what the account holds, and throwing the hint
        // away on a dropped connection would turn one bad moment on a phone
        // into a flash on every launch afterwards.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, loading]);

  const setTheme = useCallback(
    async (next) => {
      if (!isThemeId(next)) return;
      setThemeId(next);
      setStatus('saving');
      try {
        await api.savePreferences({ theme: next });
        setStatus('saved');
        // Cached only now. The paint above is optimistic and the save is not,
        // and a hint written before the server agreed could show somebody a
        // palette their account rejected - which is the second-source-of-truth
        // failure this cache is built to avoid.
        if (userId) cacheTheme(userId, next);
      } catch {
        setStatus('failed');
      }
    },
    [userId]
  );

  const value = useMemo(() => ({ themeId, setTheme, status }), [themeId, setTheme, status]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside a ThemeProvider');
  return value;
}

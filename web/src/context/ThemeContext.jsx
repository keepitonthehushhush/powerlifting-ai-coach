import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import { applyTheme, currentMode, watchColorScheme } from '../lib/applyTheme.js';
import { DEFAULT_THEME_ID, isThemeId } from '../lib/themes.js';

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
 * ── ON THE FLASH OF THE DEFAULT PALETTE ───────────────────────────────────
 *
 * The stored theme lives on the account, so it cannot be known until the
 * session and one request resolve - which means a moment of Miami first. That
 * is a deliberate trade: the alternative discussed was caching the id in
 * localStorage to paint instantly, which is a second copy of a fact that the
 * account already owns, and this project has been bitten by second copies. If
 * the flash is worth removing later, the cache is about ten lines and belongs
 * here, next to this note.
 */
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
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
    if (!userId) {
      setThemeId(DEFAULT_THEME_ID);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { preferences } = await api.getPreferences();
        // No row is the normal state for somebody who never opened the picker.
        if (!cancelled && isThemeId(preferences?.theme)) setThemeId(preferences.theme);
      } catch {
        // A palette is not worth an error message. The default is a working
        // app, and the picker will report a failure if they try to change it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setTheme = useCallback(async (next) => {
    if (!isThemeId(next)) return;
    setThemeId(next);
    setStatus('saving');
    try {
      await api.savePreferences({ theme: next });
      setStatus('saved');
    } catch {
      setStatus('failed');
    }
  }, []);

  const value = useMemo(() => ({ themeId, setTheme, status }), [themeId, setTheme, status]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside a ThemeProvider');
  return value;
}

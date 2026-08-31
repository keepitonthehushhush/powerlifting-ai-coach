import { tokensFor, DEFAULT_THEME_ID, isThemeId } from './themes.js';

/**
 * Paint a theme onto the document, and keep it painted when the system flips.
 *
 * ── WHY THIS SETS INLINE CUSTOM PROPERTIES, AND WHAT THAT COSTS ───────────
 *
 * The stylesheet declares the default palette in `:root` and overrides it in
 * an `@media (prefers-color-scheme: light)` block. Inline styles on the root
 * element beat BOTH, because specificity says so - which means the moment a
 * theme is applied this way, the media query stops being able to do its job.
 *
 * That is not a bug to work around, it is the consequence to accept and then
 * handle: once we are painting, we own light and dark. So `applyTheme` takes
 * the mode explicitly, and `watchColorScheme` re-applies when the system
 * preference changes. Nothing is left half-owned.
 *
 * The alternative - a `[data-theme]` attribute and twenty CSS blocks - was
 * considered and rejected. It needs the catalog to exist twice, once in JS for
 * the picker and once in generated CSS for the paint, and this project has
 * been bitten twice by two copies of one fact drifting apart. One catalog,
 * applied directly.
 */

const MEDIA = '(prefers-color-scheme: light)';

/** Dark unless the system asks for light. Safe where matchMedia is absent. */
export function currentMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  try {
    return window.matchMedia(MEDIA).matches ? 'light' : 'dark';
  } catch {
    // Some embedded webviews throw rather than return false. A theme is not
    // worth an exception on first paint.
    return 'dark';
  }
}

/**
 * Write one theme's tokens onto an element as CSS custom properties.
 *
 * Returns the id actually applied, which is not always the one asked for: an
 * unknown id falls back to the default. A theme retired between deploys, or a
 * row written by a newer version of the app, should show somebody the default
 * palette rather than an unstyled page.
 */
export function applyTheme(themeId, mode = currentMode(), el = document?.documentElement) {
  if (!el?.style) return DEFAULT_THEME_ID;
  const resolved = isThemeId(themeId) ? themeId : DEFAULT_THEME_ID;
  const tokens = tokensFor(resolved, mode);
  for (const [name, value] of Object.entries(tokens)) {
    el.style.setProperty(`--${name}`, value);
  }
  // Not used for styling - the paint above is complete on its own - but a
  // theme somebody can see in the DOM is a theme somebody can screenshot,
  // report, and reproduce.
  el.setAttribute('data-theme', resolved);
  el.style.setProperty('color-scheme', mode);
  return resolved;
}

/**
 * Call `onChange(mode)` whenever the system color scheme flips.
 *
 * Returns an unsubscribe function. Uses addEventListener where it exists and
 * addListener where it does not: Safari only gained the modern API in 14, and
 * a theme that stops following the system on an older phone is a bug reported
 * as "the app goes white at night".
 */
export function watchColorScheme(onChange) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  let query;
  try {
    query = window.matchMedia(MEDIA);
  } catch {
    return () => {};
  }
  const handler = (event) => onChange(event.matches ? 'light' : 'dark');

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }
  if (typeof query.addListener === 'function') {
    query.addListener(handler);
    return () => query.removeListener(handler);
  }
  return () => {};
}

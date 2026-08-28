import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { en } from './locales/en.js';
import { es } from './locales/es.js';

/**
 * Minimal internationalisation, no dependency.
 *
 * Why hand-rolled rather than i18next or react-intl: this application has one
 * screenful of copy and needs three things - key lookup with fallback,
 * interpolation, and locale-aware number and date formatting. The last of
 * those is `Intl`, which is in the platform. A full i18n framework would add
 * roughly 40 KB to the bundle and a plugin architecture to serve requirements
 * we do not have.
 *
 * The honest limit: this has no plural rules and no gender agreement. Slavic
 * and Arabic plural categories in particular cannot be expressed by picking
 * between two strings. The moment a locale needs them, `Intl.PluralRules`
 * belongs in `t()` - or the project should adopt a real framework rather than
 * grow one badly. That threshold is stated here so the decision is deliberate
 * when it arrives instead of accidental.
 */

const CATALOGUES = { en, es };
export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

const STORAGE_KEY = 'coach.locale';
const FALLBACK = 'en';

/** Stored choice → browser preference → English. */
function detectLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && CATALOGUES[stored]) return stored;
  } catch {
    // Private browsing, or storage disabled. Fall through to detection.
  }

  for (const preference of navigator.languages ?? [navigator.language]) {
    if (!preference) continue;
    // Match the base language, so es-MX and es-AR both resolve to es.
    const base = preference.toLowerCase().split('-')[0];
    if (CATALOGUES[base]) return base;
  }

  return FALLBACK;
}

/** Resolve a dotted path such as 'intake.units.label' against a catalogue. */
function lookup(catalogue, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), catalogue);
}

function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next) => {
    if (!CATALOGUES[next]) return;
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply will not persist. Not worth surfacing to the user.
    }
  }, []);

  const value = useMemo(() => {
    const catalogue = CATALOGUES[locale] ?? CATALOGUES[FALLBACK];

    /**
     * Translate. Falls back to English, then to the key itself — a visible
     * `intake.goal.label` in the UI is a bug report, whereas a blank string is
     * a mystery.
     */
    const t = (key, vars) => {
      const value = lookup(catalogue, key) ?? lookup(CATALOGUES[FALLBACK], key);
      if (typeof value !== 'string') {
        /*
         * One of two deliberate console calls in the browser. no-console is an
         * error here because injury and restriction fields must never be
         * written to a console in plaintext - this writes a KEY NAME, in
         * development only, and it is the line that would have shouted
         * "missing key: auth.password" every time the sign-in page rendered
         * while that bug was live. Nobody was looking at a dev console. It
         * stays anyway: it costs nothing and it is right.
         */
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key} (${locale})`);
        return key;
      }
      return interpolate(value, vars);
    };

    // Locale-aware formatting. This is the half of internationalisation that
    // translation files do not cover: 1,234.5 lb in en-US is 1.234,5 lb in
    // es-ES, and getting it wrong looks careless in a way a good translation
    // cannot compensate for.
    const formatNumber = (value, options) =>
      value == null ? '' : new Intl.NumberFormat(locale, options).format(value);

    const formatWeight = (value, units) =>
      value == null ? '' : `${formatNumber(value, { maximumFractionDigits: 1 })} ${units}`;

    const formatDate = (value, options = { dateStyle: 'medium' }) =>
      value ? new Intl.DateTimeFormat(locale, options).format(new Date(value)) : '';

    return { locale, setLocale, t, formatNumber, formatWeight, formatDate };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside an I18nProvider');
  return context;
}

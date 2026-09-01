import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { THEMES } from '../lib/themes.js';
import { tokensFor } from '../lib/themes.js';
import { currentMode } from '../lib/applyTheme.js';

/**
 * The theme gallery.
 *
 * Every option is rendered as a live swatch built from the theme's own tokens
 * rather than from a stored screenshot, so a palette can never disagree with
 * its preview - and a holiday theme added to the catalog appears here with no
 * further work.
 *
 * Radio inputs, not buttons. This is a single choice from a set, which is what
 * a radio group means to a screen reader; a row of buttons would announce ten
 * unrelated actions and never say which one is current.
 */
export function ThemePicker({ value, onChange, status }) {
  const { t } = useI18n();
  const [mode, setMode] = useState(currentMode);

  // The swatches preview whichever mode the device is in, so what somebody
  // sees in the gallery is what they will get when they pick it.
  useEffect(() => {
    const id = setInterval(() => setMode(currentMode()), 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="card stack">
      <h2 className="h3">{t('themes.heading')}</h2>
      <p className="muted">{t('themes.intro')}</p>

      <div className="theme-grid" role="radiogroup" aria-label={t('themes.heading')}>
        {THEMES.map((theme) => {
          const swatch = tokensFor(theme.id, mode);
          const selected = value === theme.id;
          return (
            <label
              key={theme.id}
              className={`theme-option${selected ? ' is-selected' : ''}`}
              style={{
                '--sw-bg': swatch.bg,
                '--sw-surface': swatch.surface,
                '--sw-border': swatch.border,
                '--sw-text': swatch.text,
                '--sw-muted': swatch.muted,
                '--sw-accent': swatch.accent,
                '--sw-accent-text': swatch['accent-text'],
                '--sw-secondary': swatch.secondary,
              }}
            >
              <input
                type="radio"
                name="theme"
                value={theme.id}
                checked={selected}
                onChange={() => onChange(theme.id)}
                className="theme-radio"
              />
              {/* aria-hidden: the swatch is decoration. The name and blurb
                  below carry the same information as text, so announcing the
                  colored boxes would only add noise. */}
              <span className="theme-swatch" aria-hidden="true">
                <span className="theme-swatch-bar" />
                <span className="theme-swatch-chip" />
                <span className="theme-swatch-dot" />
              </span>
              <span className="theme-option-body">
                <span className="theme-name">{t(`themes.names.${theme.id}`)}</span>
                <span className="theme-blurb muted">{t(`themes.blurbs.${theme.id}`)}</span>
              </span>
            </label>
          );
        })}
      </div>

      {/*
        A live region, because the save happens without a button and the only
        evidence it worked is this line. Someone using a screen reader gets no
        visual confirmation to glance at.
      */}
      <p className="muted" role="status" aria-live="polite">
        {status === 'saving' && t('themes.saving')}
        {status === 'saved' && t('themes.saved')}
        {status === 'failed' && t('themes.failed')}
      </p>
    </section>
  );
}

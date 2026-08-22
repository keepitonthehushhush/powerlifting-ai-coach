import { SUPPORTED_LOCALES, useI18n } from '../i18n/index.jsx';

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className="lang">
      <span className="visually-hidden">{t('common.language')}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label={t('common.language')}
      >
        {SUPPORTED_LOCALES.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

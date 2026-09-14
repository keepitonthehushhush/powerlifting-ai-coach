import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { MOBILITY_DETAIL_LEVELS, resolveMobilityDetail } from '../lib/mobilityDetail.js';

/**
 * How much mobility and stretching work the athlete wants programmed.
 *
 * ── WHY IT LOADS RATHER THAN GUESSING ─────────────────────────────────────
 *
 * Same reasoning as NutritionSettings beside it. ChatSettings reads
 * localStorage and renders instantly, which is right for a setting that lives
 * in the browser; this one lives in the database, and rendering the default
 * while the real value is in flight would show somebody who turned mobility
 * work OFF a screen saying it is on. For a control whose whole purpose is that
 * they do not have to keep asking, that is the one thing it must not do - so
 * it renders nothing until it knows.
 *
 * ── AND WHY THE FAILURE IS VISIBLE ────────────────────────────────────────
 *
 * A save that fails silently leaves somebody believing they have asked for
 * something they have not. The radio moves first so the tap is acknowledged,
 * and it moves BACK with an error if the write did not land.
 */
export function MobilitySettings() {
  const { t } = useI18n();
  const [level, setLevel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    api
      .getMobilityDetail()
      .then((result) => {
        if (live) setLevel(resolveMobilityDetail(result?.mobility_detail));
      })
      .catch(() => {
        // Nothing rendered rather than a wrong default. See above.
        if (live) setLevel(null);
      });
    return () => {
      live = false;
    };
  }, []);

  async function choose(next) {
    if (next === level || saving) return;
    const previous = level;
    setLevel(next);
    setSaving(true);
    setError(null);
    try {
      await api.saveMobilityDetail(next);
    } catch (err) {
      setLevel(previous);
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  if (level === null) return null;

  return (
    <section className="card stack">
      <h2 className="h3">{t('mobilitySettings.heading')}</h2>
      <p className="small muted">{t('mobilitySettings.intro')}</p>

      <fieldset className="setting-group">
        <legend>{t('mobilitySettings.legend')}</legend>
        {MOBILITY_DETAIL_LEVELS.map((choice) => (
          <label key={choice} className="setting-choice">
            <input
              type="radio"
              name="mobilityDetail"
              value={choice}
              checked={level === choice}
              disabled={saving}
              onChange={() => choose(choice)}
            />
            <span>
              {t(`mobilitySettings.level.${choice}`)}
              <span className="small muted"> — {t(`mobilitySettings.levelHint.${choice}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Said on the settings screen rather than left for the coach to say, or
          not say, in a reply somebody may never read. Turning this up is worth
          doing for range of motion; it is not a recovery or injury-prevention
          feature and the screen that offers it should not let anybody believe
          otherwise. */}
      <p className="small muted">{t('mobilitySettings.notRecovery')}</p>

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

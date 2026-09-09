import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { NUTRITION_DETAIL_LEVELS, resolveNutritionDetail } from '../lib/nutritionDetail.js';

/**
 * How much of the food conversation the athlete wants.
 *
 * ── WHY IT LOADS RATHER THAN GUESSING ─────────────────────────────────────
 *
 * ChatSettings next to this reads localStorage and renders instantly, which is
 * right for a setting that lives in the browser. This one lives in the
 * database, and rendering the default while the real value is in flight would
 * show somebody who turned food OFF a screen saying it is on. For a control
 * whose whole purpose is that they do not have to keep asking, that is the one
 * thing it must not do - so it renders nothing until it knows.
 *
 * ── AND WHY THE FAILURE IS VISIBLE ────────────────────────────────────────
 *
 * A save that fails silently leaves somebody believing they have turned food
 * off. The optimistic value is rolled back and the error is shown, because the
 * honest outcome of "we could not save that" is that it is not saved.
 */
export function NutritionSettings() {
  const { t } = useI18n();
  const [level, setLevel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    api
      .getProfile()
      .then((result) => {
        if (live) setLevel(resolveNutritionDetail(result?.profile?.nutrition_detail));
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
      await api.saveProfile({ nutrition_detail: next });
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
      <h2 className="h3">{t('nutritionSettings.heading')}</h2>
      <p className="small muted">{t('nutritionSettings.intro')}</p>

      <fieldset className="setting-group">
        <legend>{t('nutritionSettings.legend')}</legend>
        {NUTRITION_DETAIL_LEVELS.map((choice) => (
          <label key={choice} className="setting-choice">
            <input
              type="radio"
              name="nutritionDetail"
              value={choice}
              checked={level === choice}
              disabled={saving}
              onChange={() => choose(choice)}
            />
            <span>
              {t(`nutritionSettings.level.${choice}`)}
              <span className="small muted"> — {t(`nutritionSettings.levelHint.${choice}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Said here rather than left for somebody to discover by asking. A
          settings screen that lists three options invites the question "is
          there a fourth", and the answer is a scope-of-practice line rather
          than a feature we have not built yet. */}
      <p className="small muted">{t('nutritionSettings.noCalorieTargets')}</p>

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

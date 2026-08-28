import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * The badges, which are private and stay private.
 *
 * Computed from the reader's own logs on every read, never stored, never
 * published. See lib/achievements.js for the part that matters - which is not
 * the list, but the list this product refuses to have.
 */
export function AchievementShelf() {
  const { t } = useI18n();
  const [earned, setEarned] = useState(null);

  useEffect(() => {
    api.getAchievements()
      .then((r) => setEarned(r?.achievements ?? []))
      .catch(() => setEarned([]));
  }, []);

  if (earned === null) return null;

  return (
    <section className="card stack">
      <h2 className="h3">{t('achievements.title')}</h2>
      <p className="muted small">{t('achievements.private')}</p>

      {earned.length === 0 ? (
        <p className="muted small">{t('achievements.none')}</p>
      ) : (
        <ul className="badges">
          {earned.map((a) => (
            <li key={a.id} className="badge">
              <strong>{badgeName(t, a)}</strong>
              {a.earnedOn && <span className="muted small">{a.earnedOn}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* The most useful sentence on the page: why there is no streak. */}
      <p className="muted small">{t('achievements.noStreaks')}</p>
    </section>
  );
}

function badgeName(t, achievement) {
  if (achievement.kind === 'milestone') {
    return t('achievements.milestone', {
      weight: achievement.detail.weight,
      units: achievement.detail.units,
      lift: achievement.detail.lift,
    });
  }
  if (achievement.id === 'came_back') {
    return t('achievements.cameBack', { days: achievement.detail.daysAway });
  }
  return t(`achievements.name.${achievement.id}`);
}

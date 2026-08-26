import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * The exercise library: cues, common faults, and a link to a demonstration.
 *
 * ── ON THE VIDEOS ─────────────────────────────────────────────────────────
 *
 * Nothing here is embedded. There is no iframe, no player, no thumbnail
 * fetched from anyone's CDN. Each entry carries a plain outbound link to the
 * rights holder's own page, opened in a new tab, and the source is named on
 * screen so the athlete knows whose instruction they are about to watch.
 *
 * That is a product constraint, not a technical one: this application does not
 * host, mirror or reproduce video it does not own. An embed would put someone
 * else's content inside our page, which is the thing being avoided.
 *
 * ── WHY FAULTS SIT NEXT TO CUES ───────────────────────────────────────────
 *
 * A beginner cannot self-diagnose from cues alone. "Knees out" tells you what
 * to do; "knees drifting inward under load" tells you what to look for when
 * you film yourself, which is the only feedback loop available to someone
 * training without a coach in the room.
 */
export function Library() {
  const { t } = useI18n();
  const [exercises, setExercises] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getLibrary()
      .then((data) => setExercises(data.exercises ?? []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div className="row">
          <h1>{t('library.title')}</h1>
          <Link className="link" to="/coach">
            {t('library.backToCoach')}
          </Link>
        </div>
        <p className="muted">{t('library.subtitle')}</p>
      </header>

      {error && <p className="error">{error}</p>}
      {!exercises && !error && <p className="muted">{t('common.loading')}</p>}

      {exercises?.length === 0 && <p className="muted">{t('library.empty')}</p>}

      {exercises?.map((exercise) => (
        <section key={exercise.slug} className="card stack">
          <h2 className="h3">{exercise.name}</h2>

          {exercise.cues?.length > 0 && (
            <>
              <h3 className="h4">{t('library.cues')}</h3>
              <ul>
                {exercise.cues.map((cue) => (
                  <li key={cue}>{cue}</li>
                ))}
              </ul>
            </>
          )}

          {exercise.common_faults?.length > 0 && (
            <>
              <h3 className="h4">{t('library.faults')}</h3>
              <ul>
                {exercise.common_faults.map((fault) => (
                  <li key={fault}>{fault}</li>
                ))}
              </ul>
            </>
          )}

          {exercise.video_url && (
            <p className="stack-tight">
              {/* An ordinary outbound link. noopener/noreferrer because the new
                  tab should get no handle back to this window. */}
              <a
                className="link strong"
                href={exercise.video_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('library.watchDemo')}
              </a>
              <br />
              <span className="muted small">
                {t('library.videoCredit', { source: exercise.video_source ?? t('library.thirdParty') })}
              </span>
            </p>
          )}
        </section>
      ))}

      <p className="muted small">{t('library.filmYourself')}</p>
    </div>
  );
}

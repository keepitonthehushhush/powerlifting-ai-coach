import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { BackToTop, StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';
import { Loading } from '../components/Loading.jsx';

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
 * That is a product constraint, not a technical one. The copyright argument
 * would in fact permit an embed - YouTube's official iframe is the display
 * mechanism the rights holder consents to, and a creator can switch embedding
 * off if they object - so the reason we do not is PRIVACY, not copyright. An
 * embed is third-party code on our origin, setting cookies and reporting to a
 * third party that this person watched a squat tutorial, inside an app that
 * also knows about their shoulder. That is a poor trade for saving one tap.
 *
 * ── WHY THESE LINKS DO NOT OPEN A NEW TAB ─────────────────────────────────
 *
 * They used to. target="_blank" opens a tab with NO HISTORY, so the browser's
 * back button is disabled in it - and the app is still open in the tab behind,
 * which the athlete cannot see, especially on a phone. Reported as "it does not
 * let me come back". Same-tab navigation makes Back mean what it says. The link
 * says where it goes and warns that it leaves the app, so the athlete chooses
 * knowingly instead of being surprised.
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
      <StickyHeader>
      <header className="page-header">
        <SiteNav />
        <h1 className="page-title">{t('library.title')}</h1>
        <p className="muted header-detail">{t('library.subtitle')}</p>
      </header>
      </StickyHeader>

      {error && <p className="error">{error}</p>}
      {!exercises && !error && <Loading size={72} />}

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
              {/* Same tab, so Back returns here. noreferrer still applies: the
                  destination has no business knowing which page sent them. */}
              <a className="link strong leaves-app" href={exercise.video_url} rel="noreferrer">
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
      <BackToTop label={t('common.backToTop')} />
    </div>
  );
}

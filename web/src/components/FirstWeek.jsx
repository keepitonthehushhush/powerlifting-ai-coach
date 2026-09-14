import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';

/**
 * The first-week panel: four things, ticking themselves off.
 *
 * ── WHY THIS IS NOT A TOUR ────────────────────────────────────────────────
 *
 * The instinct for "show a new user around" is a welcome carousel over the
 * real screens. The measured outcomes for that are poor and get worse with
 * every step: roughly 70% of people skip linear tours outright, a three-step
 * tour completes around 72% and a seven-step one around 16%, and the named
 * reason steps feel irrelevant is FEATURE-FIRST FRAMING - "this is the
 * Program tab" describes the software rather than the person's week.
 * Guidance embedded in the page is acted on about 1.5x as often as the same
 * guidance in a modal, and a modal here would stand between a new athlete and
 * the composer they need to type into.
 *
 * So: no overlay, no steps to click through, nothing to dismiss before the
 * product can be used. A short list, in the page, above the openers, written
 * as things that are about to happen rather than as parts of an app.
 *
 * ── WHAT THIS COMPONENT DOES NOT DECIDE ───────────────────────────────────
 *
 * Which steps exist, and which are done. Both come from the server, as ids
 * and booleans - see server/src/lib/onboarding.js for why the copy lives in
 * the locale files and why the profile does not travel to this page. This
 * file renders `t()` of an id and nothing else; it cannot invent a step and
 * it cannot tick one.
 *
 * The live step is the FIRST undone one, computed here because that is a fact
 * about the list rather than about the account, and a second copy of it on
 * the server would be a second thing to keep in step.
 */

/**
 * Where each step goes, when it goes anywhere.
 *
 * `firstMessage` is deliberately absent: the thing that completes it is the
 * composer six inches below, and a link that scrolls somebody to a box they
 * are already looking at is noise. The map is a closed set - a step id with no
 * entry simply renders no link, so adding one to onboarding.js can never
 * produce a dead `<Link to={undefined}>`.
 */
const DESTINATIONS = {
  profile: '/intake',
  program: '/program',
  logSession: '/log',
  clearanceAsk: '/library',
};

export function FirstWeek({ steps, onHide }) {
  const { t } = useI18n();

  if (!Array.isArray(steps) || steps.length === 0) return null;

  // An athlete waiting on medical clearance is shown a shorter list and a
  // different heading, because the ordinary one promises four things and the
  // product has just told them it will not do one of them yet. Read off the
  // ids rather than from a second field, so there is exactly one place that
  // knows the list is the clearance one.
  const waiting = steps.some((step) => step.id === 'clearanceAsk');
  const live = steps.findIndex((step) => !step.done);

  return (
    <section className="first-week" aria-labelledby="first-week-title">
      <div className="first-week-head">
        <h2 id="first-week-title">{t('onboarding.title')}</h2>
        <button type="button" className="first-week-hide" onClick={onHide}>
          {t('onboarding.hide')}
        </button>
      </div>

      <p className="first-week-sub">
        {t(waiting ? 'onboarding.subtitleClearance' : 'onboarding.subtitle')}
      </p>

      <ol className="first-week-steps">
        {steps.map((step, index) => {
          const to = DESTINATIONS[step.id];

          return (
            <li
              key={step.id}
              className={[step.done ? 'done' : '', index === live ? 'live' : '']
                .filter(Boolean)
                .join(' ')}
            >
              {/* The tick is a picture of a status, so it carries the status
                  in words for anybody who cannot see it - and the words are
                  "Done" and "Not done yet" rather than "complete" and
                  "incomplete", which read as a verdict on the person. */}
              <span
                className="first-week-tick"
                role="img"
                aria-label={t(step.done ? 'onboarding.stepDone' : 'onboarding.stepTodo')}
              >
                {step.done ? '✓' : ''}
              </span>

              <span className="first-week-body">
                <span className="first-week-title">{t(`onboarding.steps.${step.id}.title`)}</span>
                {/* Only the step somebody is actually on explains itself. The
                    ones behind and ahead of it are a shape, not a briefing:
                    four paragraphs of reasons is the wall of text this panel
                    exists instead of.

                    Every step has a `why`; only the ones in DESTINATIONS have
                    a `go`, and the map is what decides it. Asking t() whether
                    a key exists - by comparing its answer to the key, which is
                    what it returns when it misses - would be a second, weaker
                    copy of that decision, and it would silently start
                    rendering a raw key the day somebody renamed one. */}
                {index === live && (
                  <span className="first-week-why">{t(`onboarding.steps.${step.id}.why`)}</span>
                )}
                {index === live && to && (
                  <Link className="first-week-go" to={to}>
                    {t(`onboarding.steps.${step.id}.go`)}
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

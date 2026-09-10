import { useI18n } from '../i18n/index.jsx';

/**
 * What the product actually looks like, on the page that has to sell it.
 *
 * ── THE GAP THIS FILLS ────────────────────────────────────────────────────
 *
 * Before this there was not one image of the product anywhere in the app.
 * `web/public` held six files and all six were PWA icons. A page whose entire
 * pitch is "a strength coach that reads what you actually lifted" never showed
 * a conversation, a program, or anything being read - so the only way to find
 * out what the thing does was to sign up and do a five-minute intake form on
 * faith. Of seven accounts, two never opened the intake at all.
 *
 * ── WHY THIS IS LIVE MARKUP AND NOT A SCREENSHOT ──────────────────────────
 *
 * The obvious answer is a PNG. It is the wrong one here, for four reasons and
 * the first is decisive:
 *
 *   1. THERE ARE TWENTY LOOKS. Ten theme packs in light and dark, all solved
 *      from tokens at build time. A screenshot is correct in one of them and
 *      wrong in nineteen - and "wrong" includes a white screenshot burning a
 *      hole in a dark page.
 *   2. It would rot. A screenshot records what the app looked like the day
 *      somebody remembered to retake it. This is the app's own CSS, so a
 *      change to `.bubble` moves the marketing page with it.
 *   3. It costs nothing to ship: no image files, no 2x variants, no bytes, and
 *      no change to `img-src 'self' data:` in the CSP.
 *   4. The text is real text - selectable, translated, and read aloud by a
 *      screen reader instead of announced as "image".
 *
 * ── AND WHAT IT IS NOT ────────────────────────────────────────────────────
 *
 * It is a DEPICTION with invented content, not a recording of somebody's
 * account, and it says so in a caption rather than leaving that to be assumed.
 * Nobody's real training data belongs on a marketing page - the athletes here
 * did not sign up to be the demo, and their sessions are health information.
 *
 * The invented athlete is deliberately unremarkable: a working weight, a
 * missed rep, no personal best and nothing to envy. The point being made is
 * "it reads what happened", not "look how strong our users are".
 */

/**
 * The loop, in three lines: they say what happened, the coach reads it, and
 * the app offers to write it down.
 *
 * The card at the end is the real one - same class, same shape, same check
 * mark drawing itself - because "nothing is written until you say yes" is the
 * most distinctive thing about this product and the hardest to convey in
 * prose.
 */
export function ConversationDemo() {
  const { t } = useI18n();
  /*
   * chat.you and chat.coach, not a second pair under home.*. The demo shows
   * the labels the app actually renders, so they cannot drift apart - and a
   * duplicate pair was caught by the landing-page guard that fails when a
   * Spanish string is identical to its English one. "Coach" IS the word in
   * both, which is exactly why it should be read from the place that already
   * decided that rather than asserted again here.
   */
  return (
    <figure className="home-demo" aria-labelledby="home-demo-caption">
      <div className="home-demo-screen">
        <article className="bubble user">
          <div className="who">{t('chat.you')}</div>
          <div className="content">{t('home.demoSaid')}</div>
        </article>

        <article className="bubble assistant">
          <div className="who">{t('chat.coach')}</div>
          <div className="content">{t('home.demoReplied')}</div>
        </article>

        {/* The confirmation card, exactly as the app renders it. Not the
            SavedNotice component itself: that one animates on mount, and a
            check drawing itself every time somebody scrolls past a marketing
            page is a tic rather than a signal. Same markup, no motion. */}
        <div className="program-saved saved-notice home-demo-card">
          <svg className="saved-check" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
            <path
              d="M4 10.6 L8.3 14.8 L16.2 5.6"
              pathLength="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="saved-notice-text">{t('home.demoLogged')}</span>
        </div>
      </div>
      <figcaption id="home-demo-caption" className="home-demo-caption muted small">
        {t('home.demoCaption')}
      </figcaption>
    </figure>
  );
}

/**
 * The other half of the claim: the numbers are specific, and they are worked
 * out in ordinary code rather than by a language model doing arithmetic.
 *
 * The plate line is the detail that proves it. "2 x 45 per side" is not
 * something a coach says to sound thorough - it is the answer to "what do I
 * actually put on the bar", computed from the plates the athlete said they own.
 */
export function ProgramDemo() {
  const { t } = useI18n();
  const rows = [
    { lift: t('home.demoBench'), sets: 1, reps: 8, weight: '225 lb', plates: t('home.demoPlates1') },
    { lift: t('home.demoBench'), sets: 1, reps: 6, weight: '245 lb', plates: t('home.demoPlates2') },
    { lift: t('home.demoBench'), sets: 1, reps: 5, weight: '275 lb', plates: t('home.demoPlates3') },
  ];
  return (
    <figure className="home-demo" aria-labelledby="home-program-caption">
      <div className="home-demo-screen">
        <h4 className="home-demo-day">{t('home.demoDay')}</h4>
        <div className="program-table-scroll">
          <table className="program-table">
            <thead>
              <tr>
                <th scope="col">{t('program.movement')}</th>
                <th scope="col">{t('program.sets')}</th>
                <th scope="col">{t('program.reps')}</th>
                <th scope="col">{t('program.weight')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.weight}>
                  <th scope="row">{row.lift}</th>
                  <td>{row.sets}</td>
                  <td>{row.reps}</td>
                  <td>
                    {row.weight}
                    <span className="muted small block plate-words">{row.plates}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <figcaption id="home-program-caption" className="home-demo-caption muted small">
        {t('home.demoProgramCaption')}
      </figcaption>
    </figure>
  );
}

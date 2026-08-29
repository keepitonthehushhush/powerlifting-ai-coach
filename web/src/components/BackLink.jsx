import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';

/**
 * A way back that goes where the reader actually came from.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * "When you click on a link on FAQ and then back, it doesn't take you back
 * from where you came from. It takes you to your privacy choices."
 *
 * It did, and it was hard-coded. The health data policy ended with a single
 * link reading "Back to your consent settings", pointing at /consent. That is
 * right for the one route the page was written for - somebody reading the
 * document from the consent screen before agreeing to it - and wrong for every
 * other way in. The FAQ links to that policy three times, the footer links to
 * it, and a search result links to it. All of them arrived at a page whose
 * only exit was somewhere they had never been.
 *
 * ── WHY NOT JUST HARD-CODE A DIFFERENT DESTINATION ────────────────────────
 *
 * Because there isn't one. The same document is reached from the FAQ, the
 * landing page footer, the consent screen and a shared link, and any fixed
 * answer is wrong for three of the four. The reader's own history is the only
 * thing that knows.
 *
 * ── AND WHY A FALLBACK IS STILL NEEDED ────────────────────────────────────
 *
 * `navigate(-1)` on the first page of a session leaves the site entirely -
 * back into a search results page, or into nothing. React Router stamps that
 * first entry with the key `default`, which is how this tells "you came from
 * somewhere in this app" from "you arrived here cold". Deep links, new tabs
 * and shared URLs get a plain link instead of a back button that would throw
 * them out of the product.
 *
 * A button rather than a link, deliberately: it performs an action rather than
 * addressing a document, so it must not offer "open in new tab" on a
 * right-click. `.link` already resets background, border and padding, so it
 * styles a button and an anchor identically.
 */
export function BackLink({ fallback = '/', fallbackLabel }) {
  /*
   * The label and the destination must agree, and they did not.
   *
   * Four policy pages passed `fallback="/faq"` and took the default label,
   * which reads "Back to Coach Diaz" - so somebody arriving cold on the Terms
   * page was offered a control whose words said the front door and whose href
   * said the FAQ. That is precisely the defect this component was written to
   * remove, reintroduced by its own default, and it was caught by loading the
   * page rather than by reading it.
   *
   * The default destination is now the front door, matching the default label.
   * A caller wanting somewhere else has to supply the words for it.
   */
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();

  const arrivedFromInsideTheApp = location.key !== 'default';

  if (!arrivedFromInsideTheApp) {
    return (
      <Link className="link" to={fallback}>
        {fallbackLabel ?? t('common.backHome')}
      </Link>
    );
  }

  return (
    <button type="button" className="link" onClick={() => navigate(-1)}>
      {t('common.back')}
    </button>
  );
}

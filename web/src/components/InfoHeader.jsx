import { Link } from 'react-router-dom';
import { StickyHeader } from './StickyHeader.jsx';
import { SiteNav } from './SiteNav.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';

/**
 * The header for the pages anybody can read: the FAQ, the clinician page, and
 * the four policy documents.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * "FAQ loads into another page that acts or thinks you log out."
 *
 * It did, and the navigation itself was sending people there. `/faq` is one of
 * the destinations in SiteNav, and the FAQ page rendered no navigation at all
 * - checked against the live site, where the page reports zero nav elements.
 * So tapping a tab inside the application dropped the entire shell: no
 * wordmark, no destinations, no sign-out. The page then ends with "Create your
 * account" and "Already have an account? Sign in", which is the correct ending
 * for a stranger and reads as proof of being logged out to somebody who is
 * not.
 *
 * This is the same defect navigation.test.js already describes for Log
 * session, Profile and Your data - "exactly the three that felt like leaving
 * the application: the route change was client-side all along, but the header
 * went with it, so the destination looked like a different site." Those three
 * were fixed. The public pages were not, and they are reachable from the same
 * navigation.
 *
 * ── WHY IT IS CONDITIONAL RATHER THAN ALWAYS-ON ───────────────────────────
 *
 * These pages are public on purpose, and that decision is worth keeping: "the
 * person with the most questions is the one who has not signed up yet, and
 * making them create an account to find out what happens to their data is
 * exactly backwards." A signed-out visitor must not be shown a navigation bar
 * full of destinations that would bounce them to a password field, nor a sign
 * -out button when they are not signed in.
 *
 * So the same page has two headers. Signed in, it is a tab in the application
 * and looks like one. Signed out, it is a document with a way back to the
 * front door, exactly as it was.
 *
 * `version` is separate from `detail` because the policy documents carry a
 * version string rather than a description, and it is styled as one. Two named
 * props beat one prop that changes meaning with its shape.
 */
export function InfoHeader({ title, detail, version }) {
  const { session } = useAuth();
  const { t } = useI18n();

  if (session) {
    return (
      <StickyHeader>
        <header className="page-header">
          <SiteNav />
          <h1 className="page-title">{title}</h1>
          {detail ? <p className="muted header-detail">{detail}</p> : null}
          {version ? <p className="muted small">{version}</p> : null}
        </header>
      </StickyHeader>
    );
  }

  return (
    <header className="page-header">
      {/* A way back to the front door. These pages are the ones most likely to
          be found by a search or a shared link. */}
      <p className="policy-link">
        <Link className="link" to="/">
          {t('common.appName')}
        </Link>
      </p>
      <h1>{title}</h1>
      {detail ? <p className="muted header-detail">{detail}</p> : null}
      {version ? <p className="muted small">{version}</p> : null}
    </header>
  );
}

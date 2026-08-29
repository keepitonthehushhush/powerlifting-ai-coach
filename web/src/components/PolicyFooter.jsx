import { Link } from 'react-router-dom';
import { BackLink } from './BackLink.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';

/**
 * How a policy document ends.
 *
 * ── WHAT WAS THERE BEFORE ─────────────────────────────────────────────────
 *
 * Five pages, five different hard-coded exits, and no two agreed:
 *
 *   Terms                 "Back"                        -> /consent
 *   AI processing         "Back"                        -> /consent
 *   Health data           "Back to your consent settings" -> /consent
 *   Leaderboard           "Back to the FAQ"             -> /faq
 *   For your clinician    "Back to Coach Diaz"          -> /login
 *
 * The first two are the ones worth staring at. A control labelled "Back" that
 * goes somewhere the reader has never been is not a mislabel, it is a lie
 * about what the button does - and it is exactly what was reported: "when you
 * click on a link on FAQ and then back, it takes you to your privacy
 * choices."
 *
 * The last one is worse in a quieter way: a signed-in reader who followed a
 * link to the clinician page was offered a route to the SIGN-IN screen.
 *
 * ── WHAT REPLACES THEM ────────────────────────────────────────────────────
 *
 * One ending, in one place. Back means back - the reader's own history, which
 * is the only thing that knows where they came from - with a fallback for
 * anybody who arrived cold from a search result or a shared link.
 *
 * And the consent settings are still offered, because they were genuinely
 * useful for the one route the old link was written for: somebody reading a
 * policy from the consent screen in order to decide. It is now an ADDITIONAL
 * destination with an honest label rather than the only exit wearing the word
 * "Back" - which is what was asked for: "can we give the users the option to
 * go back and go to privacy choices to edit their choices?"
 *
 * It appears only when there is a session. /consent is behind ProtectedRoute,
 * so offering it to a signed-out reader would bounce them to a password field
 * - the same trap the clinician page's "Back to Coach Diaz" fell into.
 */
export function PolicyFooter({ fallback = '/', offerConsentSettings = true }) {
  const { session } = useAuth();
  const { t } = useI18n();

  return (
    <div className="row gap policy-footer">
      <BackLink fallback={fallback} />
      {session && offerConsentSettings ? (
        <Link className="link" to="/consent">
          {t('common.editPrivacyChoices')}
        </Link>
      ) : null}
    </div>
  );
}

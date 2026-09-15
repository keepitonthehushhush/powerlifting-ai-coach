import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { InfoHeader } from '../components/InfoHeader.jsx';

/**
 * The page for a URL that does not exist.
 *
 * ── WHAT WAS THERE, AND WHY IT WAS A TRAPDOOR ─────────────────────────────
 *
 * `<Route path="*" element={<Navigate to="/coach" replace />} />`. Every
 * unknown address redirected to the chat, which sits behind ProtectedRoute,
 * which bounces a signed-out visitor to `/login`.
 *
 * Measured on the built app, signed out, with the network cut off:
 *
 *   asked for /this-page-does-not-exist   landed /login
 *   asked for /policies/pricing           landed /login
 *   asked for /program                    landed /login
 *
 * All three produced BYTE-IDENTICAL screens. A page that does not exist and a
 * real page you need an account for were indistinguishable, and the person
 * seeing that is the one with the least context - somebody who followed a
 * stale link, mistyped an address, or opened an old bookmark. They asked for a
 * page and got a password field, with nothing anywhere saying why.
 *
 * That is the same defect this codebase already has two entries for: a
 * navigation destination that renders no navigation, and a "Back" button that
 * did not go back. A URL that silently becomes a different URL is a lie about
 * what happened.
 *
 * ── WHAT NN/g ASKS OF AN ERROR MESSAGE ────────────────────────────────────
 *
 * Their 404 guidance is three properties, and this page is built to each one:
 *
 *   PLAIN      "written in plain language that is easy to understand for
 *              non-technical users and that does not imply that the mistake is
 *              the user's fault" - so: "we could not find", never "you typed
 *              it wrong", and no status code in the headline.
 *
 *   PRECISE    "precise in specifying exactly what was done wrong (that is,
 *              not be generic or vague)" - so the page NAMES THE PATH that was
 *              asked for. Seeing `/policies/pricing` is what tells somebody
 *              whether they mistyped it or whether the link is simply old.
 *
 *   CONSTRUCTIVE  "constructive in suggesting steps the user can take to
 *              correct the problem" - two real destinations, chosen by whether
 *              there is a session, not a single generic "go home".
 *
 * ── THE PATH IS RENDERED. THE QUERY AND THE HASH ARE NOT. ─────────────────
 *
 * This is the part that matters more than the layout.
 *
 * Supabase puts the recovery token in the URL FRAGMENT on a password-reset
 * link (`#access_token=...`). A malformed or expired one of those can land
 * here, and a page that echoed `location.href` would print a live credential
 * on screen - over somebody's shoulder, into a screenshot, into a support
 * ticket. The query string is no better: it is where `?checkout=` and any
 * future token would live.
 *
 * So only `pathname` is read, and it is truncated. React escapes the value, so
 * there is no injection here; the risk is disclosure, and the fix is not
 * reading the fields that can hold a secret. notFound.test.js asserts the
 * absence of `location.hash` and `location.search` in this file, in both
 * directions, because an absence is the kind of property that gets
 * accidentally undone.
 */

/** Long enough to recognize a path, short enough that it cannot wreck a line. */
export const MAX_PATH = 60;

export function NotFound() {
  const { session } = useAuth();
  const { t } = useI18n();

  /*
   * `location` from the DOM rather than `useLocation()`, deliberately: this
   * renders under the catch-all, so the router's pathname is the same string,
   * and reading the one the browser holds means the page is honest even if it
   * is ever rendered outside a Route.
   */
  const asked = typeof window === 'undefined' ? '' : window.location.pathname;
  const shown = asked.length > MAX_PATH ? `${asked.slice(0, MAX_PATH)}…` : asked;

  return (
    <div className="page">
      <InfoHeader title={t('notFound.title')} detail={t('notFound.detail')} />

      <div className="card">
        <p className="muted">{t('notFound.asked')}</p>
        {/* The path, as asked for. React escapes it and MAX_PATH caps it, and
            it is drawn as code because that is what it is - seeing it set in
            mono is half of what tells somebody it was a typo. */}
        <p className="not-found-path"><code>{shown}</code></p>

        {/*
          `.cta` and `.link` rather than two new class names: the pill is
          already the product's primary action, already 44px tall, and already
          swept in twenty palettes. A fourth button style invented for one page
          is how a design system stops being one.
        */}
        <div className="not-found-ways">
          {session ? (
            <Link className="cta" to="/coach">{t('notFound.toCoach')}</Link>
          ) : (
            <>
              <Link className="cta" to="/">{t('notFound.toHome')}</Link>
              <Link className="link" to="/login">{t('notFound.toLogin')}</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

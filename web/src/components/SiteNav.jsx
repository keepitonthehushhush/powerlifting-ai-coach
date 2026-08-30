import { NavLink, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { LanguageSwitcher } from './LanguageSwitcher.jsx';
import { Wordmark } from './Logo.jsx';
import { useMarkTaps } from './EasterEggs.jsx';

/**
 * One navigation bar, used by every signed-in page.
 *
 * ── WHAT WAS WRONG ────────────────────────────────────────────────────────
 *
 * Only the coach page had navigation at all; the others carried an ad-hoc
 * "Back to Coach" link, so moving between logging, progress and the library
 * meant going via the conversation. And the links it did have were a flat row
 * of equally-weighted underlined text in the order they happened to be added -
 * the language selector first, destinations and account actions mixed
 * together - which is what "they do not look like they are in the proper
 * order" is describing.
 *
 * ── THE ORDER, AND WHY ────────────────────────────────────────────────────
 *
 * Two groups, not one list. PLACES the athlete goes, in the order of the
 * training loop they already live in - talk to the coach, log what you lifted,
 * see what it did, look up how to do it - and then, pushed to the far side and
 * set in quieter ink, the things you touch rarely: your profile, your data,
 * language, and signing out. Frequency of use is the only ordering principle
 * that survives contact with a real user.
 *
 * ── THE RESTRAINT ─────────────────────────────────────────────────────────
 *
 * No underlines, no borders, no chrome. Weight and ink carry the hierarchy:
 * the current page is full-strength text with a short bar beneath it, the rest
 * are muted until hovered. The bar is 2px and inherits the accent, so the
 * scheme is present without being loud. This is the whole trick of the
 * minimal-professional look people ask for - not fewer features, but a single
 * accent doing one job while everything else recedes.
 *
 * Underline-on-hover returns for pointer users because a nav item that only
 * changes color is a poor affordance, and the focus ring is never removed.
 */

/**
 * Every destination in one list, ordered by how often it is used.
 *
 * Profile and Your data live here rather than in a separate right-hand group,
 * which is where they started. Two reasons. They are PAGES, and a group that
 * mixes pages with actions has no honest ordering principle. And on a 430px
 * screen the right-hand group grew long enough to push Sign out off the edge -
 * found by rendering it at that width, not by assuming. They keep the quieter
 * styling, so the hierarchy survives inside a single row.
 */
const PLACES = [
  { to: '/coach', key: 'nav.coach' },
  { to: '/program', key: 'nav.program' },
  { to: '/log', key: 'nav.log' },
  { to: '/progress', key: 'nav.progress' },
  { to: '/library', key: 'nav.library' },
  { to: '/intake', key: 'nav.profile', quiet: true },
  { to: '/leaderboard', key: 'nav.leaderboard' },
  { to: '/account', key: 'nav.data', quiet: true },
  { to: '/faq', key: 'nav.faq', quiet: true },
];

export function SiteNav({ children }) {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const location = useLocation();
  const countTap = useMarkTaps();

  return (
    <div className="site-nav">
      {/* The mark is still an ordinary link home. Tapping it repeatedly is the
          only thing that does anything unusual, and five taps inside a second
          cannot happen by accident. */}
      <NavLink
        to="/coach"
        className="wordmark-link"
        aria-label={t('common.appName')}
        onClick={() => countTap()}
      >
        <Wordmark name={t('common.appName')} />
      </NavLink>

      {/* Two elements, not one, and the outer one is the reason.
          `.nav-row` is a one-row grid whose track animates between 1fr and
          0fr. That is the only way to transition an element to its own
          content height without inventing a max-height larger than the
          content - a magic number that is wrong on every screen but the one
          it was measured on, and that spends part of the duration doing
          nothing visible. The inner element keeps the sideways scroll: a nav
          bar that grows to three lines pushes the content off a phone
          entirely. */}
      <div className="nav-row">
        <nav className="nav-places" aria-label={t('nav.primary')}>
          {PLACES.map(({ to, key, quiet }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [ 'nav-item', quiet ? 'quiet' : '', isActive ? 'active' : '' ].filter(Boolean).join(' ')
              }
              aria-current={location.pathname === to ? 'page' : undefined}
            >
              {t(key)}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Only genuine system controls remain on this side. */}
      <div className="nav-account">
        {children}
        <LanguageSwitcher />
        <button type="button" className="nav-item quiet" onClick={signOut}>
          {t('common.signOut')}
        </button>
      </div>
    </div>
  );
}

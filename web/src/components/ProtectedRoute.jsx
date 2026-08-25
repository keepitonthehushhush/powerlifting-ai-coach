import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useConsent } from '../context/ConsentContext.jsx';
import { useI18n } from '../i18n/index.jsx';

/**
 * Two gates, in order: is there a session, and has this person agreed to the
 * terms the product cannot operate without.
 *
 * The consent gate defaults to ON so that a route added later inherits it -
 * the same reasoning as mounting requireAuth on the whole /api surface rather
 * than route by route. Forgetting is the easy mistake; this makes forgetting
 * the safe outcome.
 *
 * `requireConsent={false}` is for the three places that must stay reachable
 * without it:
 *   - /consent itself, or the redirect is a loop;
 *   - /account, because MHMDA requires withdrawal to be no harder than
 *     granting, and a person must always be able to delete their account -
 *     gating either behind consent would be exactly backwards;
 *   - the public policy page, which is not behind auth at all.
 */
export function ProtectedRoute({ children, requireConsent = true }) {
  const { session, loading } = useAuth();
  const { status, gate } = useConsent();
  const { t } = useI18n();

  if (loading) return <div className="centered muted">{t('common.loading')}</div>;
  if (!session) return <Navigate to="/login" replace />;

  if (requireConsent) {
    // Waiting is not the same as refused. Redirecting while the answer is
    // still in flight would bounce every returning user through the consent
    // screen on every cold load.
    //
    // But this only blocks on the FIRST load. A revalidation keeps the current
    // page mounted, because replacing it unmounts everything below - and an
    // unmounted form loses every character in it. That is not hypothetical: it
    // is what this route did to the intake form every time somebody switched
    // apps and came back, since Supabase refreshes its token on tab focus.
    //
    // The safety property is unchanged. A revalidation can only run for a
    // person already past the gate, and if it comes back withholding consent
    // the next render redirects them.
    if (status === 'idle' || status === 'loading') {
      return <div className="centered muted">{t('common.loading')}</div>;
    }
    if (!gate.allowed && status !== 'refreshing') return <Navigate to="/consent" replace />;
  }

  return children;
}

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useConsent } from '../context/ConsentContext.jsx';
import { ConsentUnavailable } from './ConsentUnavailable.jsx';
import { Loading } from './Loading.jsx';
import { useMfa } from '../context/MfaContext.jsx';
import { MfaChallenge } from './MfaChallenge.jsx';

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
  const location = useLocation();
  const { status, gate, refresh } = useConsent();
  const mfa = useMfa();

  if (loading) return <div className="centered"><Loading /></div>;
  if (!session) return <Navigate to="/login" replace />;

  /*
   * ── THE SECOND FACTOR, BEFORE ANYTHING ELSE IS RENDERED ───────────────
   *
   * Rendered in place rather than redirected to a route. Supabase's guidance
   * is to send somebody to a screen where they can finish rather than to a
   * 401 page, and rendering here is that without a route that can be linked
   * to, bookmarked, or entered while already verified.
   *
   * It sits ABOVE the consent gate on purpose. Consent is a question about
   * what somebody agrees to; this is a question about whether they are the
   * person whose consent it would be. Asking the second one first is the only
   * order that makes sense, and the order is the property - see the same
   * argument about the adult gate running before the paywall.
   *
   * `satisfied` is false while the answer is loading and false for any level
   * pair Supabase might add later. Somebody who never enrolled is
   * `notEnrolled`, which IS satisfied - that is a definite answer, not an
   * unknown, and it is the case that must never block.
   */
  if (!mfa.checked) return <div className="centered"><Loading /></div>;
  if (!mfa.satisfied) return <MfaChallenge />;

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
      return <div className="centered"><Loading /></div>;
    }

    /*
     * COULD NOT READ IS NOT DID NOT AGREE, and sending both to /consent made
     * the first one look like the second. A failed read leaves the gate
     * `reason: 'unknown'`, which redirected an athlete who HAD agreed to a
     * screen headed "before we start" - whose panel reloads the same failing
     * endpoint, and whose Continue button stays disabled until it succeeds.
     * A dead end, reached by doing nothing wrong, explaining nothing. One
     * athlete hit exactly that on 2026-09-02 and has not returned.
     *
     * Rendered in place rather than routed to, for the same reason the MFA
     * challenge is: there is no state here worth a URL. And it still admits
     * nobody - failing closed was never the bug.
     */
    if (status === 'error') return <ConsentUnavailable onRetry={refresh} />;

    /*
     * ── WHERE THEY WERE GOING TRAVELS WITH THEM ───────────────────────────
     *
     * It did not, and the cost was paid by every athlete who signed up before
     * a policy version changed. The redirect dropped the destination and
     * /consent sent everybody to /intake afterwards, so a person who opened
     * the app to talk to their coach, was stopped for a re-consent they did
     * not know was coming, and agreed - was handed the intake form they
     * filled in weeks ago.
     *
     * There is no way to read that as anything but "it lost my account".
     *
     * On 2026-09-09 the AI-processing policy changed, which made the stored
     * consent of every account that existed superseded. Six of the seven were
     * still holding one when this was found.
     */
    if (!gate.allowed && status !== 'refreshing') {
      return <Navigate to="/consent" replace state={{ from: location.pathname + location.search }} />;
    }
  }

  return children;
}

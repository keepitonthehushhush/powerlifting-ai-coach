import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * Subscription state, and the three things a person can do about it.
 *
 * ── THE RACE THIS EXISTS TO HANDLE ────────────────────────────────────────
 *
 * Stripe redirects back to /account?checkout=success the moment the payment
 * succeeds. The subscription row is written by the WEBHOOK, which is a
 * separate HTTP request from Stripe to our server, and it routinely arrives a
 * second or two later. So the most likely first render after a successful
 * payment is one where the database still says "not subscribed".
 *
 * Rendering "Subscribe" to somebody who just paid is the worst version of
 * this screen. They will either think it failed and pay again, or email. So a
 * `checkout=success` return puts the panel into a settling state that says the
 * subscription is being set up, and polls until the webhook lands.
 *
 * It gives up after a bounded number of attempts rather than spinning forever,
 * and what it says when it gives up is that the payment went through and the
 * account has not caught up yet - which is true, and is the honest thing to
 * put in front of somebody whose card has been charged.
 */

/** Poll roughly every 2s for ~20s. Long enough for a webhook, short enough to end. */
const SETTLE_ATTEMPTS = 10;
const SETTLE_INTERVAL_MS = 2000;

/**
 * `?checkout=success` or `?checkout=canceled`, and nothing else.
 *
 * ── WHY BOTH SPELLINGS ARE ACCEPTED ───────────────────────────────────────
 *
 * The value used to be the British "canceled", which put it in the address
 * bar of an American product. Stripe's own field is `canceled`, so the app was
 * the odd one out.
 *
 * It cannot simply be renamed, though: the value in the URL is whatever
 * `cancel_url` said at the moment the checkout session was CREATED, and a
 * session created before this deploy is still open in somebody's tab. Reading
 * only the new spelling would show them a blank panel instead of "no payment
 * was taken". So both are read, one is written, and the old spelling can be
 * dropped once no session that old can still return - Stripe sessions expire
 * after 24 hours.
 */
function readCheckoutParam() {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('checkout');
  if (value === 'success') return 'success';
  if (value === 'canceled' || value === 'cancelled') return 'canceled';
  return null;
}

/**
 * Take the query parameter out of the address bar once it has been read.
 *
 * Otherwise a refresh re-triggers the settling poll, and - worse - the "your
 * subscription is active" confirmation reappears weeks later when somebody
 * opens a bookmarked URL.
 */
function clearCheckoutParam() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('checkout');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

export function BillingPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  /**
   * Read once, at mount, and never written again - which is why there is no
   * setter. The query parameter is stripped from the URL as soon as it has
   * been read (a refresh must not replay the poll, and a bookmark must not
   * show a payment confirmation weeks later), so this state is the only
   * remaining record that the person arrived here from checkout. Losing it
   * would swap the "your payment went through" panel for a subscribe button
   * one render after they paid.
   */
  const [returned] = useState(() => readCheckoutParam());
  const [settling, setSettling] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const load = useCallback(async () => {
    try {
      const next = await api.getBillingStatus();
      if (!cancelled.current && next) setStatus(next);
      return next;
    } catch (err) {
      if (!cancelled.current) setError(err.message);
      return null;
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The settling poll. Only ever runs on a success return, and only until the
  // subscription appears or the attempts run out.
  useEffect(() => {
    if (returned !== 'success') return undefined;
    let attempts = 0;
    let timer = null;
    setSettling(true);

    const tick = async () => {
      const next = await load();
      attempts += 1;
      if (cancelled.current) return;
      if (next?.entitled || attempts >= SETTLE_ATTEMPTS) {
        setSettling(false);
        return;
      }
      timer = setTimeout(tick, SETTLE_INTERVAL_MS);
    };

    timer = setTimeout(tick, SETTLE_INTERVAL_MS);
    clearCheckoutParam();
    return () => { if (timer) clearTimeout(timer); };
  }, [returned, load]);

  useEffect(() => {
    if (returned === 'canceled') clearCheckoutParam();
  }, [returned]);

  async function go(action, call) {
    setBusy(action);
    setError(null);
    try {
      const { url } = await call();
      if (!url) throw new Error(t('billing.noRedirect'));
      // A full navigation, not a router push: the destination is Stripe.
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <section className="card stack">
        <h2 className="h3">{t('billing.title')}</h2>
        <p className="muted small">{t('common.working')}</p>
      </section>
    );
  }

  /**
   * Billing switched off entirely: render nothing.
   *
   * Not an empty card, not "subscriptions coming soon". A deployment without
   * Stripe is the free product, and the free product should not carry the
   * outline of a paywall.
   */
  if (!status?.configured) return null;

  const { paywallActive, entitled, reason, currentPeriodEnd, cancelAtPeriodEnd } = status;
  const hasSubscription = Boolean(status.status);

  /**
   * Configured, paywall off, and they have never subscribed: also nothing.
   *
   * This is the state the product ships in. Offering to sell a subscription
   * for something currently free would be a worse lie than silence - and
   * somebody who DOES hold a subscription still sees the panel below, because
   * cancel-anytime is a promise and it needs a button.
   */
  if (!paywallActive && !hasSubscription) return null;

  /**
   * Somebody promised free access before the paywall existed. No subscribe
   * button: offering to sell them something they already have for nothing
   * reads as an upsell to a person you made a promise to.
   */
  if (reason === 'promised_free') {
    return (
      <section className="card stack">
        <h2 className="h3">{t('billing.title')}</h2>
        <p className="muted small">{t('billing.promisedFree')}</p>
        {hasSubscription && (
          <>
            <div className="row-actions">
              <button
                type="button"
                onClick={() => go('portal', api.openBillingPortal)}
                disabled={busy === 'portal'}
              >
                {busy === 'portal' ? t('common.working') : t('billing.manage')}
              </button>
            </div>
            <p className="muted small">{t('billing.promisedFreeSubscribed')}</p>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  const renewsOn = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  return (
    <section className="card stack">
      <h2 className="h3">{t('billing.title')}</h2>

      {returned === 'canceled' && <p className="muted small">{t('billing.checkoutCancelled')}</p>}

      {settling && <p className="muted small">{t('billing.settling')}</p>}

      {!settling && returned === 'success' && !entitled && (
        // The bounded give-up. Their card was charged; say so plainly rather
        // than showing a subscribe button to somebody who just subscribed.
        <p className="notice">{t('billing.settlingSlow')}</p>
      )}

      {reason === 'payment_failing' && (
        // A banner, not a locked door. See lib/entitlement.js: past_due means
        // a renewal charge failed and Stripe is still retrying, and cutting
        // somebody's coaching off for a bank's decision is a punishment.
        <p className="notice">{t('billing.paymentFailing')}</p>
      )}

      {entitled && reason !== 'payment_failing' && (
        <p className="muted small">
          {cancelAtPeriodEnd || reason === 'grace'
            ? t('billing.endsOn', { date: renewsOn ?? '—' })
            : t('billing.renewsOn', { date: renewsOn ?? '—' })}
        </p>
      )}

      {!entitled && !settling && returned !== 'success' && (
        <>
          <p className="muted small">
            {reason === 'lapsed' ? t('billing.lapsedBody') : t('billing.offerBody')}
          </p>
          <p className="muted small">{t('billing.staysFree')}</p>
        </>
      )}

      <div className="row-actions">
        {!entitled && !settling && (
          <button
            type="button"
            className="primary"
            onClick={() => go('checkout', api.startCheckout)}
            disabled={busy === 'checkout'}
          >
            {busy === 'checkout'
              ? t('common.working')
              : reason === 'lapsed'
                ? t('billing.resubscribe')
                : t('billing.subscribe')}
          </button>
        )}

        {hasSubscription && (
          <button
            type="button"
            onClick={() => go('portal', api.openBillingPortal)}
            disabled={busy === 'portal'}
          >
            {busy === 'portal' ? t('common.working') : t('billing.manage')}
          </button>
        )}
      </div>

      {/* Said on the page, not only in the FAQ. A cancel-anytime promise that
          lives one click away from the cancel button is the one people
          believe. */}
      {hasSubscription && <p className="muted small">{t('billing.cancelAnytime')}</p>}

      {error && <p className="error">{error}</p>}
    </section>
  );
}

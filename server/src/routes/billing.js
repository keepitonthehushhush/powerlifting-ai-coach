import { Router } from 'express';
import { config } from '../config.js';
import { stripeClient, billingUnavailableReason } from '../lib/stripe.js';
import { entitlement } from '../lib/entitlement.js';
import { loadSubscription } from '../lib/subscriptions.js';
import { HttpError } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';

export const billingRouter = Router();

/**
 * Subscription management. Three authenticated endpoints and one that is
 * deliberately not authenticated at all - see routes/billingWebhook.js.
 *
 * ── NO CARD DETAILS EVER TOUCH THIS SERVER ────────────────────────────────
 *
 * Checkout and the billing portal are both Stripe-hosted pages. We create a
 * session, redirect, and Stripe collects the card on its own domain. That is
 * not laziness: it means a compromise of this application cannot expose a card
 * number, because a card number is never here to expose. It also keeps PCI
 * scope at the smallest possible level rather than the largest.
 *
 * ── CANCELLATION IS THE PORTAL, AND THAT IS THE POINT ─────────────────────
 *
 * The FAQ promises cancelling is possible at any time, from inside the
 * account, without emailing anybody or explaining yourself. Stripe's billing
 * portal does exactly that in one click, and it is the same page whether
 * somebody is cancelling, updating a card, or downloading an invoice.
 *
 * A hand-rolled cancel button would let us put a "are you sure?" flow in front
 * of it, which is precisely what ROSCA calls a functional impediment and what
 * the FAQ promised not to do. Using the portal is the cheaper implementation
 * AND the one that keeps the promise, which is a rare alignment worth taking.
 */

/** Reads the caller's mirrored subscription row, or null. */


/**
 * GET /api/billing/status
 *
 * What the frontend needs to decide what to show. Deliberately returns a
 * shape that is meaningful even when billing is switched off entirely, so the
 * free product does not have to special-case its own existence.
 */
billingRouter.get('/status', async (req, res, next) => {
  try {
    const configured = !billingUnavailableReason();
    const subscription = configured ? await loadSubscription(req.supabase) : null;
    const decision = entitlement(subscription);

    res.json({
      configured,
      /**
       * Whether a subscription is actually REQUIRED right now, which is not
       * the same as billing being configured (ADR-13). Without this the
       * account page would offer to sell a subscription for something that is
       * currently free, which is a worse lie than saying nothing.
       */
      paywallActive: config.paywall.active,
      entitled: decision.entitled,
      reason: decision.reason,
      // Enough for the UI to say something specific, and no more. No customer
      // id, no price id - the frontend has no use for either and they are
      // Stripe's identifiers, not the athlete's business.
      status: subscription?.status ?? null,
      currentPeriodEnd: subscription?.current_period_end ?? null,
      cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe-hosted Checkout session and returns its URL.
 */
billingRouter.post('/checkout', async (req, res, next) => {
  try {
    const unavailable = billingUnavailableReason();
    if (unavailable) throw new HttpError(503, 'Subscriptions are not available yet.', { code: unavailable });

    const stripe = await stripeClient();
    const existing = await loadSubscription(req.supabase);

    // Somebody who is already paying must not be able to buy a second
    // subscription by pressing the button twice or opening two tabs. Stripe
    // would happily create it and then charge them for both.
    if (entitlement(existing).entitled) {
      throw new HttpError(409, 'You already have an active subscription.', { code: 'already_subscribed' });
    }

    const origin = req.get('origin') || config.stripe.portalReturnUrl || '';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: config.stripe.priceId, quantity: 1 }],

      // Reuse the customer if this person has subscribed before, so their
      // billing history stays in one place instead of fragmenting across a
      // new customer per attempt.
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: req.user.email }),

      // THE LINK BACK TO OUR USER. The webhook arrives with Stripe's ids and
      // nothing else; without this there is no way to know whose subscription
      // it is. Set on the subscription too, because the checkout session is
      // not attached to the events that arrive months later at renewal.
      client_reference_id: req.user.id,
      subscription_data: { metadata: { user_id: req.user.id } },

      success_url: `${origin}/account?checkout=success`,
      cancel_url: `${origin}/account?checkout=cancelled`,

      // Stated before the card is collected, which is what ROSCA requires of
      // a recurring charge: the terms, and that it renews until cancelled.
      custom_text: {
        submit: {
          message:
            'This renews every month at $9.99 until you cancel. You can cancel any time from your account page, and you keep access until the end of the period you have paid for.',
        },
      },
    });

    logger.info('billing.checkout_created', { userId: req.user.id, sessionId: session.id });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/portal
 *
 * The one-click route to cancelling, updating a card, or getting an invoice.
 */
billingRouter.post('/portal', async (req, res, next) => {
  try {
    const unavailable = billingUnavailableReason();
    if (unavailable) throw new HttpError(503, 'Subscriptions are not available yet.', { code: unavailable });

    const subscription = await loadSubscription(req.supabase);
    if (!subscription?.stripe_customer_id) {
      throw new HttpError(404, 'There is no subscription on this account yet.', { code: 'no_customer' });
    }

    const stripe = await stripeClient();
    const origin = req.get('origin') || config.stripe.portalReturnUrl || '';
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${origin}/account`,
    });

    logger.info('billing.portal_opened', { userId: req.user.id });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

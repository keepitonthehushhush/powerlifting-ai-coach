import { Router } from 'express';
import express from 'express';
import { config } from '../config.js';
import { stripeClient } from '../lib/stripe.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { logger } from '../lib/logger.js';

export const billingWebhookRouter = Router();

/**
 * Stripe's side of the conversation.
 *
 * ── THIS ROUTE IS UNAUTHENTICATED, AND THAT IS CORRECT ────────────────────
 *
 * Stripe is not logged in and never will be. It carries no JWT. Everything
 * else under /api sits behind requireAuth precisely so that forgetting is the
 * safe outcome, so this one is mounted BEFORE that middleware, deliberately
 * and visibly, rather than by punching a hole in the guard.
 *
 * What replaces authentication is the signature: Stripe computes an HMAC over
 * the exact bytes of the body using a secret only Stripe and we hold. An
 * attacker who cannot forge that gets a 400 and reaches nothing.
 *
 * ── WHICH MEANS THE RAW BODY IS LOAD-BEARING ──────────────────────────────
 *
 * The signature is over BYTES. app.js parses JSON for the whole application,
 * and a parsed-then-restringified body is not the same bytes - key order and
 * whitespace both move. So this route mounts express.raw() for itself and is
 * registered before the global JSON parser. Get this wrong and every webhook
 * fails signature verification with an error that looks like a wrong secret,
 * which is a genuinely miserable afternoon.
 *
 * ── AND WHY IT ALWAYS ANSWERS 200 ─────────────────────────────────────────
 *
 * Once the signature has verified, the event is genuine and we have it. If our
 * own processing then fails, returning 500 makes Stripe retry the same event
 * for up to three days - which does not fix a bug in our code and does bury
 * the real error under a thousand identical ones. So: verify strictly, then
 * accept, log loudly, and move on. The only 4xx here is a signature failure,
 * which is the one case where telling Stripe "no" is the right answer.
 */

/** The events that change what somebody is entitled to. */
const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

/**
 * Finds our user id for a Stripe subscription.
 *
 * Checkout puts it in client_reference_id, and we also stamp it into the
 * subscription's metadata at creation - because the renewal events that arrive
 * months later have no memory of the checkout session that started it all.
 */
function userIdFrom(object) {
  return object?.metadata?.user_id ?? object?.client_reference_id ?? null;
}

billingWebhookRouter.post(
  '/',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    if (!config.stripe.enabled) {
      // Not an error worth alarming about: a deployment without billing
      // configured has no business processing billing events.
      return res.status(503).json({ received: false, reason: 'billing_not_configured' });
    }

    const stripe = await stripeClient();
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.get('stripe-signature'),
        config.stripe.webhookSecret
      );
    } catch (err) {
      // The one case where a 4xx is right. Never log the body or the
      // signature - a failed verification is exactly when somebody might be
      // probing, and echoing their payload into our logs helps only them.
      logger.warn('billing.webhook_signature_failed', { message: err.message });
      return res.status(400).json({ received: false });
    }

    try {
      const admin = await supabaseAdmin();
      if (!admin) {
        // Visible in a log rather than a 500 loop that makes Stripe retry for
        // three days over a missing environment variable.
        logger.error('billing.webhook_no_admin_client', { eventId: event.id, type: event.type });
        return res.json({ received: true, recorded: false });
      }

      // IDEMPOTENCY. Stripe guarantees at-least-once delivery and retries on
      // any non-2xx, so the same event genuinely does arrive twice. The insert
      // fails on the primary key the second time, which is the guarantee - a
      // code path that remembers would not be one.
      const { error: seen } = await admin
        .from('stripe_events')
        .insert({ id: event.id, type: event.type });
      if (seen) {
        logger.info('billing.webhook_replayed', { eventId: event.id, type: event.type });
        return res.json({ received: true, duplicate: true });
      }

      if (HANDLED.has(event.type)) await apply(admin, stripe, event);
      else logger.info('billing.webhook_ignored', { eventId: event.id, type: event.type });

      res.json({ received: true });
    } catch (err) {
      // Accepted, logged, not retried. See the note above.
      logger.error('billing.webhook_processing_failed', {
        eventId: event.id,
        type: event.type,
        message: err.message,
      });
      res.json({ received: true, processed: false });
    }
  }
);

/** Writes the mirror. The only place in the application that does. */
async function apply(admin, stripe, event) {
  const object = event.data.object;

  // A completed checkout carries the session, not the subscription, so the
  // subscription is fetched to get the status and period end in one write
  // rather than waiting for the customer.subscription.created that follows.
  const subscription =
    event.type === 'checkout.session.completed'
      ? object.subscription
        ? await stripe.subscriptions.retrieve(object.subscription)
        : null
      : object;

  if (!subscription) {
    logger.warn('billing.webhook_no_subscription', { eventId: event.id, type: event.type });
    return;
  }

  const userId = userIdFrom(subscription) ?? userIdFrom(object);
  if (!userId) {
    // Without this we cannot tell whose subscription it is. Loud, because it
    // means somebody has paid and is not getting what they paid for.
    logger.error('billing.webhook_unattributable', {
      eventId: event.id,
      type: event.type,
      subscriptionId: subscription.id,
    });
    return;
  }

  const item = subscription.items?.data?.[0];
  const row = {
    user_id: userId,
    stripe_customer_id:
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
    stripe_subscription_id: subscription.id,
    stripe_product_id:
      typeof item?.price?.product === 'string' ? item.price.product : item?.price?.product?.id ?? null,
    stripe_price_id: item?.price?.id ?? null,
    status: subscription.status,
    current_period_end: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from('subscriptions').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(`subscription upsert failed: ${error.message}`);

  /**
   * The service-role write, recorded. ADR-12 documents the exception; this
   * makes it OBSERVABLE - every use of the elevated client leaves a row the
   * subscriber can read, so the one place RLS is bypassed is also the one
   * place with an independent record of what it did.
   *
   * actor 'stripe', because there is no user in this request. Never fails the
   * webhook: a non-2xx would make Stripe retry for days over a bookkeeping
   * write.
   */
  const { error: auditError } = await admin.from('audit_events').insert({
    user_id: userId,
    action: 'subscription_changed',
    actor: 'stripe',
    detail: { event_id: event.id, type: event.type, status: row.status },
  });
  if (auditError) logger.error('audit.write_failed', { action: 'subscription_changed', code: auditError.code });

  logger.info('billing.subscription_recorded', {
    userId,
    type: event.type,
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  });
}

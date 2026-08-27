import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';

const app = readSource(new URL('../src/app.js', import.meta.url));
const appRaw = readRaw(new URL('../src/app.js', import.meta.url));
const webhook = readSource(new URL('../src/routes/billingWebhook.js', import.meta.url));
const webhookRaw = readRaw(new URL('../src/routes/billingWebhook.js', import.meta.url));
const billing = readSource(new URL('../src/routes/billing.js', import.meta.url));
const billingRaw = readRaw(new URL('../src/routes/billing.js', import.meta.url));
const adminRaw = readRaw(new URL('../src/lib/supabaseAdmin.js', import.meta.url));
const stripeLib = readSource(new URL('../src/lib/stripe.js', import.meta.url));

describe('THE TWO ORDERING FACTS THAT BREAK EVERYTHING WHEN WRONG', () => {
  test('the webhook mounts BEFORE express.json', () => {
    // Stripe signs the exact BYTES of the body. A parsed-then-restringified
    // body is not the same bytes, so verification fails with an error that
    // looks exactly like a wrong secret - a genuinely miserable afternoon.
    const mount = app.indexOf("app.use('/api/billing/webhook'");
    const parser = app.indexOf('express.json(');
    assert.ok(mount > 0 && parser > 0);
    assert.ok(mount < parser, 'the JSON parser runs before the webhook and will break the signature');
    assert.match(webhook, /express\.raw\(\{ type: 'application\/json'/);
  });

  test('the webhook mounts BEFORE requireAuth, visibly', () => {
    // Stripe carries no JWT. Mounting above the guard keeps the guard's
    // property - everything under /api is authenticated unless it is
    // explicitly, visibly above this line - rather than punching a hole in it.
    const mount = app.indexOf("app.use('/api/billing/webhook'");
    const auth = app.indexOf("app.use('/api', requireAuth)");
    assert.ok(mount < auth, 'the webhook is behind requireAuth and Stripe cannot authenticate');
    assert.match(appRaw, phrase('Stripe is not logged in and never will be'));
  });

  test('the authenticated billing routes are NOT above the guard', () => {
    // Only the webhook gets the exception. Checkout and portal act on behalf
    // of a specific person and must know who.
    const auth = app.indexOf("app.use('/api', requireAuth)");
    assert.ok(app.indexOf("app.use('/api/billing', rateLimit") > auth);
  });
});

describe('the webhook', () => {
  test('a bad signature is the one case that gets a 4xx', () => {
    assert.match(webhook, /constructEvent\(/);
    assert.match(webhook, /return res\.status\(400\)\.json\(\{ received: false \}\)/);
  });

  test('AND EVERYTHING ELSE GETS A 200', () => {
    // Once the signature verifies the event is genuine. Returning 500 on our
    // own bug makes Stripe retry the same event for three days, which does not
    // fix the bug and buries the real error under a thousand copies.
    assert.match(webhookRaw, phrase('verify strictly, then'));
    const handler = webhook.slice(webhook.indexOf('try {'));
    assert.match(handler, /res\.json\(\{ received: true, processed: false \}\)/);
    assert.doesNotMatch(handler, /status\(5\d\d\)/);
  });

  test('replays are refused by a primary key, not by remembering', () => {
    assert.match(webhook, /from\('stripe_events'\)\s*\.insert\(\{ id: event\.id/);
    assert.match(webhook, /duplicate: true/);
    assert.match(webhookRaw, phrase('at-least-once delivery'));
  });

  test('the signature and body are never logged', () => {
    // A failed verification is exactly when somebody may be probing. Echoing
    // their payload into our logs helps only them.
    // The logged META only. A wider window catches the constructEvent call
    // above it, which legitimately reads req.body - the first version of this
    // assertion did exactly that and failed for the wrong reason.
    const at = webhook.indexOf("logger.warn('billing.webhook_signature_failed'");
    // The META OBJECT only - the braces, not the whole call. The event name is
    // literally "billing.webhook_signature_failed", so matching /signature/
    // across the call matches the label rather than a leaked value. Second
    // version of this assertion; the first two were both too wide.
    const call = webhook.slice(at, webhook.indexOf(');', at) + 2);
    const meta = call.slice(call.indexOf('{'), call.lastIndexOf('}') + 1);
    assert.doesNotMatch(meta, /req\.body|get\('stripe-signature'\)|sig\b/i);
    assert.match(meta, /message: err\.message/);
    assert.match(webhookRaw, phrase('helps only them'));
  });

  test('an unattributable event is an error, not a shrug', () => {
    // It means somebody has paid and is not getting what they paid for.
    assert.match(webhook, /billing\.webhook_unattributable/);
    assert.match(webhookRaw, phrase('somebody has paid and is not getting what they paid for'));
  });

  test('the user id is stamped on the subscription, not just the session', () => {
    // Renewal events arriving months later have no memory of the checkout
    // session, so metadata on the subscription is the durable link.
    assert.match(billing, /subscription_data: \{ metadata: \{ user_id: req\.user\.id \} \}/);
    assert.match(billing, /client_reference_id: req\.user\.id/);
    assert.match(webhook, /object\?\.metadata\?\.user_id/);
  });

  test('a missing admin key is logged, not crashed', () => {
    assert.match(webhook, /billing\.webhook_no_admin_client/);
    // The reasoning lives in supabaseAdmin.js, next to the thing that returns
    // null, rather than in the caller that handles it.
    assert.match(adminRaw, phrase('not a 500 loop that makes Stripe retry'));
  });
});

describe('THE ADMIN CLIENT IS AN EXCEPTION TO ADR-1 AND STAYS CONTAINED', () => {
  test('exactly one file imports it', async () => {
    // If a second importer appears, the exception has stopped being an
    // exception and the decision needs revisiting rather than extending.
    const { readdirSync, readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { join } = await import('node:path');
    const root = fileURLToPath(new URL('../src', import.meta.url));

    const importers = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js') && entry.name !== 'supabaseAdmin.js') {
          if (/from '.*supabaseAdmin\.js'/.test(readFileSync(full, 'utf8'))) importers.push(entry.name);
        }
      }
    };
    walk(root);
    assert.deepEqual(importers, ['billingWebhook.js'], `admin client imported by: ${importers.join(', ')}`);
  });

  test('the reason it is safe enough is written down', () => {
    assert.match(adminRaw, phrase('THIS IS AN EXCEPTION TO ADR-1'));
    assert.match(adminRaw, phrase('A Stripe webhook has no user'));
    assert.match(adminRaw, phrase('the blast radius if you did is'));
  });

  test('the key is optional, so environments that do not need it do not hold it', () => {
    const env = readRaw(new URL('../src/lib/env.js', import.meta.url));
    assert.match(env, /secretKey: optional\(env, 'SUPABASE_SECRET_KEY', ''\)/);
  });
});

describe('checkout and the portal', () => {
  test('NO CARD DETAILS REACH THIS SERVER', () => {
    // Both pages are Stripe-hosted. A compromise of this application cannot
    // expose a card number because a card number is never here.
    assert.match(billing, /checkout\.sessions\.create/);
    assert.match(billing, /billingPortal\.sessions\.create/);
    assert.doesNotMatch(billing, /card|cvc|number|pan/i);
  });

  test('CANCELLING IS THE PORTAL, WHICH IS WHY IT KEEPS THE PROMISE', () => {
    // A hand-rolled cancel button invites a retention flow in front of it,
    // which is what ROSCA calls a functional impediment and what the FAQ
    // promised not to do.
    assert.match(billingRaw, phrase('without emailing anybody or explaining yourself'));
    assert.match(billingRaw, phrase('functional impediment'));
  });

  test('the recurring terms are stated before the card is collected', () => {
    // ROSCA: clear and conspicuous disclosure of material terms BEFORE
    // obtaining billing information.
    assert.match(billing, /custom_text/);
    assert.match(billing, phrase('This renews every month at $9.99 until you cancel'));
    assert.match(billing, phrase('you keep access until the end of the period you have paid for'));
  });

  test('somebody cannot buy a second subscription with two tabs', () => {
    assert.match(billing, /already_subscribed/);
    assert.match(billing, /entitlement\(existing\)\.entitled/);
  });

  test('a returning subscriber keeps their customer, so history stays in one place', () => {
    assert.match(billing, /existing\?\.stripe_customer_id[\s\S]{0,120}customer: existing\.stripe_customer_id/);
  });

  test('status is meaningful even when billing is switched off', () => {
    // The free product should not have to special-case its own existence.
    assert.match(billing, /configured/);
    assert.match(billing, /billingUnavailableReason\(\)/);
  });

  test('it returns no Stripe identifiers the frontend has no use for', () => {
    const status = billing.slice(billing.indexOf("get('/status'"), billing.indexOf("post('/checkout'"));
    assert.doesNotMatch(status, /stripe_customer_id:|stripe_price_id:|stripe_subscription_id:/);
  });
});

describe('billing is optional all the way down', () => {
  test('the stripe client is lazy and the import is dynamic', () => {
    // A static import would make `stripe` mandatory for everybody the moment
    // any route file imported this one - including on a clean test machine.
    assert.match(stripeLib, /await import\('stripe'\)/);
    assert.match(stripeLib, /if \(!config\.stripe\.enabled\) return null/);
  });

  test('a missing package says what to run', () => {
    assert.match(stripeLib, phrase('Run `npm install stripe`'));
  });

  test('the API version is pinned', () => {
    // Stripe ships breaking changes behind dated versions. An integration that
    // follows the newest one breaks on a day nobody deployed anything.
    assert.match(stripeLib, /apiVersion: '20\d\d-\d\d-\d\d/);
  });
});

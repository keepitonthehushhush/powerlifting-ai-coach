import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';
import { buildConfig } from '../src/lib/env.js';
import { entitlement, requiresSubscription, PAID_FEATURE } from '../src/lib/entitlement.js';

/**
 * ── WHAT A PAYWALL CAN GET WRONG ────────────────────────────────────────────
 *
 * Four things, in descending order of how bad they are:
 *
 *   1. Charging a minor, or offering to. The adult gate must answer first.
 *   2. Switching itself on because somebody added Stripe keys to test
 *      checkout, silently contradicting a promise on a public page.
 *   3. Locking a door it has no handle for - demanding a subscription in a
 *      deployment where subscribing returns 503.
 *   4. Gating something that was promised free.
 *
 * None of the four produces an exception. Each of them produces a person who
 * cannot use the thing and an application that thinks it is working.
 */

const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
const chatRaw = readRaw(new URL('../src/routes/chat.js', import.meta.url));
const env = readRaw(new URL('../src/lib/env.js', import.meta.url));
const faq = readSource(new URL('../../web/src/pages/Faq.jsx', import.meta.url));
const envExample = readRaw(new URL('../../.env.example', import.meta.url));

const BASE = {
  ANTHROPIC_API_KEY: 'sk-ant-x',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
};
const BILLING = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_PRICE_ID: 'price_x',
  SUPABASE_SECRET_KEY: 'sb_secret_x',
};

describe('the paywall is off unless somebody decides otherwise', () => {
  test('IT SHIPS OFF', () => {
    assert.equal(buildConfig(BASE).paywall.active, false);
    assert.equal(buildConfig(BASE).paywall.requested, false);
  });

  test('CONFIGURING STRIPE DOES NOT TURN IT ON', () => {
    // The failure this exists to prevent. Adding keys to a deployment is how
    // you test checkout; if that also gated every existing athlete out of the
    // coaching, the test would be indistinguishable from an outage.
    const config = buildConfig({ ...BASE, ...BILLING });
    assert.equal(config.stripe.enabled, true);
    assert.equal(config.paywall.active, false);
  });

  test('it takes the explicit variable, and only the exact word', () => {
    assert.equal(buildConfig({ ...BASE, ...BILLING, PAYWALL_ENABLED: 'true' }).paywall.active, true);
    assert.equal(buildConfig({ ...BASE, ...BILLING, PAYWALL_ENABLED: ' TRUE ' }).paywall.active, true);
    for (const value of ['false', '1', 'yes', 'on', '', 'True-ish']) {
      assert.equal(
        buildConfig({ ...BASE, ...BILLING, PAYWALL_ENABLED: value }).paywall.active,
        value.trim().toLowerCase() === 'true',
        `PAYWALL_ENABLED=${JSON.stringify(value)} was read wrong`,
      );
    }
  });

  test('A PAYWALL WITH NO WAY TO PAY STAYS OFF, AND SAYS SO', () => {
    // Locked door, no handle: the athlete is told to subscribe and the
    // subscribe button returns 503. The safe direction is that people keep
    // access, so `active` is false and `misconfigured` is true for the log.
    const config = buildConfig({ ...BASE, PAYWALL_ENABLED: 'true' });
    assert.equal(config.paywall.active, false);
    assert.equal(config.paywall.misconfigured, true);
    assert.deepEqual(config.stripe.missing, [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRICE_ID',
      'SUPABASE_SECRET_KEY',
    ]);
  });

  test('and a correctly configured paywall is not flagged as misconfigured', () => {
    assert.equal(buildConfig({ ...BASE, ...BILLING, PAYWALL_ENABLED: 'true' }).paywall.misconfigured, false);
  });
});

describe('the order of the gates', () => {
  test('THE ADULT GATE IS CHECKED BEFORE THE PAYWALL', () => {
    // If a minor reaches this route the answer is that we do not coach them,
    // never an invitation to subscribe. Asserted by position, because that is
    // what the ordering IS - there is no other artefact to point at.
    const adultGate = chat.indexOf('adultGateDecision(context.profile)');
    const paywallGate = chat.indexOf('config.paywall.active && requiresSubscription');
    assert.ok(adultGate !== -1 && paywallGate !== -1, 'one of the two gates is missing');
    assert.ok(
      adultGate < paywallGate,
      'the paywall is checked before the adult gate: a minor would be shown a subscribe button',
    );
  });

  test('and the reason it matters is written down, not just implemented', () => {
    assert.match(chatRaw, phrase('the one response this product must never give them'));
  });

  test('nothing is written to the database before the gates pass', () => {
    // loadOrCreateConversation CREATES a row. It used to run in the same
    // parallel batch as the profile read, so a refused request still recorded
    // somebody starting a conversation.
    const paywallGate = chat.indexOf('config.paywall.active && requiresSubscription');
    const createConversation = chat.indexOf('await loadOrCreateConversation(req.supabase');
    assert.ok(createConversation > paywallGate, 'a conversation is created before the gates run');
  });
});

describe('what the paywall actually gates', () => {
  test('the coaching conversation, and nothing else', () => {
    assert.equal(requiresSubscription(PAID_FEATURE), true);
    for (const free of ['logging', 'charts', 'library', 'program', 'export', 'consent']) {
      assert.equal(requiresSubscription(free), false, `${free} must stay free`);
    }
  });

  test('only sending a message is gated, not reading what you already have', () => {
    // Somebody whose subscription lapsed keeps their conversations. That is
    // their data, and taking it away would be a different product than the one
    // the FAQ describes.
    const getRoute = chat.indexOf("chatRouter.get('/conversation'");
    const gated = chat.slice(getRoute);
    assert.ok(!gated.includes('config.paywall.active'), 'reading a conversation is behind the paywall');
  });

  test('the decision is delegated to entitlement(), not re-implemented', () => {
    // The route must not grow its own opinion about which Stripe statuses
    // count. past_due and in-period cancellations are decided in one place.
    assert.ok(!/status\s*===\s*'(active|trialing|past_due|canceled)'/.test(chat));
    assert.match(chat, /entitlement\(subscription\)/);
  });

  test('a subscription still inside its paid period is served, cancelled or not', () => {
    const future = new Date(Date.now() + 7 * 864e5).toISOString();
    assert.equal(entitlement({ status: 'canceled', current_period_end: future }).entitled, true);
    assert.equal(entitlement({ status: 'past_due', current_period_end: future }).entitled, true);
    assert.equal(entitlement(null).entitled, false);
  });

  test('it answers 402, which is the status that means what happened', () => {
    assert.match(chat, /402/);
    assert.match(chat, /code: 'subscription_required'/);
  });

  test('and the refusal tells them what they still have', () => {
    // A paywall message that only says "pay" reads as the product being taken
    // away. Most of it is still theirs.
    assert.match(chatRaw, phrase('is still here and still free'));
    assert.match(chatRaw, phrase('stay free'));
  });
});

describe('the promise on the public page and the switch in the config agree', () => {
  /**
   * The check where the fact lives.
   *
   * The FAQ says, today: "It is free while it is being built and tested." That
   * sentence is true only while the paywall is off. If the default ever flips
   * without that paragraph changing, the product is charging for something a
   * public page says is free - which is the documentation-drift failure this
   * codebase keeps building checks for, except this one has a consumer-law
   * edge rather than a confused developer.
   */
  test('IF THE PAYWALL SHIPS ON BY DEFAULT, THE FAQ MUST NO LONGER PROMISE FREE', () => {
    const shipsOn = buildConfig({ ...BASE, ...BILLING }).paywall.active;
    const promisesFree = /free while it is being built and tested/.test(faq);

    if (shipsOn) {
      assert.ok(
        !promisesFree,
        'the paywall now applies by default, but the FAQ still says the product is free ' +
          'while it is being built and tested. Change the sentence in this commit.',
      );
    } else {
      assert.ok(
        promisesFree,
        'the FAQ no longer promises free access, but the paywall is still off by default. ' +
          'One of the two is out of date.',
      );
    }
  });

  test('the FAQ still names what stays free, which is what the code enforces', () => {
    assert.match(faq, phrase('logging your'));
    assert.match(faq, phrase('the paid part will be the coaching conversations'));
  });

  test('and cancel-anytime is still promised, since there is now something to cancel', () => {
    assert.match(faq, phrase('you will be able to cancel at any time'));
    assert.match(faq, phrase('until the end of the period you have already paid for'));
  });
});

describe('the switch is documented where somebody setting it up would look', () => {
  test('.env.example carries it, off, with the reason', () => {
    assert.match(envExample, /^PAYWALL_ENABLED=false$/m);
    assert.match(envExample, phrase('They are different decisions'));
  });

  test('and env.js explains why it is not derived from the Stripe keys', () => {
    assert.match(env, phrase('A SEPARATE QUESTION FROM'));
    assert.match(env, phrase('locked door with no handle'));
  });
});

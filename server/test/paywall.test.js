import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES } from '../src/lib/errorCodes.js';
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
    // what the ordering IS - there is no other artifact to point at.
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
    // `entitlement(subscription` rather than the whole call: adding the
    // grandfathering option as a second argument failed the exact form, on a
    // change that does not touch delegation at all. The property is that the
    // route hands the row to entitlement() and does not decide anything itself.
    assert.match(chat, /entitlement\(subscription[,)]/);
  });

  test('a subscription still inside its paid period is served, cancelled or not', () => {
    const future = new Date(Date.now() + 7 * 864e5).toISOString();
    assert.equal(entitlement({ status: 'canceled', current_period_end: future }).entitled, true);
    assert.equal(entitlement({ status: 'past_due', current_period_end: future }).entitled, true);
    assert.equal(entitlement(null).entitled, false);
  });

  test('it answers 402, which is the status that means what happened', () => {
    assert.match(chat, /codedError\(\s*'payment_required'/);
    // 402 is asserted where it is now decided. A status pinned in two places
    // is a status that can disagree with itself.
    assert.equal(ERROR_CODES.payment_required.status, 402);
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

describe('A PAYWALL IN TEST MODE IS A LOCKED DOOR IN PRODUCTION', () => {
  /**
   * `stripe.livemode` was computed and used by NOTHING. The guard caught
   * "paywall on, no Stripe keys" and missed the worse case: paywall on, TEST
   * keys, in production - coaching gated behind a checkout that accepts only
   * 4242 4242 4242 4242.
   *
   * Every real person locked out, none of them able to pay, and it looks
   * healthy from the operator's side because the button works and the checkout
   * page loads.
   */
  const LIVE = { ...BILLING, STRIPE_SECRET_KEY: 'sk_live_x' };

  test('production plus test keys leaves the paywall OFF', () => {
    const config = buildConfig({ ...BASE, ...BILLING, PAYWALL_ENABLED: 'true', NODE_ENV: 'production' });
    assert.equal(config.paywall.active, false);
    assert.equal(config.paywall.testKeysInProduction, true);
  });

  test('production plus live keys turns it on', () => {
    const config = buildConfig({ ...BASE, ...LIVE, PAYWALL_ENABLED: 'true', NODE_ENV: 'production' });
    assert.equal(config.paywall.active, true);
    assert.equal(config.paywall.testKeysInProduction, false);
  });

  test('but development with test keys still works, which is how you test it', () => {
    // Scoped to production deliberately. Test keys are exactly how the paywall
    // gets exercised end to end everywhere else.
    const config = buildConfig({ ...BASE, ...BILLING, PAYWALL_ENABLED: 'true' });
    assert.equal(config.paywall.active, true);
  });

  test('and the startup log says what happened, since nothing else would', () => {
    const app = readSource(new URL('../src/app.js', import.meta.url));
    assert.match(app, /paywall\.test_keys_in_production/);
    assert.match(app, /locked everybody out with no way to pay/);
  });
});

describe('the promise made to people who signed up first', () => {
  const migration = readRaw(new URL('../../supabase/migrations/0032_free_forever.sql', import.meta.url));
  const entitlementSrc = readSource(new URL('../src/lib/entitlement.js', import.meta.url));
  const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
  const panel = readSource(new URL('../../web/src/components/BillingPanel.jsx', import.meta.url));

  test('a grandfathered athlete is entitled with no subscription at all', () => {
    assert.deepEqual(entitlement(null, { freeForever: true }), {
      entitled: true, reason: 'promised_free',
    });
  });

  test('AND STILL ENTITLED AFTER A SUBSCRIPTION THEY ONCE HAD LAPSES', () => {
    // The reason the check sits first. Lower down, somebody who subscribed and
    // later canceled would fall through to `lapsed` and lose access that was
    // promised permanently - the promise outranked by a subscription record
    // that should be irrelevant to them.
    const past = new Date(Date.now() - 7 * 864e5).toISOString();
    assert.equal(
      entitlement({ status: 'canceled', current_period_end: past }, { freeForever: true }).entitled,
      true,
    );
    // The same row without the promise is correctly lapsed.
    assert.equal(entitlement({ status: 'canceled', current_period_end: past }).entitled, false);
  });

  test('the check is positioned first, not merely present', () => {
    const fn = entitlementSrc.slice(entitlementSrc.indexOf('export function entitlement'));
    assert.ok(
      fn.indexOf('if (freeForever)') < fn.indexOf('PAYING_STATUSES.includes'),
      'the promise is checked after Stripe status, so a lapsed subscription would override it',
    );
  });

  test('a Date as the second argument still works, so existing callers are unbroken', () => {
    const future = new Date(Date.now() + 7 * 864e5).toISOString();
    assert.equal(entitlement({ status: 'active', current_period_end: future }, new Date()).entitled, true);
  });

  test('THE FLAG IS PROTECTED BY A TRIGGER, NOT A REVOKE THAT DOES NOTHING', () => {
    /**
     * `revoke update (free_forever) ... from authenticated` ran without error
     * and changed nothing: authenticated holds a TABLE-level UPDATE grant, and
     * a column-level revoke cannot subtract from one. Shipped, "free coaching
     * forever" would have been a boolean any signed-in person could set on
     * themselves through PostgREST.
     */
    assert.match(migration, /create trigger protect_free_forever/);
    assert.match(migration, /new\.free_forever := old\.free_forever/);
    assert.match(migration, phrase('a column-level revoke cannot subtract from a table-level privilege'));
    assert.ok(
      !/^\s*revoke update \(free_forever\)/m.test(migration),
      'the ineffective column revoke is back',
    );
  });

  test('and the backfill is deliberately not in this migration', () => {
    // It belongs to the commit that turns the paywall on. Running it now marks
    // three accounts and excludes everybody who signs up before the switch -
    // the people the FAQ is still promising.
    assert.ok(
      !/^\s*update public\.user_profile set free_forever = true;/m.test(migration),
      'the backfill runs now, which grandfathers the wrong set of people',
    );
    assert.match(migration, phrase('belongs to the commit that turns the paywall on'));
  });

  test('the chat route passes it from the profile it already loaded', () => {
    assert.match(chat, /freeForever: context\.profile\?\.free_forever === true/);
  });

  test('and they are never shown a subscribe button', () => {
    // Offering to sell somebody something they already have for nothing reads
    // as an upsell to a person you made a promise to.
    assert.match(panel, /if \(reason === 'promised_free'\)/);
    const branch = panel.slice(panel.indexOf("reason === 'promised_free'"));
    assert.ok(!branch.slice(0, 900).includes('billing.subscribe'));
  });
});

describe('the trial', () => {
  const billing = readSource(new URL('../src/routes/billing.js', import.meta.url));
  const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));

  test('is 14 days, set once', () => {
    assert.match(billing, /const TRIAL_DAYS = 14;/);
    assert.match(billing, /trial_period_days: TRIAL_DAYS/);
  });

  test('THE CONVERSION IS DISCLOSED ON THE PAYMENT SCREEN', () => {
    // A trial that becomes a charge is a negative option, and the disclosure
    // that counts is the one where the card is entered.
    assert.match(billing, /Free for \$\{TRIAL_DAYS\} days\./);
    assert.match(billing, /renews every month at \$9\.99 until you cancel/);
    assert.match(billing, /during the trial you are charged nothing at all/);
  });

  test('there is exactly one subscription_data, so metadata is not silently dropped', () => {
    // Adding the trial created a second one; a later duplicate key wins in a
    // JS object literal, so the user_id metadata a renewal depends on could
    // have vanished without an error.
    assert.equal((billing.match(/subscription_data:/g) ?? []).length, 1);
    const block = billing.slice(billing.indexOf('subscription_data:'));
    assert.match(block.slice(0, 200), /metadata: \{ user_id: req\.user\.id \}/);
  });

  test('and the app copy says it too, not only Stripe', () => {
    assert.match(en, phrase('free for 14 days, then $9.99 a month'));
  });

  test('trialing already counted as entitled, so the coaching works during it', () => {
    const future = new Date(Date.now() + 7 * 864e5).toISOString();
    assert.equal(entitlement({ status: 'trialing', current_period_end: future }).entitled, true);
  });
});

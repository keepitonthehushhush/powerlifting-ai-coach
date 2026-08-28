import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, readRaw, phrase } from './helpers/source.js';

/**
 * ── WHAT A SUBSCRIPTION SCREEN GETS WRONG ───────────────────────────────────
 *
 * The failure that matters is not a layout bug. It is showing a "Subscribe"
 * button to somebody who has just paid.
 *
 * Stripe redirects the athlete back the instant the payment succeeds. The row
 * that records the subscription is written by the WEBHOOK - a separate request
 * from Stripe to our server - which routinely lands a second or two later. So
 * the most likely first render after a successful payment is one where the
 * database still says "not subscribed". Render the offer there and the person
 * either pays twice or emails, and both are our fault.
 *
 * Everything below is that failure and its neighbours.
 */

const panel = readSource(new URL('../../web/src/components/BillingPanel.jsx', import.meta.url));
const panelRaw = readRaw(new URL('../../web/src/components/BillingPanel.jsx', import.meta.url));
const account = readSource(new URL('../../web/src/pages/Account.jsx', import.meta.url));
const api = readSource(new URL('../../web/src/lib/api.js', import.meta.url));
const billingRoute = readSource(new URL('../src/routes/billing.js', import.meta.url));
const styles = readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8');
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));

describe('the moment they come back from Stripe', () => {
  test('A SUCCESS RETURN NEVER RENDERS THE SUBSCRIBE BUTTON', () => {
    // The guard is that the offer branch requires returned !== 'success'.
    assert.match(panel, /!entitled && !settling && returned !== 'success'/);
  });

  test('it polls, because the webhook has not arrived yet', () => {
    assert.match(panel, /SETTLE_ATTEMPTS/);
    assert.match(panel, /SETTLE_INTERVAL_MS/);
    assert.match(panel, /next\?\.entitled \|\| attempts >= SETTLE_ATTEMPTS/);
  });

  test('AND IT STOPS. A poll with no bound is a hang with a spinner', () => {
    const attempts = Number(panel.match(/SETTLE_ATTEMPTS = (\d+)/)[1]);
    const interval = Number(panel.match(/SETTLE_INTERVAL_MS = (\d+)/)[1]);
    assert.ok(attempts > 0 && attempts <= 20, 'unbounded or absurd attempt count');
    assert.ok(attempts * interval <= 60000, 'the settling state can outlast a minute');
  });

  test('when it gives up it says the payment worked, not that they should pay', () => {
    // Their card has been charged. The screen must not imply otherwise.
    assert.match(en, phrase('Your payment went through'));
    assert.match(en, phrase('you have not been charged twice'));
    assert.match(panel, /settlingSlow/);
  });

  test('the query parameter is cleared so a refresh does not replay any of it', () => {
    // Otherwise the confirmation reappears when somebody opens a bookmark
    // weeks later, and the poll re-runs on every reload.
    assert.match(panel, /searchParams\.delete\('checkout'\)/);
    assert.match(panel, /replaceState/);
  });

  test('a cancelled checkout says no money moved', () => {
    assert.match(en, phrase('No payment was taken'));
  });
});

describe('what the panel refuses to say', () => {
  test('BILLING SWITCHED OFF RENDERS NOTHING AT ALL', () => {
    // Not an empty card, not "coming soon". A deployment without Stripe is
    // the free product and should not carry the outline of a paywall.
    assert.match(panel, /if \(!status\?\.configured\) return null/);
  });

  test('AND NEITHER DOES A CONFIGURED DEPLOYMENT WITH THE PAYWALL OFF', () => {
    // The state the product ships in: Stripe keys present so checkout can be
    // tested, coaching still free. Offering to sell it would be a worse lie
    // than silence.
    assert.match(panel, /if \(!paywallActive && !hasSubscription\) return null/);
  });

  test('but somebody who HOLDS a subscription always sees it, paywall or not', () => {
    // Cancel-anytime is a promise, and a promise needs a button. The guard
    // above is deliberately `&& !hasSubscription`.
    assert.match(panelRaw, phrase('cancel-anytime is a promise and it needs a button'));
    assert.match(panel, /hasSubscription && \(/);
  });

  test('the server tells it whether the paywall applies, rather than it guessing', () => {
    assert.match(billingRoute, /paywallActive: config\.paywall\.active/);
    assert.match(panel, /paywallActive/);
  });
});

describe('the states a subscriber can be in', () => {
  test('past_due is a banner, not a lock-out, and the copy says so', () => {
    assert.match(panel, /reason === 'payment_failing'/);
    assert.match(en, phrase('this is a heads-up, not a lock-out'));
  });

  test('a cancelled subscription shows the date access ends, not a dead screen', () => {
    assert.match(panel, /cancelAtPeriodEnd \|\| reason === 'grace'/);
    assert.match(en, phrase('You keep full access until'));
    assert.match(en, phrase('and nothing is deleted'));
  });

  test('an active one shows when it renews, because a surprise charge is the complaint', () => {
    assert.match(en, phrase('Active. Renews on'));
  });

  test('a lapsed one offers to restart and says the logs are still there', () => {
    assert.match(panel, /reason === 'lapsed'/);
    assert.match(en, phrase('Everything you logged is still here'));
  });

  test('and every state names what stays free', () => {
    assert.match(en, phrase('stay free, and always will'));
  });
});

describe('the mechanics', () => {
  test('no card detail touches this origin - both calls return a Stripe URL', () => {
    assert.match(api, /startCheckout: \(\) => request\('\/billing\/checkout'/);
    assert.match(api, /openBillingPortal: \(\) => request\('\/billing\/portal'/);
    assert.match(panel, /window\.location\.assign\(url\)/);
    // No card fields anywhere in the panel.
    for (const forbidden of ['card', 'cvc', 'number', 'expiry']) {
      assert.ok(
        !new RegExp(`type=["']${forbidden}`, 'i').test(panel),
        `the panel has a ${forbidden} input - payment details must stay on Stripe's page`,
      );
    }
  });

  test('it does not set state after unmounting', () => {
    // Every path here awaits a network call, and two of them run on a timer.
    assert.match(panel, /cancelled\.current = true/);
    assert.match(panel, /if \(!cancelled\.current\)/);
  });

  test('the timer is cleared when the component goes away', () => {
    assert.match(panel, /return \(\) => \{ if \(timer\) clearTimeout\(timer\); \}/);
  });

  test('it is mounted on the account page, above consent', () => {
    assert.match(account, /<BillingPanel \/>/);
    assert.ok(
      account.indexOf('<BillingPanel />') < account.indexOf("t('consent.title')"),
      'billing should sit above consent - it is what people come to this page to change',
    );
  });

  test('the styles it uses exist, in both themes', () => {
    // A className with no rule behind it renders as unstyled text and nobody
    // notices until a screenshot.
    assert.match(styles, /^\.notice \{/m);
    assert.match(styles, /^\.row-actions \{/m);
    // Built from tokens, so the light theme is not a separate maintenance job.
    assert.match(styles, /border-left: 3px solid var\(--warning\)/);
  });

  test('and the notice does not rely on colour alone to carry its meaning', () => {
    // The reasoning lives in the stylesheet, next to the rule it constrains.
    assert.match(styles, phrase('Colour is not carrying the meaning on its own'));
  });
});

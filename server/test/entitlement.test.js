import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readRaw, phrase } from './helpers/source.js';
import { entitlement, requiresSubscription, PAYING_STATUSES, PAID_FEATURE } from '../src/lib/entitlement.js';
import { buildConfig } from '../src/lib/env.js';

const raw = readRaw(new URL('../src/lib/entitlement.js', import.meta.url));
const migration = readRaw(new URL('../../supabase/migrations/0025_subscriptions.sql', import.meta.url));
const env = readRaw(new URL('../src/lib/env.js', import.meta.url));

const now = new Date('2026-08-27T12:00:00Z');
const future = '2026-09-27T12:00:00Z';
const past = '2026-08-01T12:00:00Z';

describe('who is entitled', () => {
  test('an active subscription is', () => {
    const e = entitlement({ status: 'active', current_period_end: future }, now);
    assert.deepEqual(e, { entitled: true, reason: 'paid' });
  });

  test('nobody with no subscription is', () => {
    assert.equal(entitlement(null, now).entitled, false);
    assert.equal(entitlement({}, now).reason, 'none');
  });

  test('A FAILING CARD DOES NOT LOCK SOMEBODY OUT MID-BLOCK', () => {
    // past_due means a renewal charge failed and Stripe is retrying for days.
    // The person has not canceled and usually has not noticed. Cutting off
    // their coaching the hour their card expired would be a punishment for a
    // bank's decision, on a product they are mid-training-block on.
    const e = entitlement({ status: 'past_due', current_period_end: past }, now);
    assert.equal(e.entitled, true);
    assert.equal(e.reason, 'payment_failing', 'the UI needs to know to show a banner');
    assert.match(raw, phrase('They get a banner, not a locked door'));
  });

  test('but when Stripe gives up, so do we', () => {
    // unpaid and canceled are where the retry schedule ends.
    for (const status of ['unpaid', 'canceled', 'incomplete_expired']) {
      assert.equal(entitlement({ status, current_period_end: past }, now).entitled, false, status);
    }
  });

  test('CANCELLING KEEPS ACCESS TO THE END OF THE PAID PERIOD', () => {
    // The FAQ promises this in as many words, so it is a commitment. Stripe's
    // ordinary path keeps the subscription `active` with cancel_at_period_end
    // set, but the edge case - canceled while the period is still running -
    // must land the same way.
    const ordinary = entitlement(
      { status: 'active', cancel_at_period_end: true, current_period_end: future },
      now
    );
    assert.equal(ordinary.entitled, true);

    const edge = entitlement({ status: 'canceled', current_period_end: future }, now);
    assert.equal(edge.entitled, true);
    assert.equal(edge.reason, 'grace');
  });

  test('a missing or unparseable period end is not treated as forever', () => {
    assert.equal(entitlement({ status: 'canceled' }, now).entitled, false);
    assert.equal(entitlement({ status: 'canceled', current_period_end: 'nonsense' }, now).entitled, false);
  });

  test('an unknown Stripe status falls back to the date, not to a crash', () => {
    // Stripe owns this vocabulary and may add to it. A new status must not
    // throw, and must not silently grant access either.
    assert.equal(entitlement({ status: 'some_new_status', current_period_end: past }, now).entitled, false);
    assert.equal(entitlement({ status: 'some_new_status', current_period_end: future }, now).entitled, true);
  });

  test('trialing counts, even though no trial is offered today', () => {
    // Costs nothing to support and means turning a trial on later is a Stripe
    // dashboard change rather than a code change.
    assert.ok(PAYING_STATUSES.includes('trialing'));
  });
});

describe('what the money actually buys', () => {
  test('only the coaching conversation', () => {
    assert.equal(requiresSubscription(PAID_FEATURE), true);
    for (const free of ['logging', 'charts', 'library', 'program', 'export', 'policies']) {
      assert.equal(requiresSubscription(free), false, `${free} must stay free`);
    }
  });

  test('the promise is written next to the rule', () => {
    assert.match(raw, phrase('Everything else is free, forever'));
  });
});

describe('the schema is a cache, and says so', () => {
  test('NOTHING BUT THE WEBHOOK MAY WRITE IT', () => {
    // The integrity property. A client that could write here could grant
    // itself a subscription, and no amount of care in the application would
    // matter afterwards.
    assert.match(migration, /grant select on public\.subscriptions to authenticated/);
    assert.doesNotMatch(migration, /grant .*(insert|update|delete).* on public\.subscriptions/i);
    assert.match(migration, /for select to authenticated/);
    assert.doesNotMatch(migration, /for (insert|update|delete) to authenticated/i);
    assert.match(migration, phrase('NOTHING IN THE APPLICATION MAY WRITE'));
  });

  test('status is not an enum, and the reason is recorded', () => {
    // Stripe owns the vocabulary. An enum turns Stripe adding an eighth status
    // into a failed webhook and a user stuck on stale state.
    assert.match(migration, /status\s+text/);
    assert.doesNotMatch(migration, /status.*check \(status in/i);
    assert.match(migration, phrase('it is their vocabulary, not ours'));
  });

  test('replayed webhooks cannot be processed twice', () => {
    // Stripe delivers at least once and retries for days. A uniqueness
    // constraint is the honest guarantee; a code path that remembers is not.
    assert.match(migration, /create table public\.stripe_events/);
    assert.match(migration, /id\s+text primary key/);
    assert.match(migration, phrase('at-least-once delivery'));
  });

  test('the event ledger is readable by nobody', () => {
    const block = migration.slice(migration.indexOf('create table public.stripe_events'));
    assert.doesNotMatch(block, /grant .* on public\.stripe_events/i);
    assert.doesNotMatch(block, /create policy .* on public\.stripe_events/i);
  });
});

describe('billing is optional configuration', () => {
  test('THE APP BOOTS WITH NO STRIPE KEYS AT ALL', () => {
    // A deployment without Stripe is not broken, it is the free product. This
    // is also how it gets developed and tested without live payment
    // credentials in every environment.
    assert.doesNotMatch(env, /required\(env, 'STRIPE/);
    assert.match(env, /optional\(env, 'STRIPE_SECRET_KEY', ''\)/);
  });

  test('half-configured billing is treated as off', () => {
    // ── THIS TEST USED TO ASSERT THE BUG ────────────────────────────────
    //
    // It read:
    //
    //   assert.match(env, /enabled: Boolean\(secretKey && webhookSecret && priceId\)/)
    //
    // which pinned the EXPRESSION rather than the behavior, and the
    // expression was wrong: it omitted SUPABASE_SECRET_KEY, without which the
    // webhook cannot write the subscription, so a deployment could charge a
    // card and grant nothing. A test written against the source text cannot
    // tell a correct implementation from the one that happens to be there -
    // it just makes the current one harder to change, which is the opposite
    // of what it is for.
    //
    // Asserted through buildConfig now. The exhaustive per-variable cases
    // live in env.test.js; this keeps the entitlement story readable on its
    // own, because "billing is off unless it can deliver" belongs to the
    // question this file is about.
    const base = {
      ANTHROPIC_API_KEY: 'sk-ant-x',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    };
    const complete = {
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_PRICE_ID: 'price_x',
      SUPABASE_SECRET_KEY: 'sb_secret_x',
    };
    assert.equal(buildConfig({ ...base, ...complete }).stripe.enabled, true);
    assert.equal(
      buildConfig({ ...base, ...complete, STRIPE_WEBHOOK_SECRET: '' }).stripe.enabled,
      false,
      'a secret key with no webhook secret means checkout works and access is never granted',
    );
    assert.equal(
      buildConfig({ ...base, ...complete, SUPABASE_SECRET_KEY: '' }).stripe.enabled,
      false,
      'without the service-role key the webhook cannot record the subscription it was paid for',
    );
    assert.match(env, phrase('is the dangerous state'));
  });

  test('it can tell a live key from a test one', () => {
    assert.match(env, /secretKey\.startsWith\('sk_live_'\)/);
  });
});

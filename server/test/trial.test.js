import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readRaw } from './helpers/source.js';
import { entitlement, TRIAL_REPLY_ALLOWANCE } from '../src/lib/entitlement.js';

/**
 * ── WHAT THE TRIAL IS AND WHY IT IS COUNTED THIS WAY ──────────────────────
 *
 * A fourteen-day trial has no maximum cost - its price is however much
 * somebody chooses to use it. The measured distribution on this product says
 * that is not theoretical: the busiest account's first day was 38 replies and
 * the five days after it totalled 19. Time-boxing therefore gives away exactly
 * the heaviest part of somebody's usage and charges nothing for it.
 *
 * Twenty-five replies is a ceiling the business can name in advance: $1.78 at
 * the mean reply cost measured across 69 production calls to 2026-09-04
 * ($0.0712 each), against $9.40 net on a subscription.
 */

const migration = readRaw(
  new URL('../../supabase/migrations/0057_the_trial_is_counted_in_replies_not_days.sql', import.meta.url)
);
const route = readRaw(new URL('../src/routes/chat.js', import.meta.url));

const future = '2026-10-27T12:00:00Z';
const past = '2026-08-01T12:00:00Z';
const now = new Date('2026-09-06T12:00:00Z');

describe('the trial is offered to people who have never subscribed', () => {
  test('a new athlete with nothing spent gets the whole allowance', () => {
    const e = entitlement(null, { trialRepliesUsed: 0, asOf: now });
    assert.equal(e.entitled, true);
    assert.equal(e.reason, 'trial');
    assert.equal(e.trialRemaining, TRIAL_REPLY_ALLOWANCE);
  });

  test('the count down is exact, including the very last one', () => {
    const last = entitlement(null, { trialRepliesUsed: TRIAL_REPLY_ALLOWANCE - 1, asOf: now });
    assert.equal(last.entitled, true, 'the 25th reply was refused - an off-by-one that shortchanges the athlete');
    assert.equal(last.trialRemaining, 1);
  });

  test('and it ends exactly at the allowance, not one past it', () => {
    const done = entitlement(null, { trialRepliesUsed: TRIAL_REPLY_ALLOWANCE, asOf: now });
    assert.equal(done.entitled, false);
    assert.equal(done.reason, 'trial_exhausted');
    assert.equal(done.trialRemaining, 0);
  });

  test('a counter somehow past the allowance still reads as zero, never negative', () => {
    // "3 replies left" rendered from a negative number is the kind of thing
    // that reaches a screenshot before it reaches a bug report.
    const e = entitlement(null, { trialRepliesUsed: TRIAL_REPLY_ALLOWANCE + 9, asOf: now });
    assert.equal(e.trialRemaining, 0);
    assert.equal(e.entitled, false);
  });
});

describe('and never to people it would be a discount for', () => {
  test('A LAPSED SUBSCRIBER DOES NOT GET A SECOND FREE TRIAL', () => {
    /*
     * THE ORDERING DECISION THIS WHOLE FILE EXISTS TO PIN.
     *
     * The trial replaces the `none` branch, which meant "no subscription
     * record at all". It must not replace `lapsed`. If a canceled
     * subscription fell through to the trial, the cheapest way to use this
     * product forever would be to subscribe for one month and cancel: 25 free
     * replies on every cancelation. That is not a trial, it is a reward for
     * churning, and it is one misplaced `if` away at all times.
     */
    const e = entitlement({ status: 'canceled', current_period_end: past }, {
      trialRepliesUsed: 0,
      asOf: now,
    });
    assert.equal(e.entitled, false);
    assert.equal(e.reason, 'lapsed', 'a canceled subscriber was handed a fresh free trial');
    assert.equal(e.trialRemaining, undefined);
  });

  test('nor does an unpaid one', () => {
    const e = entitlement({ status: 'unpaid', current_period_end: past }, {
      trialRepliesUsed: 0,
      asOf: now,
    });
    assert.equal(e.reason, 'lapsed');
  });

  test('a paying athlete is paid, not trialing, even with an untouched counter', () => {
    const e = entitlement({ status: 'active', current_period_end: future }, {
      trialRepliesUsed: 0,
      asOf: now,
    });
    assert.deepEqual(e, { entitled: true, reason: 'paid' });
  });

  test('and the promise still outranks everything, including an exhausted trial', () => {
    const e = entitlement(null, {
      freeForever: true,
      trialRepliesUsed: TRIAL_REPLY_ALLOWANCE + 100,
      asOf: now,
    });
    assert.deepEqual(e, { entitled: true, reason: 'promised_free' });
  });
});

describe('an unknown count is not a free trial', () => {
  test('no count looked up means no trial, not a full one', () => {
    /*
     * loadTrialStatus() returns null when the read fails, and null must not
     * become 25. The rate limiter fails OPEN on purpose because a broken
     * counter must not become an outage; this fails CLOSED because a broken
     * counter here IS the bill, repeatedly, for anybody who notices. The
     * failure is also visible to the person immediately, so unlike the unknown
     * rate-limit bucket it cannot sit unnoticed for a day.
     */
    const e = entitlement(null, { asOf: now });
    assert.equal(e.entitled, false);
    assert.equal(e.reason, 'none');
  });

  test('and a non-integer count is treated as unknown rather than coerced', () => {
    for (const bad of [null, undefined, '0', 1.5, NaN, {}, []]) {
      const e = entitlement(null, { trialRepliesUsed: bad, asOf: now });
      assert.equal(e.reason, 'none', `${JSON.stringify(bad)} was accepted as a reply count`);
    }
  });
});

describe('the number is the database’s, and the copy says so', () => {
  test('the fallback constant equals what the migration deploys', () => {
    // Two literals for one rule is how a screen ends up promising a different
    // trial from the one being enforced. Only the database decides; this
    // asserts the fallback cannot silently disagree with it.
    const deployed = migration.match(/function public\.trial_reply_allowance\(\)[\s\S]*?select\s+(\d+)/);
    assert.ok(deployed, 'the migration no longer defines trial_reply_allowance()');
    assert.equal(Number(deployed[1]), TRIAL_REPLY_ALLOWANCE);
  });

  test('the route passes the allowance the database just reported', () => {
    assert.match(
      route,
      /trialAllowance: trial\.allowance/,
      'the route ignores the allowance it just read and lets the constant decide'
    );
  });

  test('the counter is not reachable by the athlete', () => {
    // Migration 0032 learned this the hard way: a column-level revoke cannot
    // subtract from the table-level UPDATE grant authenticated holds on
    // user_profile, so a counter there would be writable by anybody with a
    // network tab. This one is in private, where there is no grant to subtract
    // from.
    assert.match(migration, /create table if not exists private\.trial_usage/);
    assert.match(migration, /revoke all on private\.trial_usage from anon, authenticated, public;/);
    assert.doesNotMatch(
      migration,
      /alter table public\.user_profile[\s\S]{0,200}trial/i,
      'the trial counter was put on a table the athlete can write'
    );
  });

  test('reading the trial does not spend it', () => {
    // Two functions, deliberately. One increments; the paywall check calls the
    // other. Folding them together would charge a trial reply for a request
    // refused by the adult gate or lost to a timeout.
    const status = migration.match(/create or replace function public\.trial_status\(\)[\s\S]*?\$fn\$[\s\S]*?\$fn\$;/);
    assert.ok(status, 'trial_status() is gone');
    assert.doesNotMatch(status[0], /insert|update|delete/i, 'trial_status() writes');
  });

  test('and both definer functions pin an empty search_path', () => {
    for (const fn of ['trial_status', 'consume_trial_reply', 'trial_reply_allowance']) {
      const body = migration.match(new RegExp(`function public\\.${fn}\\(\\)[\\s\\S]*?\\$fn\\$`));
      assert.ok(body, `${fn} is gone`);
      assert.match(body[0], /set search_path to ''/, `${fn} does not pin search_path`);
    }
  });
});

describe('the spend happens after the reply exists', () => {
  test('consumeTrialReply is called below the conversation save, not above it', () => {
    /*
     * Order in the file is the property here, and it is worth an ugly test.
     * Above the save, a reply that generated fine and failed to store would
     * still cost a trial reply - the athlete pays for coaching they will not
     * find when they come back. Below it, the only failure mode is giving one
     * away, which is the right way round.
     */
    const save = route.indexOf("rpc('append_conversation_turn'");
    const spend = route.indexOf('await consumeTrialReply(');
    assert.notEqual(save, -1, 'the conversation save moved - this test is now checking nothing');
    assert.notEqual(spend, -1, 'nothing spends the trial');
    assert.ok(spend > save, 'the trial is spent before the reply is saved');
  });

  test('and only for somebody actually on the trial', () => {
    assert.match(
      route,
      /if \(decision\.reason === 'trial'\) trialRemaining = decision\.trialRemaining;/,
      'the trial is armed by something other than the entitlement decision saying "trial"'
    );
  });

  test('the response omits the field entirely for everybody else', () => {
    // Present-and-null is how a subscriber ends up shown "0 replies left".
    assert.match(route, /trialLeft === null \? \{\} : \{ trialRepliesLeft: trialLeft \}/);
  });
});

describe('what a refused athlete is told', () => {
  test('every refusable reason has its own words', async () => {
    const { refusalCopy } = await import('../src/routes/chat.js').catch(() => ({}));
    if (!refusalCopy) return; // the route needs env to import; the source check below covers it
    const said = ['trial_exhausted', 'lapsed', 'none'].map(refusalCopy);
    assert.equal(new Set(said).size, said.length, 'two reasons give the same sentence');
  });

  test('the trial ending is not described as a subscription ending', () => {
    /*
     * The ternary this replaced had two arms for two outcomes. There are four
     * now, and a ternary that stops covering its cases does not fail - it
     * quietly gives everybody the last arm, so somebody who never subscribed
     * would be told their subscription had ended.
     */
    const copy = route.match(/case 'trial_exhausted':\s*return '([^']*(?:\\'[^']*)*)'/);
    assert.ok(copy, 'trial_exhausted has no copy of its own');
    assert.doesNotMatch(copy[1], /subscription has ended/i);
    assert.match(copy[1], /free/i, 'it does not say what stays free');
  });

  test('and it claims nothing about results', () => {
    // The system prompt forbids claims about results and a paywall is exactly
    // where a product starts making them. The trial sells by being good.
    const block = route.slice(route.indexOf('export function refusalCopy'), route.indexOf('/** GET /api/chat/conversation'));
    assert.doesNotMatch(
      block,
      /\b(stronger|gains|results|guarantee|transform|best|proven|effective)\b/i,
      'the paywall copy makes a claim about results'
    );
  });
});

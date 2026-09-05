import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  MEASURED_PROFILE,
  costPerReply,
  cacheHitRate,
  subscriberEconomics,
} from '../src/lib/unitEconomics.js';

/**
 * The daily cap is defined in SQL, not in JavaScript, so this reads it out of
 * the migration rather than restating it. A restated constant is a constant
 * that drifts, and the whole point of this file is that three numbers which
 * live in three places have to be checked against each other.
 */
function capFromMigrations(bucket) {
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  let cap = null;
  for (const file of files) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    // Last definition wins, the same way a replay would apply them.
    for (const match of sql.matchAll(new RegExp(`when\\s+'${bucket}'\\s+then\\s+v_limit\\s*:=\\s*(\\d+)`, 'gi'))) {
      cap = Number(match[1]);
    }
  }
  return cap;
}

const MONTHLY_PRICE = 9.99;

describe('COST PER REPLY, FROM MEASURED TOKENS', () => {
  test('the measured profile carries its date and its sample size', () => {
    // A number without these is indistinguishable from an assumption, and this
    // one goes stale whenever the prompt or the model changes.
    assert.match(MEASURED_PROFILE.measured_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(MEASURED_PROFILE.sample_size > 0);
    assert.ok(MEASURED_PROFILE.distinct_users > 0);
  });

  test('it reproduces the cost production actually recorded', () => {
    // usage_events on 2026-08-30: mean cost_microdollars = 47,993 over 12 rows.
    // If this drifts, either the price table changed or the profile did, and
    // both are things somebody needs to look at rather than round away.
    const { total } = costPerReply(MEASURED_PROFILE, MEASURED_PROFILE.model);
    assert.ok(
      Math.abs(total - 0.047993) < 0.0005,
      `computed $${total.toFixed(6)} against a measured mean of $0.047993`
    );
  });

  test('an unpriced model returns null rather than a comfortable zero', () => {
    assert.equal(costPerReply(MEASURED_PROFILE, 'some-model-that-does-not-exist'), null);
    assert.equal(costPerReply(MEASURED_PROFILE, ''), null);
  });

  test('the components sum to the total and the shares sum to one', () => {
    const { total, components, shares } = costPerReply(MEASURED_PROFILE, MEASURED_PROFILE.model);
    const summed = Object.values(components).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(summed - total) < 1e-12);
    assert.ok(Math.abs(Object.values(shares).reduce((a, b) => a + b, 0) - 1) < 1e-12);
  });

  test('uncached input is the largest single component, which is the finding', () => {
    // Not a law of nature - a fact about the current cache configuration, and
    // the reason this assertion exists is so that changing the configuration
    // has to come here and say so.
    const { shares } = costPerReply(MEASURED_PROFILE, MEASURED_PROFILE.model);
    const ranked = Object.entries(shares).sort((a, b) => b[1] - a[1]);
    assert.equal(ranked[0][0], 'uncached_input', `largest component is ${ranked[0][0]}`);
    assert.ok(shares.uncached_input > 0.4);
  });

  test('less than half the input is served from cache', () => {
    const rate = cacheHitRate(MEASURED_PROFILE);
    assert.ok(rate > 0, 'caching is switched on');
    assert.ok(rate < 0.5, `cache hit rate is ${(rate * 100).toFixed(1)}%`);
  });
});

describe('WHAT ONE SUBSCRIBER COSTS AGAINST WHAT ONE SUBSCRIBER PAYS', () => {
  const replyCost = costPerReply(MEASURED_PROFILE, MEASURED_PROFILE.model).total;
  const dailyCap = capFromMigrations('chat_daily');
  const monthlyCap = capFromMigrations('chat_monthly');

  test('both caps are readable from the migrations, not restated here', () => {
    // If either returns null the arithmetic below is meaningless, and it has
    // to fail loudly rather than quietly compute with a default.
    assert.ok(Number.isFinite(dailyCap) && dailyCap > 0, 'chat_daily cap not found in migrations');
    assert.ok(Number.isFinite(monthlyCap) && monthlyCap > 0, 'chat_monthly cap not found in migrations');
  });

  test('break-even is a small number of replies a day', () => {
    const e = subscriberEconomics({ replyCost, monthlyPrice: MONTHLY_PRICE, dailyCap });
    // Roughly 195 replies a month, about 6.5 a day, after the processor's cut.
    assert.ok(e.breakEvenRepliesPerMonth > 150 && e.breakEvenRepliesPerMonth < 260,
      `break-even is ${e.breakEvenRepliesPerMonth.toFixed(0)} replies/month`);
    assert.ok(e.breakEvenRepliesPerDay < 10);
  });

  test('net revenue is computed against what arrives, not the sticker', () => {
    const e = subscriberEconomics({ replyCost, monthlyPrice: MONTHLY_PRICE, dailyCap });
    assert.ok(e.netRevenue < MONTHLY_PRICE, 'the processor takes a cut and it must be counted');
    assert.ok(Math.abs(e.netRevenue - (9.99 * 0.971 - 0.3)) < 1e-9);
  });

  test('THE MONTHLY CAP IS THE ECONOMIC LIMIT, AND THE DAILY ONE IS NOT', () => {
    /*
     * ── THIS TEST USED TO SAY THE OPPOSITE, AND IT WAS RIGHT THEN ─────────
     *
     * It read `THE DAILY CAP IS NOT AN ECONOMIC LIMIT` and asserted a capped
     * -out month cost more than twenty months of one subscription. That was
     * the finding: `chat_daily` was 300, nobody sends 300 messages a day, so
     * the cap never refused anybody and was quietly the number the business
     * underwrote.
     *
     * Migration 0056 acted on it - daily 300 to 60, and a new monthly bucket -
     * so the old assertion had to fail, and it did. Its own comment said what
     * to do about that: "if this has dropped, the cap or the price changed and
     * the comment above needs rewriting." This is the rewrite, not a relaxed
     * threshold.
     *
     * A daily cap bounds a bad day and says nothing about thirty of them.
     * Thirty days is the billing period, so the monthly bucket is the only one
     * of the three that decides whether a subscriber can cost more than they
     * pay.
     */
    const e = subscriberEconomics({ replyCost, monthlyPrice: MONTHLY_PRICE, dailyCap, monthlyCap });

    assert.equal(e.bindingCap, 'monthly', 'the daily cap binds first, so the monthly one does nothing');
    assert.equal(e.worstCaseReplies, monthlyCap);
    assert.ok(
      dailyCap * 30 > monthlyCap,
      'the daily cap is tighter than the monthly one, which makes the monthly bucket decoration'
    );

    // Still more than one month of revenue - a cap that guaranteed profit
    // would have to sit below what a real first week uses, and refusing
    // somebody mid-onboarding costs more than the replies do.
    assert.ok(e.worstCaseMonthsOfRevenue > 1);
    // But bounded, which it was not before: this is the whole point of 0056.
    assert.ok(
      e.worstCaseMonthsOfRevenue < 10,
      `worst case is ${e.worstCaseMonthsOfRevenue.toFixed(1)} months of revenue - the caps or ` +
        `the price moved, and the reasoning above needs rewriting rather than this number`
    );
  });

  test('the caps clear the busiest real usage, so they refuse nobody who exists', () => {
    /*
     * Measured across every usage_event to date: max 29 replies in an hour,
     * 38 in a day, and a front-loaded shape - 12 replies on day one and 38 on
     * day two, then 19 over the following five days.
     *
     * A cap set below that first burst would refuse the most valuable
     * conversation this product ever has with somebody. These are pinned so a
     * future tightening has to argue with the data rather than with a hunch.
     */
    assert.ok(dailyCap > 38, `daily cap ${dailyCap} is under the busiest real day`);
    assert.ok(monthlyCap > 38 * 2, `monthly cap ${monthlyCap} does not clear a real onboarding burst`);
  });

  test('a typical user is comfortably profitable, which is the other half', () => {
    // The exposure is real and so is this. Reporting only the alarming number
    // would be its own kind of dishonesty.
    const e = subscriberEconomics({ replyCost, monthlyPrice: MONTHLY_PRICE, dailyCap });
    assert.ok(e.grossMarginAt(30) > 0.8, 'one message a day');
    assert.ok(e.grossMarginAt(90) > 0.5, 'three messages a day');
    assert.ok(e.grossMarginAt(300) < 0, 'ten messages a day loses money');
  });
});

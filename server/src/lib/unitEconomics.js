/**
 * What a subscriber costs to serve, from measured tokens rather than from a
 * guess wearing a spreadsheet.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * pricing.js already answers "what did that one call cost". It says, correctly,
 * that this single number decides whether a subscription price is viable and
 * what a free tier can contain without bleeding - and then the number was never
 * carried forward to the two places that depend on it: the subscription price
 * and the daily message cap.
 *
 * On 2026-08-30 the first production measurement came in. Twelve replies, two
 * users, so a small sample and it must be said out loud - but real traffic on
 * the real prompt, not an estimate:
 *
 *     mean cost per reply   $0.047993   (median $0.046, p95 $0.072)
 *     mean input tokens     11,078 uncached + 9,586 cache reads
 *     mean output tokens     1,311
 *     mean cache writes      4,326
 *
 * Against that, `consume_rate_limit` allows a `chat_daily` bucket of 300
 * replies per user per day, and the subscription is $9.99 a month. Those three
 * numbers have never been in the same sentence before, and when you put them
 * there the daily cap is not an economic limit at all - it is roughly forty
 * times the monthly revenue.
 *
 * That is not automatically a crisis; nobody sends 300 messages a day. It is a
 * statement about the shape of the exposure: the cap is the only ceiling that
 * exists, so the cap is the number the business is actually underwriting. This
 * module makes that arithmetic explicit and testable so the next person to
 * change the price, the cap, or the model finds out what it does.
 *
 * ── DELIBERATELY NOT A POLICY ─────────────────────────────────────────────
 *
 * Nothing here enforces anything. It computes and returns. What the cap should
 * be, what the price should be, and whether to meter at all are business
 * decisions, and a library that quietly started refusing replies because it
 * disagreed with the price would be a much worse bug than the one it fixed.
 */

import { priceFor } from './pricing.js';

const PER_MILLION = 1_000_000;

/**
 * The measured profile of one coaching reply, in tokens.
 *
 * Field names match the Anthropic usage object rather than the usage_events
 * column names, so a profile can be built straight from either without a
 * rename step inventing an opportunity to swap two of them.
 *
 * @typedef {{input_tokens:number, output_tokens:number,
 *            cache_creation_input_tokens:number, cache_read_input_tokens:number}} TokenProfile
 */

/**
 * Production, 2026-08-30. Twelve replies from two users - the entire history
 * of the table at that point, not a sample chosen from it.
 *
 * Checked in with its date and its n because a measurement without either is
 * indistinguishable from an assumption, and this one WILL go stale: it moves
 * whenever the prompt, the model, the cache breakpoints or the conversation
 * length change.
 */
export const MEASURED_PROFILE = Object.freeze({
  measured_on: '2026-08-30',
  sample_size: 12,
  distinct_users: 2,
  model: 'claude-sonnet-5',
  input_tokens: 11078,
  output_tokens: 1311,
  cache_creation_input_tokens: 4326,
  cache_read_input_tokens: 9586,
});

/**
 * Cost of one reply, in dollars, broken down by what drove it.
 *
 * Returns the components and not just the total, because the total on its own
 * tells you nothing about what to do next. The first run of this said 46% of
 * the money goes to input tokens that were NOT served from cache - which is a
 * cache-configuration finding, and it is invisible in a single figure.
 *
 * @param {TokenProfile} profile
 * @param {string} model
 * @returns {{total:number, components:Record<string,number>, shares:Record<string,number>}|null}
 */
export function costPerReply(profile, model) {
  const price = priceFor(model);
  if (!price || !profile) return null;

  const components = {
    uncached_input: (profile.input_tokens ?? 0) * price.input / PER_MILLION,
    output: (profile.output_tokens ?? 0) * price.output / PER_MILLION,
    cache_write: (profile.cache_creation_input_tokens ?? 0) * price.cacheWrite5m / PER_MILLION,
    cache_read: (profile.cache_read_input_tokens ?? 0) * price.cacheRead / PER_MILLION,
  };

  const total = Object.values(components).reduce((a, b) => a + b, 0);
  const shares = Object.fromEntries(
    Object.entries(components).map(([k, v]) => [k, total > 0 ? v / total : 0])
  );

  return { total, components, shares };
}

/**
 * How much of the input is being served from cache.
 *
 * Cache reads are a tenth the price of uncached input, so this ratio is the
 * single biggest lever on cost that does not involve changing the model or
 * what the coach is allowed to say.
 *
 * @returns {number} 0..1, or 0 when there is no input at all
 */
export function cacheHitRate(profile) {
  const cached = profile?.cache_read_input_tokens ?? 0;
  const uncached = profile?.input_tokens ?? 0;
  const total = cached + uncached;
  return total > 0 ? cached / total : 0;
}

/**
 * Break-even and exposure for one subscriber.
 *
 * @param {object} opts
 * @param {number} opts.replyCost         dollars per reply
 * @param {number} opts.monthlyPrice      list price, dollars
 * @param {number} opts.dailyCap          replies per user per day the system allows
 * @param {number} [opts.daysPerMonth]    30 by default
 * @param {number} [opts.processorPercent] payment processor percentage, 0..1
 * @param {number} [opts.processorFixed]  payment processor fixed fee, dollars
 */
export function subscriberEconomics({
  replyCost,
  monthlyPrice,
  dailyCap,
  daysPerMonth = 30,
  processorPercent = 0.029,
  processorFixed = 0.3,
}) {
  // Net revenue, not list price. A gross-margin number computed against the
  // sticker rather than against what actually arrives is wrong by the
  // processor's cut in the flattering direction, every time.
  const netRevenue = monthlyPrice * (1 - processorPercent) - processorFixed;

  const breakEvenRepliesPerMonth = replyCost > 0 ? netRevenue / replyCost : Infinity;
  const worstCaseMonthlyCost = replyCost * dailyCap * daysPerMonth;

  return {
    netRevenue,
    breakEvenRepliesPerMonth,
    breakEvenRepliesPerDay: breakEvenRepliesPerMonth / daysPerMonth,
    worstCaseMonthlyCost,
    /**
     * How many months of one subscription a single capped-out month burns.
     * Named for what it measures rather than "risk" or "ratio", because the
     * number is only alarming if you know what it counts.
     */
    worstCaseMonthsOfRevenue: netRevenue > 0 ? worstCaseMonthlyCost / netRevenue : Infinity,
    grossMarginAt: (repliesPerMonth) => {
      const cost = replyCost * repliesPerMonth;
      return netRevenue > 0 ? (netRevenue - cost) / netRevenue : -Infinity;
    },
  };
}

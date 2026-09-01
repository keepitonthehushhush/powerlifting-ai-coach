/**
 * Who has paid, and what that buys.
 *
 * ── THE RULE, IN ONE PLACE ────────────────────────────────────────────────
 *
 * Same reasoning as needsMedicalClearance and the age gate: a rule with
 * consequences gets computed in one readable function and tested exhaustively,
 * rather than reconstructed from an `if` in a route and another in a page. When
 * the pricing changes - and it will - there should be exactly one edit.
 *
 * ── WHICH STRIPE STATUSES COUNT ───────────────────────────────────────────
 *
 * Stripe's lifecycle has seven: incomplete, incomplete_expired, trialing,
 * active, past_due, canceled, unpaid. Two of them are worth arguing about.
 *
 * `past_due` COUNTS AS PAID here, deliberately. It means a renewal charge
 * failed - an expired card, a bank declining a foreign transaction - and
 * Stripe is retrying on a schedule that runs for days. The person has not
 * canceled and in the overwhelming majority of cases has not even noticed.
 * Cutting off their coaching the hour their card expired, on a product they
 * are mid-training-block on, would be a punishment for a bank's decision. They
 * get a banner, not a locked door. When the retries are exhausted Stripe moves
 * them to `unpaid` or `canceled`, and those do not count.
 *
 * `canceled` DOES NOT COUNT, but that is not the whole answer - see below.
 *
 * ── CANCELLATION IS A DATE, NOT A SWITCH ──────────────────────────────────
 *
 * The FAQ promises access "until the end of the period you have already paid
 * for", and that is a commitment rather than a nicety. Stripe expresses it as
 * `cancel_at_period_end` on a subscription that stays `active` until the date
 * passes, so the ordinary path needs no special handling. What DOES need
 * handling is the edge: if a subscription is somehow `canceled` while the paid
 * period has not elapsed, the athlete keeps access. Erring towards the person
 * who paid is the correct direction for a rounding error.
 */

/** Stripe statuses that mean the coaching stays on. */
export const PAYING_STATUSES = Object.freeze(['active', 'trialing', 'past_due']);

/** The one thing the subscription buys. Everything else is free, forever. */
export const PAID_FEATURE = 'coaching_conversation';

/**
 * @param {object|null} subscription a row from public.subscriptions
 * @param {Date|{asOf?: Date, freeForever?: boolean}} [options]
 *        A Date is accepted for the existing call sites and means `asOf`.
 * @returns {{entitled: boolean, reason: 'paid'|'grace'|'none'|'lapsed'|'payment_failing'|'promised_free'}}
 */
export function entitlement(subscription, options = {}) {
  const { asOf = new Date(), freeForever = false } =
    options instanceof Date ? { asOf: options } : options;

  /**
   * ── THE PROMISE OUTRANKS EVERYTHING BELOW ────────────────────────────────
   *
   * The FAQ said, to everybody who signed up before the paywall existed, that
   * the product was free while it was being built. `free_forever` marks those
   * people (migration 0032), and it is checked FIRST - before status, before
   * dates, before anything Stripe knows.
   *
   * Position matters here. Anywhere lower and a grandfathered athlete who once
   * subscribed and later canceled would fall through to `lapsed` and lose
   * access they were promised permanently - the promise silently outranked by
   * a subscription record that should be irrelevant to them.
   *
   * They can still subscribe if they want to; it just buys them nothing they
   * do not already have, which is the correct shape for a gift.
   */
  if (freeForever) return { entitled: true, reason: 'promised_free' };

  if (!subscription || !subscription.status) return { entitled: false, reason: 'none' };

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end)
    : null;
  const withinPaidPeriod = periodEnd instanceof Date && !Number.isNaN(periodEnd.getTime())
    ? periodEnd > asOf
    : false;

  if (PAYING_STATUSES.includes(subscription.status)) {
    return {
      entitled: true,
      reason: subscription.status === 'past_due' ? 'payment_failing' : 'paid',
    };
  }

  // Canceled or unpaid, but the period they bought has not run out. They keep
  // it. See the note above: err towards the person who paid.
  if (withinPaidPeriod) return { entitled: true, reason: 'grace' };

  return { entitled: false, reason: 'lapsed' };
}

/**
 * Is this feature behind the paywall at all?
 *
 * Exists so the answer to "what is free" lives next to the answer to "who has
 * paid", and so a future feature cannot be quietly gated by adding a check in
 * a route. Logging, charts, the library, the program record and every policy
 * page are free forever - that is the promise on the FAQ, and it is the reason
 * somebody can get value before deciding.
 */
export function requiresSubscription(feature) {
  return feature === PAID_FEATURE;
}

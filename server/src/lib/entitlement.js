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

/**
 * The trial, in replies.
 *
 * ── A FALLBACK, NOT THE SOURCE ────────────────────────────────────────────
 *
 * public.trial_reply_allowance() in the database is the source, because the
 * database is what enforces the number and a second literal would drift into
 * a screen that promises a different trial from the one being applied. This
 * constant exists so that entitlement() is still a pure function that can be
 * tested without a database, and so a failed lookup degrades to the intended
 * number rather than to zero - erring towards the person, which is the same
 * direction every other decision in this file errs.
 *
 * A test asserts it equals the migration's value, so the two cannot drift
 * silently even though only one of them decides.
 */
export const TRIAL_REPLY_ALLOWANCE = 25;

/** Stripe statuses that mean the coaching stays on. */
export const PAYING_STATUSES = Object.freeze(['active', 'trialing', 'past_due']);

/** The one thing the subscription buys. Everything else is free, forever. */
export const PAID_FEATURE = 'coaching_conversation';

/**
 * @param {object|null} subscription a row from public.subscriptions
 * @param {Date|{asOf?: Date, freeForever?: boolean}} [options]
 *        A Date is accepted for the existing call sites and means `asOf`.
 * @returns {{entitled: boolean, trialRemaining?: number,
 *            reason: 'paid'|'grace'|'none'|'lapsed'|'payment_failing'|'promised_free'
 *                   |'trial'|'trial_exhausted'}}
 */
export function entitlement(subscription, options = {}) {
  const {
    asOf = new Date(),
    freeForever = false,
    trialRepliesUsed,
    trialAllowance = TRIAL_REPLY_ALLOWANCE,
  } = options instanceof Date ? { asOf: options } : options;

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

  /**
   * ── THE TRIAL SITS EXACTLY WHERE `none` USED TO ──────────────────────────
   *
   * Never anywhere else, and the placement is the whole rule.
   *
   * It is offered to somebody who has NEVER subscribed. It is not offered to
   * somebody who subscribed and canceled: they reach `lapsed` below, which
   * is a different answer on purpose. A lapsed athlete has already had the
   * product and made a decision about it, and handing them 25 more free
   * replies would mean the cheapest way to use this is to subscribe for a
   * month and cancel - a trial that renews on cancelation is not a trial,
   * it is a discount for churning.
   *
   * `trialRepliesUsed` is a count from private.trial_usage, which the athlete
   * cannot write (see migration 0057, and 0032 for why a column on
   * user_profile would have been writable by anybody who opened the network
   * tab). Undefined means the caller did not look it up - a route that has
   * not asked must not be handed a free trial by default, so undefined reads
   * as "no trial available" rather than as zero.
   */
  const trialUsed = Number.isInteger(trialRepliesUsed) ? trialRepliesUsed : null;
  const hasNeverSubscribed = !subscription || !subscription.status;

  if (hasNeverSubscribed) {
    if (trialUsed === null) return { entitled: false, reason: 'none' };
    const remaining = Math.max(trialAllowance - trialUsed, 0);
    return remaining > 0
      ? { entitled: true, reason: 'trial', trialRemaining: remaining }
      : { entitled: false, reason: 'trial_exhausted', trialRemaining: 0 };
  }

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

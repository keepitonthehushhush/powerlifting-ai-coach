import { codedError } from './errorCodes.js';

/**
 * Read the calling user's subscription row.
 *
 * ── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────
 *
 * Because two callers need it - the billing routes, which report status, and
 * the chat route, which decides whether to answer - and a four-line query
 * copied into two files is a query that drifts. The version that matters here
 * is the security-relevant one: if one copy later grows a filter the other
 * lacks, the difference shows up as somebody being served coaching they have
 * not paid for, or refused coaching they have.
 *
 * ── NO user_id FILTER, ON PURPOSE ─────────────────────────────────────────
 *
 * `supabase` is the per-request client carrying the caller's JWT (ADR-1), and
 * public.subscriptions is behind RLS scoped to auth.uid(). The row this can
 * see is the caller's row and there is no other. Adding `.eq('user_id', ...)`
 * would read as the security control and quietly become one - and the day
 * somebody passes the wrong id, the filter is what would be trusted rather
 * than the policy. The policy is the control. maybeSingle() then returns null
 * for somebody who has never subscribed, which is a normal state and not an
 * error.
 *
 * ── IT IS SEPARATE FROM entitlement.js DELIBERATELY ───────────────────────
 *
 * entitlement.js is pure: a row in, a decision out, no I/O, exhaustively
 * testable without a database. That is what makes the rule readable and worth
 * trusting. Putting a query in it would end that, so the query lives here.
 */
export async function loadSubscription(supabase) {
  const { data, error } = await supabase.from('subscriptions').select('*').maybeSingle();
  if (error) throw codedError('storage_unavailable', 'Could not read your subscription.', { cause: error.code });
  return data ?? null;
}

/**
 * How much of the free trial the caller has spent.
 *
 * ── WHY THIS CAN RETURN NULL AND WHAT NULL MEANS ──────────────────────────
 *
 * Null is "we do not know", never "none spent". entitlement() treats an
 * unknown count as no trial rather than as a full one, which is the safe
 * direction: a database hiccup should not mint free coaching, and the athlete
 * who hits that gets the ordinary subscribe message rather than silent
 * unlimited access.
 *
 * That is the opposite direction from the rate limiter, which fails OPEN on
 * purpose. The difference is what each failure costs. An open rate limiter
 * risks a bill; an open trial IS the bill, repeatedly, for anybody who
 * notices. And unlike a limiter, the failure here is visible to the person
 * immediately, so it cannot sit unnoticed for a day the way the unknown
 * bucket did.
 *
 * @returns {Promise<{used: number, allowance: number, remaining: number}|null>}
 */
export async function loadTrialStatus(supabase) {
  const { data, error } = await supabase.rpc('trial_status');
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !Number.isInteger(row.used) || !Number.isInteger(row.allowance)) return null;
  return { used: row.used, allowance: row.allowance, remaining: row.remaining };
}

/**
 * Spend one trial reply. Called only after a reply exists and has been saved.
 *
 * Best-effort by design, and the direction is deliberate: if this fails the
 * athlete gets one reply more than the trial allows, which is a rounding error
 * in the athlete's favor to give away. The alternative - failing the request after the
 * coaching has already been written and stored - would take away a reply the
 * person can see on their screen, to protect a few cents.
 *
 * @returns {Promise<number|null>} the new total, or null if it did not land.
 */
export async function consumeTrialReply(supabase) {
  const { data, error } = await supabase.rpc('consume_trial_reply');
  if (error || !Number.isInteger(data)) return null;
  return data;
}

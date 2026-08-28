import { HttpError } from './httpError.js';

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
  if (error) throw new HttpError(502, 'Could not read your subscription.', { code: error.code });
  return data ?? null;
}

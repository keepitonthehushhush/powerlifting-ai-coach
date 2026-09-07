-- =============================================================================
-- 0059_three_things_the_linter_found.sql
--
-- The database linter, read after two weeks of schema changes. Three
-- findings worth acting on and several deliberately left alone.
--
-- ── 1. THREE POLICIES RE-EVALUATE auth.uid() PER ROW ────────────────────────
--
-- `user_id = auth.uid()` is re-evaluated for every row scanned. Wrapped as
-- `(select auth.uid())` Postgres treats it as an InitPlan: evaluated once per
-- query and compared against each row. Same rows, same security, one call
-- instead of N.
--
-- Every other policy in this schema already reads `(select auth.uid())` - the
-- conversations, profile and log policies were written that way. These three
-- are the stragglers, and they are on exactly the tables that grow fastest:
-- audit_events keeps 24 months, error_events 6, and error_events is the one
-- that only started receiving browser rows this month. The cost of leaving
-- them is small today and grows with precisely the data that is about to
-- arrive.
--
-- ── 2. TWO FOREIGN KEYS WITH NO COVERING INDEX ──────────────────────────────
--
-- usage_events.conversation_id and workout_sessions.program_id. Postgres does
-- not index a foreign key automatically, and without one every DELETE or
-- UPDATE on the parent scans the whole child table to check the constraint.
--
-- That is not academic here. `delete_my_account()` is a legal obligation with
-- a promise attached - immediate, without emailing anybody - and it cascades
-- through both. Today the tables hold tens of rows and it does not matter; the
-- index is what stops it mattering later, and it is cheaper to add now than to
-- diagnose as a timeout during somebody's erasure request.
--
-- ── 3. WHAT WAS DELIBERATELY NOT CHANGED ────────────────────────────────────
--
-- The linter also reports:
--
--   * `public.stripe_events` has RLS enabled and no policies. That is the
--     intended state and the safe direction: RLS with no policy denies
--     everything to everybody except the service role, which is the only thing
--     that should ever read a Stripe event. A policy here would widen it.
--
--   * A dozen `SECURITY DEFINER` functions callable by `authenticated`, and
--     two by `anon`. Each exists so users can call it, each derives its target
--     from auth.uid() rather than an argument, and section 9 of docs/SECURITY.md
--     names all of them with the reason. The linter cannot know that; the
--     document is the answer to it.
--
--   * Unused indexes on leaderboard_entries and subscriptions. They are unused
--     because nobody has opted into the leaderboard and nobody has subscribed,
--     not because they are wrong. Dropping an index for lack of traffic on a
--     product with no traffic would be reading the wrong signal.
-- =============================================================================

-- ── 1 ────────────────────────────────────────────────────────────────────────
drop policy if exists audit_events_read_own on public.audit_events;
create policy audit_events_read_own
  on public.audit_events for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists error_events_read_own on public.error_events;
create policy error_events_read_own
  on public.error_events for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists guardian_consent_requests_read on public.guardian_consent_requests;
create policy guardian_consent_requests_read
  on public.guardian_consent_requests for select to authenticated
  using (user_id = (select auth.uid()));

-- ── 2 ────────────────────────────────────────────────────────────────────────
-- Named for what they cover rather than for the query that needs them: these
-- exist for the constraint check on cascade, which has no query of its own.
create index if not exists usage_events_conversation_idx
  on public.usage_events (conversation_id);

create index if not exists workout_sessions_program_idx
  on public.workout_sessions (program_id);

-- ── 4. A LIVENESS PROBE THAT NEEDS NO PRIVILEGE ─────────────────────────────
--
-- /api/health answered `status: "ok"` by reading environment variables, so it
-- said "ok" whether or not a database existed. Supabase pauses a FREE project
-- after roughly a week of low activity, which makes that a likely state and
-- not a remote one: this app went 2026-09-04 to 2026-09-06 with no traffic at
-- all, and in a quiet week the daily check would have reported production
-- healthy every morning of an outage.
--
-- The obvious fix - have the health route read a table through the admin
-- client - was written and then thrown away. ADR-12 says there is exactly one
-- service-role client and it belongs to the Stripe webhook, and a test asserts
-- exactly one file imports it, with the comment: "if a second importer
-- appears, the exception has stopped being an exception and the decision needs
-- revisiting rather than extending." That is right. A liveness check is a poor
-- reason to widen the one component in the system that bypasses RLS.
--
-- This needs no privilege at all. It returns a constant, touches no table, and
-- reveals nothing that GET / does not - and calling it still proves the whole
-- path an athlete depends on: PostgREST is reachable, Postgres is awake and
-- answering, and the project is not paused. `anon` may call it precisely
-- because there is nothing there to protect.
--
-- SECURITY INVOKER, like append_conversation_turn and unlike everything else
-- here: a function that reads nothing needs no rights of its own, and definer
-- on an anon-callable function is a shape worth never introducing casually.
create or replace function public.database_awake()
returns boolean language sql immutable
set search_path to ''
as $fn$ select true $fn$;

comment on function public.database_awake() is
  'Liveness only. Returns a constant, reads nothing, and grants nothing - calling it proves PostgREST and Postgres are answering. Used by /api/health, which also keeps a free Supabase project from pausing.';

revoke all on function public.database_awake() from public;
grant execute on function public.database_awake() to anon, authenticated;

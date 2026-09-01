-- =============================================================================
-- 0044_the_counters_are_finally_swept.sql
--
-- The last thing in this schema with a stated policy and nothing that keeps it.
--
-- Migration 0006 ends with a comment, written before launch:
--
--   -- Expired windows accumulate. At current volume this is negligible, but the
--   -- sweep belongs in a scheduled job (pg_cron) before launch:
--   --   delete from private.rate_limit_counters where window_start < now() - ...
--
-- Launch happened. The job did not. docs/SECURITY.md has carried it as a known
-- gap ever since - "the DELETE is written in migration 0006; it needs a pg_cron
-- schedule" - which is the honest thing to do with a gap and is not the same as
-- closing it.
--
-- ── WHY IT MATTERS MORE THAN THE ROW COUNT SUGGESTS ─────────────────────────
--
-- It is a small table and this is a small fix. The reason to do it is not disk.
--
-- rate_limit_counters is keyed (user_id, bucket, window_start) with a foreign
-- key to auth.users ON DELETE CASCADE, so a deleted account takes its counters
-- with it. What is left behind for everybody else is a row per user per bucket
-- per window, forever: one row that says a particular account made a request in
-- a particular hour. Nobody would design that as a retention policy, and
-- account deletion is the only thing currently removing any of it.
--
-- So this is the same argument as everywhere else in this schema: data with no
-- remaining purpose should not outlive the purpose. Two days is already far
-- longer than the longest window in use (24 hours for chat_daily and export),
-- so nothing being swept can still be enforcing a limit.
--
-- ── WHY IT IS NOT A retention_periods CATEGORY ──────────────────────────────
--
-- That table drives the nightly apply_retention() sweep and an invariant which
-- asserts every category in it is actually swept. Adding this would fit the
-- letter and not the spirit: retention_periods holds RETENTION PROMISES - the
-- periods the consumer health data policy publishes to users, in months, about
-- their own data. A rate limit counter is operational state with a two-day life
-- and nothing published about it.
--
-- Putting it there would mean either the policy page grows a line about
-- request counters, or the table stops meaning what its consumers assume. The
-- separate schedule costs one cron entry and keeps the published list honest.
-- Written down because "why is this the one sweep that lives somewhere else"
-- is a fair question with a real answer.
-- =============================================================================

create or replace function private.sweep_rate_limit_counters()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  n bigint;
begin
  -- Two days, deliberately generous against the 24-hour windows: a counter is
  -- only safe to remove once it can no longer be the one enforcing a limit,
  -- and the cost of keeping a row a day longer is nothing.
  delete from private.rate_limit_counters
   where window_start < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$fn$;

comment on function private.sweep_rate_limit_counters() is
  'Removes rate limit windows old enough that they cannot still be enforcing a limit. Scheduled nightly; see migration 0044 for why this is not a retention_periods category.';

revoke all on function private.sweep_rate_limit_counters() from public, anon, authenticated;

-- ── The schedule ────────────────────────────────────────────────────────────
--
-- 41 past 4, twenty-four minutes after apply-retention at 17 4. Deliberately
-- not the same minute: two security-definer jobs starting together on a small
-- instance is a self-inflicted lock contention story, and staggering them costs
-- nothing.
--
-- unschedule first so re-running this migration is safe. cron.unschedule raises
-- when the job does not exist, which on a first run is the normal case, so the
-- exception is caught rather than allowed to abort the migration.
do $$
begin
  perform cron.unschedule('sweep-rate-limit-counters');
exception when others then
  null;
end $$;

select cron.schedule(
  'sweep-rate-limit-counters',
  '41 4 * * *',
  $cron$select private.sweep_rate_limit_counters()$cron$
);

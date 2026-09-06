-- =============================================================================
-- 0057_the_trial_is_counted_in_replies_not_days.sql
--
-- A free trial with a ceiling the business can name in advance.
--
-- ── WHY REPLIES AND NOT DAYS ────────────────────────────────────────────────
--
-- A fourteen-day trial has no maximum cost. Its price is however much somebody
-- chooses to use it, and the measured distribution here says that is not a
-- theoretical worry: the busiest account's first day was 38 replies and the
-- five days after it totalled 19. Use is front-loaded, hard. A time-boxed
-- trial therefore hands the heaviest fortnight of somebody's usage away and
-- charges nothing for it, and the only lever afterwards is a rate limit, which
-- is a worse experience than a number stated up front.
--
-- Replies are the unit the cost is actually denominated in. Twenty-five of
-- them is a known, bounded acquisition cost: $1.78 at the mean reply price
-- measured on production over 69 calls to 2026-09-04 ($0.0712), and lower once
-- the conversation cache is verified to be reading back. The point is that the
-- worst case is a number rather than an unknown.
--
-- Twenty-five is also enough to be a real trial rather than a tease: an intake
-- conversation, a program, and two or three weeks of adjusting it. Somebody
-- who has trained a full block on this and wants to keep going has had the
-- product, not a demo of it.
--
-- ── WHY A PRIVATE TABLE AND NOT A COLUMN ON user_profile ────────────────────
--
-- Migration 0032 established the rule and the reason. `authenticated` holds a
-- table-level UPDATE grant on public.user_profile, and in Postgres a
-- column-level revoke cannot subtract from a table-level privilege. So a
-- `trial_replies_used` column there would be a number any signed-in person
-- could set on themselves through PostgREST - an unlimited free trial for
-- anybody who opened the network tab. 0032 solved that for free_forever with a
-- trigger, which works and needs a trigger per protected column.
--
-- A counter belongs in private, where `authenticated` has no reach at all and
-- there is nothing to protect it FROM. It is reached only through the two
-- definer functions below, which is the same shape as the rate limiter and for
-- the same reason.
-- =============================================================================

create table if not exists private.trial_usage (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  replies_used  integer not null default 0 check (replies_used >= 0),
  started_at    timestamptz not null default now(),
  last_reply_at timestamptz
);

comment on table private.trial_usage is
  'Coaching replies spent against the free trial, one row per athlete. Private: authenticated has no grant here and reaches it only through public.trial_status() and public.consume_trial_reply(). Contains no health data and no message content.';

revoke all on private.trial_usage from anon, authenticated, public;

-- ── THE ALLOWANCE LIVES IN ONE PLACE ────────────────────────────────────────
--
-- The server needs the number to write the copy that says what is left, and
-- the database needs it to decide. Two literals would drift, and the drift
-- would show as a screen promising a different trial from the one enforced -
-- the same failure shape as has_active_consent showing a checkbox the
-- enforcement disagreed with. So the database owns it and the API asks.
create or replace function public.trial_reply_allowance()
returns integer language sql immutable
set search_path to ''
as $fn$ select 25 $fn$;

comment on function public.trial_reply_allowance() is
  'How many coaching replies a new athlete gets before subscribing. The single source of this number: the API reads it rather than holding a copy.';

-- ── READING IS NOT SPENDING ─────────────────────────────────────────────────
--
-- Two functions, deliberately. The paywall check runs before the model call
-- and must not consume anything; the spend happens only after a reply has
-- actually been produced and saved. Folding them together would charge a
-- trial reply for a request that errored, timed out, or was refused by the
-- adult gate - taking somebody's free coaching for a reply they never saw.
create or replace function public.trial_status()
returns table(used integer, allowance integer, remaining integer)
language sql stable security definer
set search_path to ''
as $fn$
  select coalesce(t.replies_used, 0),
         public.trial_reply_allowance(),
         greatest(public.trial_reply_allowance() - coalesce(t.replies_used, 0), 0)
    from (select auth.uid() as uid) u
    left join private.trial_usage t on t.user_id = u.uid
   where u.uid is not null;
$fn$;

comment on function public.trial_status() is
  'What is left of the caller''s free trial. Reads only - never spends.';

create or replace function public.consume_trial_reply()
returns integer language plpgsql security definer
set search_path to ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_used int;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into private.trial_usage as t (user_id, replies_used, last_reply_at)
  values (v_user, 1, now())
  on conflict (user_id) do update
    set replies_used = t.replies_used + 1, last_reply_at = now()
  returning t.replies_used into v_used;

  return v_used;
end;
$fn$;

comment on function public.consume_trial_reply() is
  'Spend one trial reply for the caller and return the new total. Called only after a reply has been produced and saved. A caller can only ever spend their own, and spending it faster only hurts them.';

revoke all on function public.trial_reply_allowance() from public;
revoke all on function public.trial_status() from public;
revoke all on function public.consume_trial_reply() from public;
grant execute on function public.trial_reply_allowance() to authenticated;
grant execute on function public.trial_status() to authenticated;
grant execute on function public.consume_trial_reply() to authenticated;

-- ── THE TRIAL IS NOT RETENTION-SWEPT ────────────────────────────────────────
--
-- private.apply_retention() deletes old rows from the observability tables.
-- This one must survive: a counter that is swept is a trial that renews
-- itself, quietly, for anybody who waits. It is one integer per account with
-- no personal content in it, it is deleted with the account by the cascade
-- above, and that is the whole of its lifecycle. Named here so that the next
-- person to extend the sweep has already been told.

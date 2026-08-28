-- =============================================================================
-- 0026_leaderboard.sql
--
-- An opt-in leaderboard, built so that opting in is the ONLY thing it can
-- leak and so that the numbers on it cannot be typed by the person they
-- belong to.
--
-- ── THE STANDING RULE THIS HAS TO SURVIVE ────────────────────────────────────
--
-- "A user must never be able to read another user's profile, programs, or
-- logs." A leaderboard is by definition a cross-user read, so it would be easy
-- to satisfy the feature by loosening that. We are not going to.
--
-- Instead: a SEPARATE TABLE holding only what somebody chose to publish. Not a
-- view over user_profile, not a policy carve-out on progress_logs. The
-- difference matters when a policy is wrong - and policies here have been wrong
-- twice already. A mistaken policy on a view over user_profile exposes date of
-- birth, injuries and health restrictions. A mistaken policy on this table
-- exposes a display name and three numbers that the person published on
-- purpose. The blast radius is the column list, and the column list is the
-- whole design.
--
-- Health data is not here. Bodyweight is not here. Age, sex, injuries,
-- restrictions and location are not here, and there is deliberately no column
-- they could be added to without a migration and this comment being read.
--
-- ── AND THE NUMBERS CANNOT BE SELF-REPORTED ─────────────────────────────────
--
-- The obvious implementation gives `authenticated` insert and update on their
-- own row and has the API write the totals. That is wrong, and not subtly: the
-- browser holds a real JWT and can talk to PostgREST directly, so anybody who
-- opened the network tab could set their squat to 9999. RLS would allow it -
-- it IS their row - and the leaderboard would become a text field.
--
-- So `authenticated` gets SELECT and nothing else. Every write goes through the
-- two SECURITY DEFINER functions below, and neither of them accepts a number.
-- refresh_leaderboard_entry() recomputes from the caller's own progress_logs.
-- The only way to move up is to log the lift.
--
-- This is the database-level version of the rule the rest of the codebase
-- follows: values with consequences are COMPUTED, never accepted.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- The handle. Lives on the profile because it is the athlete's, not the
-- leaderboard's - it survives leaving and rejoining, and a display name is
-- worth having before there is anywhere to display it.
-- ----------------------------------------------------------------------------
alter table public.user_profile
  add column if not exists display_name text
    check (
      display_name is null
      or (
        length(display_name) between 3 and 24
        -- Letters, digits, underscore, hyphen. No spaces, no punctuation that
        -- could be mistaken for markup, and nothing that renders as another
        -- character. A leaderboard is the one place in this product where a
        -- name is shown to strangers.
        and display_name ~ '^[A-Za-z0-9_-]+$'
      )
    );

comment on column public.user_profile.display_name is
  'Public handle, shown on the leaderboard and nowhere else. Null until chosen. Never the email address, which must never appear on a page other people can see.';

-- Case-insensitive uniqueness: two people called "Eddy" and "eddy" on one
-- leaderboard is a bug report, and impersonation is the reason it is a bug.
create unique index if not exists user_profile_display_name_key
  on public.user_profile (lower(display_name))
  where display_name is not null;

-- ----------------------------------------------------------------------------
-- The published projection. One row per athlete who opted in; no row at all
-- for everybody else.
--
-- Opting out DELETES the row rather than setting a flag. A hidden row is still
-- a row, and "we kept your numbers but stopped showing them" is not what
-- somebody withdrawing consent is asking for.
-- ----------------------------------------------------------------------------
create table if not exists public.leaderboard_entries (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null,
  -- Best COMPLETED single-set weight for each lift, in the athlete's own
  -- units, computed from progress_logs. Null where they have not logged that
  -- lift yet - which is honest, and better than a zero that reads as a score.
  best_squat    numeric(7,2) check (best_squat    is null or best_squat    >= 0),
  best_bench    numeric(7,2) check (best_bench    is null or best_bench    >= 0),
  best_deadlift numeric(7,2) check (best_deadlift is null or best_deadlift >= 0),
  units         text not null check (units in ('lb','kg')),
  updated_at    timestamptz not null default now()
);

comment on table public.leaderboard_entries is
  'Opt-in public projection. Readable by every authenticated user BY DESIGN - that is the feature. Contains only a chosen handle, three lifted numbers and units. No health data, no bodyweight, no age, no identifiers. Writable only through the security-definer functions below, so the numbers cannot be self-reported.';

alter table public.leaderboard_entries enable row level security;

-- Everybody signed in may read every row. This is the one deliberately
-- cross-user policy in the schema, and it is scoped to a table that contains
-- only published data.
drop policy if exists leaderboard_entries_read on public.leaderboard_entries;
create policy leaderboard_entries_read
  on public.leaderboard_entries
  for select
  to authenticated
  using (true);

-- No insert, update or delete policy exists, for anybody. Deliberate: see the
-- header. The functions below run as owner and bypass RLS.

-- SELECT only. The privilege that is not granted is the security control here;
-- the missing policies alone would not be, because a policy narrows a granted
-- privilege and does not create one. (Learned the hard way in 0021.)
grant select on public.leaderboard_entries to authenticated;
revoke all on public.leaderboard_entries from anon;

create index if not exists leaderboard_entries_squat_idx
  on public.leaderboard_entries (units, best_squat desc nulls last);
create index if not exists leaderboard_entries_bench_idx
  on public.leaderboard_entries (units, best_bench desc nulls last);
create index if not exists leaderboard_entries_deadlift_idx
  on public.leaderboard_entries (units, best_deadlift desc nulls last);

-- ----------------------------------------------------------------------------
-- canonical_lift(text)
--
-- ── WHY THIS HAD TO EXIST ───────────────────────────────────────────────────
--
-- progress_logs.lift stores WHAT THE ATHLETE TYPED. 'squat', 'back squat',
-- 'low bar squat' and 'squats' are four rows describing one lift, and the
-- normalisation has always lived in JavaScript (lib/progression.js,
-- canonicalLift). The first draft of this migration compared `lift = 'squat'`
-- and would have quietly ranked a leaderboard on the subset of people who
-- happened to type the shortest spelling. It would have produced numbers, and
-- the numbers would have been wrong, and nothing would have failed.
--
-- ── AND WHY THE DUPLICATION IS SAFE ─────────────────────────────────────────
--
-- This list is a copy of LIFT_SPELLINGS in lib/progression.js, and a copy is
-- exactly the thing that drifts. So it is not trusted to stay in step:
-- leaderboard.test.js parses both this function and that map and asserts the
-- two sets are identical. Add a spelling in one place and the suite fails
-- naming the missing one. The duplication is allowed; shipping a divergence is
-- not.
-- ----------------------------------------------------------------------------
create or replace function public.canonical_lift(name text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select c.canonical from (values
    ('squat', 'squat'),
    ('squats', 'squat'),
    ('back squat', 'squat'),
    ('low bar squat', 'squat'),
    ('high bar squat', 'squat'),
    ('competition squat', 'squat'),
    ('comp squat', 'squat'),
    ('deadlift', 'deadlift'),
    ('deadlifts', 'deadlift'),
    ('dead lift', 'deadlift'),
    ('conventional deadlift', 'deadlift'),
    ('sumo deadlift', 'deadlift'),
    ('competition deadlift', 'deadlift'),
    ('comp deadlift', 'deadlift'),
    ('bench', 'bench'),
    ('bench press', 'bench'),
    ('benchpress', 'bench'),
    ('barbell bench press', 'bench'),
    ('flat bench', 'bench'),
    ('competition bench', 'bench'),
    ('comp bench', 'bench'),
    ('press', 'press'),
    ('overhead press', 'press'),
    ('strict press', 'press'),
    ('ohp', 'press'),
    ('standing press', 'press'),
    ('military press', 'press'),
    ('shoulder press', 'press')
  ) as c(spelling, canonical)
  where c.spelling = lower(regexp_replace(btrim(name), '\s+', ' ', 'g'));
$$;

revoke all on function public.canonical_lift(text) from anon, public;
grant execute on function public.canonical_lift(text) to authenticated;

-- ----------------------------------------------------------------------------
-- refresh_leaderboard_entry()
--
-- Recomputes the caller's own row from their own logs. Takes no arguments, so
-- there is nothing to tamper with: the numbers are whatever they lifted.
--
-- No-ops when the caller has not opted in. That is what makes it safe to call
-- from the session-logging path without checking first.
-- ----------------------------------------------------------------------------
create or replace function public.refresh_leaderboard_entry()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'refresh_leaderboard_entry() requires an authenticated caller';
  end if;

  if not exists (select 1 from public.leaderboard_entries where user_id = uid) then
    return;
  end if;

  update public.leaderboard_entries e
  set
    -- The handle can change; the row follows it rather than going stale.
    display_name = coalesce(p.display_name, e.display_name),
    units         = coalesce(p.units, e.units),
    best_squat    = b.squat,
    best_bench    = b.bench,
    best_deadlift = b.deadlift,
    updated_at    = now()
  from public.user_profile p,
       lateral (
         select
           -- COMPLETED only. A missed rep is a record of an attempt, not of a
           -- lift, and 0016 exists precisely so the two are distinguishable.
           max(weight) filter (where public.canonical_lift(lift) = 'squat')    as squat,
           max(weight) filter (where public.canonical_lift(lift) = 'bench')    as bench,
           max(weight) filter (where public.canonical_lift(lift) = 'deadlift') as deadlift
         from public.progress_logs
         where user_id = uid and completed
       ) b
  where e.user_id = uid and p.user_id = uid;
end;
$$;

revoke all on function public.refresh_leaderboard_entry() from anon, public;
grant execute on function public.refresh_leaderboard_entry() to authenticated;

-- ----------------------------------------------------------------------------
-- set_leaderboard_opt_in(boolean)
--
-- Joining and leaving, in one function, because withdrawal must be no harder
-- than consent - the same rule the MHMDA consent panel follows.
--
-- Joining requires a display name. Publishing somebody under an email address
-- or a raw uuid is not a thing this product will ever do by accident.
-- ----------------------------------------------------------------------------
create or replace function public.set_leaderboard_opt_in(opt_in boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  handle text;
  unit text;
begin
  if uid is null then
    raise exception 'set_leaderboard_opt_in() requires an authenticated caller';
  end if;

  if not opt_in then
    -- A delete, not a flag. Withdrawing consent removes the data.
    delete from public.leaderboard_entries where user_id = uid;
    return;
  end if;

  select p.display_name, p.units into handle, unit
  from public.user_profile p where p.user_id = uid;

  if handle is null then
    raise exception 'display_name_required'
      using hint = 'Choose a display name before joining the leaderboard.';
  end if;

  insert into public.leaderboard_entries (user_id, display_name, units)
  values (uid, handle, coalesce(unit, 'lb'))
  on conflict (user_id) do update set display_name = excluded.display_name;

  -- Populate the numbers immediately, so joining does not show a row of blanks
  -- until the next session is logged.
  perform public.refresh_leaderboard_entry();
end;
$$;

revoke all on function public.set_leaderboard_opt_in(boolean) from anon, public;
grant execute on function public.set_leaderboard_opt_in(boolean) to authenticated;

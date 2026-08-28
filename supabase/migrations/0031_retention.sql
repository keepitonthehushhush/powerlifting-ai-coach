-- =============================================================================
-- 0031_retention.sql
--
-- Data does not stop being sensitive because nobody looked at it. The health
-- data policy has carried a placeholder since it was written - "a defined
-- maximum retention period has not yet been set" - and this sets it.
--
-- ── WHY THIS IS TIERED AND NOT ONE TTL ──────────────────────────────────────
--
-- A single "delete everything older than N" is the obvious design and it is
-- wrong here, because the categories are not alike:
--
--   * A THREE-YEAR TRAINING LOG IS THE ATHLETE'S ASSET. It is the thing they
--     came for, and deleting it because they took a year off would destroy
--     what the product exists to build. progress_logs is never swept.
--
--   * A STALE INJURY IS A LIABILITY, NOT AN ASSET. "Torn rotator cuff" from
--     two years ago still shaping programming today is bad coaching before it
--     is a privacy problem. Expiring it is the rare change that improves
--     safety and minimisation at once.
--
--   * OLD CHAT IS NEITHER. The coach replays a bounded window and never reads
--     past it, so messages beyond it are unread by construction - and they are
--     where people mention injuries, weight and what is going on at home.
--     Deleting what nothing reads is the cheapest minimisation available.
--
-- ── THE TIMESTAMP TRAP ──────────────────────────────────────────────────────
--
-- Expiring health_restrictions on `user_profile.updated_at` would be silently
-- wrong: that column moves when ANY field changes, so editing a bodyweight
-- would reset the injury clock and a restriction could live forever while
-- appearing to be swept. The field needs its OWN timestamp, moved only when
-- the field itself changes. Hence the column and trigger below.
--
-- ── AND EXPIRY MUST NOT QUIETLY MAKE THE COACHING LESS SAFE ─────────────────
--
-- Clearing an injury on its own would leave an athlete looking unrestricted to
-- a coach that had been working around something. So the same statement clears
-- `cleared_to_train`. They are then treated exactly as somebody who has not
-- answered yet: conservatively, and asked. No extra flag is stored, so nothing
-- records that a restriction ever existed - a column saying "this person once
-- had a health restriction" would be an inference about health, which is the
-- thing being deleted.
-- =============================================================================

-- ── The health field's own timestamp ────────────────────────────────────────
alter table public.user_profile
  add column if not exists health_restrictions_updated_at timestamptz;

comment on column public.user_profile.health_restrictions_updated_at is
  'When health_restrictions last CHANGED. Deliberately not user_profile.updated_at, which moves on any edit and would reset the retention clock every time somebody changed their bodyweight.';

-- Backfill: existing rows are dated from the row's own updated_at, which is the
-- best evidence available and errs towards expiring sooner rather than later.
update public.user_profile
   set health_restrictions_updated_at = coalesce(health_restrictions_updated_at, updated_at)
 where health_restrictions is not null;

create or replace function private.stamp_health_restrictions()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  -- `is distinct from` rather than `<>`: null-to-value and value-to-null are
  -- both changes, and `<>` is null for either.
  if tg_op = 'INSERT' then
    if new.health_restrictions is not null then
      new.health_restrictions_updated_at := now();
    end if;
  elsif new.health_restrictions is distinct from old.health_restrictions then
    new.health_restrictions_updated_at :=
      case when new.health_restrictions is null then null else now() end;
  end if;
  return new;
end;
$fn$;

revoke all on function private.stamp_health_restrictions() from anon, authenticated, public;

drop trigger if exists stamp_health_restrictions on public.user_profile;
create trigger stamp_health_restrictions
  before insert or update on public.user_profile
  for each row execute function private.stamp_health_restrictions();

-- ── The periods, in one place ───────────────────────────────────────────────
create table if not exists public.retention_periods (
  category text primary key,
  months   int not null check (months > 0),
  note     text not null
);

comment on table public.retention_periods is
  'The retention schedule, as data rather than as numbers buried in a function. Readable by users so the privacy policy and the database cannot disagree; a test asserts the policy page states these same figures.';

alter table public.retention_periods enable row level security;
drop policy if exists retention_periods_read on public.retention_periods;
create policy retention_periods_read
  on public.retention_periods for select to authenticated using (true);
grant select on public.retention_periods to authenticated;
revoke all on public.retention_periods from anon;

insert into public.retention_periods (category, months, note) values
  ('health_restrictions', 12,
   'Injury and medical notes are cleared 12 months after they were last changed, along with training clearance, so the coach asks again rather than working from something two years old.'),
  ('conversation_messages', 12,
   'Messages older than 12 months are removed. The coach replays a bounded recent window and never reads past it, so these are unread by construction.'),
  ('audit_events', 24,
   'Kept two years for accountability, then removed. Rows whose account was deleted already carry no user id.'),
  ('usage_events', 24,
   'Cost and usage telemetry, kept two years.'),
  ('stripe_events', 3,
   'Webhook event ids, kept only long enough to reject a replay. Stripe stops retrying long before this.')
on conflict (category) do update
  set months = excluded.months, note = excluded.note;

-- ── The sweep ───────────────────────────────────────────────────────────────
--
-- One function, run daily. Returns a row per category so a run can be read
-- rather than inferred from what is missing afterwards.
create or replace function private.apply_retention()
returns table (category text, affected bigint)
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  -- Aliased. The OUT parameter is also called `category`, and plpgsql resolves
  -- an unqualified name to the variable, so `where category = '...'` raised
  -- 42702 rather than doing anything. Found by running it, which a test that
  -- only reads the migration file could not have done.
  m_health int := (select rp.months from public.retention_periods rp where rp.category = 'health_restrictions');
  m_msgs   int := (select rp.months from public.retention_periods rp where rp.category = 'conversation_messages');
  m_audit  int := (select rp.months from public.retention_periods rp where rp.category = 'audit_events');
  m_usage  int := (select rp.months from public.retention_periods rp where rp.category = 'usage_events');
  m_stripe int := (select rp.months from public.retention_periods rp where rp.category = 'stripe_events');
  n bigint;
begin
  -- Health restrictions, and the clearance that was granted alongside them.
  -- One statement, so an athlete is never briefly unrestricted-and-cleared.
  update public.user_profile
     set health_restrictions = null,
         health_restrictions_updated_at = null,
         cleared_to_train = null
   where health_restrictions is not null
     and health_restrictions_updated_at < now() - make_interval(months => m_health);
  get diagnostics n = row_count;
  category := 'health_restrictions'; affected := n; return next;

  /**
   * Conversation messages.
   *
   * `messages` is a jsonb array whose elements carry `at`. Elements written
   * before that field existed have no `at` and cannot be dated individually,
   * so they are judged by the conversation's own created_at - if the whole
   * conversation predates the cutoff, so does anything undateable inside it.
   * Undateable messages in a RECENT conversation are kept: deleting something
   * because its date is unknown is the wrong default for the athlete's record.
   */
  with trimmed as (
    select c.id,
           coalesce(jsonb_agg(msg order by ord), '[]'::jsonb) as kept,
           jsonb_array_length(c.messages) as before_count
      from public.conversations c
      cross join lateral jsonb_array_elements(c.messages) with ordinality as t(msg, ord)
     where jsonb_array_length(c.messages) > 0
       and (
             (msg ? 'at' and (msg->>'at')::timestamptz >= now() - make_interval(months => m_msgs))
          or (not (msg ? 'at') and c.created_at >= now() - make_interval(months => m_msgs))
           )
     group by c.id, c.messages
  )
  update public.conversations c
     set messages = t.kept
    from trimmed t
   where c.id = t.id
     and jsonb_array_length(t.kept) < t.before_count;
  get diagnostics n = row_count;
  category := 'conversation_messages'; affected := n; return next;

  -- A conversation whose every message aged out is emptied above; the row
  -- itself stays so the athlete's conversation list does not develop holes.

  delete from public.audit_events where created_at < now() - make_interval(months => m_audit);
  get diagnostics n = row_count;
  category := 'audit_events'; affected := n; return next;

  delete from public.usage_events where created_at < now() - make_interval(months => m_usage);
  get diagnostics n = row_count;
  category := 'usage_events'; affected := n; return next;

  delete from public.stripe_events where received_at < now() - make_interval(months => m_stripe);
  get diagnostics n = row_count;
  category := 'stripe_events'; affected := n; return next;
end;
$fn$;

revoke all on function private.apply_retention() from anon, authenticated, public;

-- ----------------------------------------------------------------------------
-- delete_inactive_accounts() - BUILT, DELIBERATELY NOT SCHEDULED.
--
-- ── WHY IT IS NOT SWITCHED ON ───────────────────────────────────────────────
--
-- Because there is no way to warn anybody first. Transactional email is
-- deferred until there is revenue (see ARCHITECTURE.md), so the only mail this
-- product can send is Supabase's own auth mail. Deleting a lifter's three-year
-- training history with no notice is hostile even where it is lawful, and the
-- first they would learn of it is an empty account.
--
-- So the code exists, is tested, and is scheduled by nobody. The day a mailbox
-- exists, this becomes a warning email and one cron line rather than a project.
--
-- Defaults to a DRY RUN. A destructive function whose default is to destroy is
-- one keystroke from a very bad afternoon, and the whole point of running it
-- first is to see what it would take.
-- ----------------------------------------------------------------------------
create or replace function private.delete_inactive_accounts(
  p_months  int default 24,
  p_dry_run boolean default true
)
returns table (user_id uuid, last_seen timestamptz, deleted boolean)
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  cutoff timestamptz := now() - make_interval(months => p_months);
begin
  return query
  with candidates as (
    /**
     * "Inactive" is the LATEST of every signal we have, not just last sign-in.
     * Somebody whose session refreshes silently, or who logs training from a
     * device that stays signed in, is not inactive - and a definition that
     * missed that would delete active users. Erring towards keeping is the
     * correct direction for an irreversible action.
     */
    select u.id,
           greatest(
             coalesce(u.last_sign_in_at, u.created_at),
             coalesce((select max(p.created_at) from public.progress_logs p where p.user_id = u.id), u.created_at),
             coalesce((select max(c.updated_at) from public.conversations c where c.user_id = u.id), u.created_at),
             coalesce((select max(s.updated_at) from public.subscriptions s where s.user_id = u.id), u.created_at)
           ) as seen
      from auth.users u
  ),
  stale as (
    select c.id, c.seen from candidates c where c.seen < cutoff
  ),
  removed as (
    delete from auth.users a
     using stale s
     where a.id = s.id and not p_dry_run
    returning a.id
  )
  select s.id, s.seen, (s.id in (select r.id from removed r)) from stale s;
end;
$fn$;

revoke all on function private.delete_inactive_accounts(int, boolean) from anon, authenticated, public;

comment on function private.delete_inactive_accounts(int, boolean) is
  'Deletes accounts with no activity for p_months. NOT SCHEDULED: nothing can warn people first until transactional email exists. Dry run by default.';

-- ----------------------------------------------------------------------------
-- Schedule the non-destructive sweep. Daily, early UTC.
--
-- In-database rather than a serverless cron: this must run whether or not
-- anybody visits the site, and it must not be bounded by a function timeout.
-- The account deletion above is deliberately absent from this schedule.
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.unschedule('apply-retention')
 where exists (select 1 from cron.job where jobname = 'apply-retention');

select cron.schedule('apply-retention', '17 4 * * *', $cron$select private.apply_retention()$cron$);

-- The health data policy now STATES these periods, so its version moves and
-- everybody is asked again. Retention is a term somebody consents to, and the
-- consent panel already presents a stale agreement as unanswered (0027).
update public.policy_versions
   set version = 'chd-2026-08-28a', effective_at = now()
 where consent_type = 'health_data_collection';

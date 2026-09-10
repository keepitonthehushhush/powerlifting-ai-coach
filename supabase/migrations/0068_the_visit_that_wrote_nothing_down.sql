-- =============================================================================
-- 0068_the_visit_that_wrote_nothing_down.sql
--
-- One row per account per day it was used. Nothing else.
--
-- ── THE QUESTION ────────────────────────────────────────────────────────────
--
-- `npm run retention` measures whether an athlete came back by unioning three
-- things this database already records: a message to the coach, a logged
-- workout, a program written. Every one of them is a WRITE.
--
-- The most ordinary use of this product writes nothing. Somebody opens the app
-- standing in the gym, reads the session they are about to do, puts the phone
-- in their pocket and squats. That is the product working exactly as intended
-- and it is invisible to every number the report prints. For a training app
-- that is not an edge case, it is arguably the main case - so the retention
-- figures are floors with no known ceiling, and a floor is a bad thing to make
-- a decision on when the decision is whether the product retains anybody.
--
-- Same lesson as 0062 and 0064: add the log line the moment you notice you
-- cannot answer a question about somebody who has already left.
--
-- ── WHY A TABLE AND NOT A COLUMN ────────────────────────────────────────────
--
-- `user_profile.last_active_on` is one line and answers a different question.
-- It says WHEN somebody was last here, which cannot distinguish an athlete who
-- trained four days a week for three weeks from one who signed up, vanished,
-- and looked once on the same afternoon. Retention is a curve and a curve
-- needs the days, not the maximum.
--
-- ── THE COARSENESS IS THE FEATURE ───────────────────────────────────────────
--
-- A date. Not a timestamp, not a route, not a count, not an IP address, not a
-- user agent, not a referrer. Two columns, both of which are the primary key.
--
-- Written down deliberately because the pressure will be the other way. Every
-- one of those fields is one line to add and each would make some future
-- question answerable, and the sum of them is a behavioral surveillance log
-- sitting inside an app that also holds people's injuries. What this table can
-- support is exactly: did they come back, on how many days, in which week. It
-- cannot reconstruct anybody's afternoon, and that is the point rather than an
-- oversight to be corrected later.
--
-- If a future question genuinely needs more, the honest move is a new table
-- with its own disclosure and its own retention period, not a quiet column
-- here.
--
-- ── THE DATE IS UTC, ON PURPOSE ─────────────────────────────────────────────
--
-- `current_date` on Supabase is UTC, so a lifter training at nine in the
-- evening in California is filed under the following day. The alternative is
-- to let the browser send its own local date, and that is worse for two
-- reasons: it makes a spoofable client value out of a field the server can
-- know by itself, and it buys nothing, because the RETURN CURVE in
-- scripts/lib/retention.mjs is measured in elapsed hours from each account's
-- own signup and never reads a calendar day at all. Only the "days" column in
-- the report is affected, and it is labeled UTC where it is printed.
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
--
-- Not health data: a date says nothing about a body. Not sent to the model -
-- entered in policyDisclosure.test.js as bookkeeping, beside the three funnel
-- timestamps. No new collection surface in the sense that matters: it is the
-- date of an authenticated request the server already received, answered, and
-- logged. It rides the ON DELETE CASCADE and the export's select('*'), so it
-- is erased with the account and included when somebody asks for their data.
--
-- Written through the CALLER'S OWN RLS-scoped client, so `authenticated`
-- necessarily holds INSERT on it and a determined person can add or remove
-- their own days. Left that way for the reason 0062 and 0064 give: the worst
-- available outcome is one person's own retention row being wrong, in a number
-- nothing is enforced against.
--
-- No UPDATE policy, and not as a security measure. The row's entire content is
-- its own existence - there is no field to change. Moving a row to a different
-- day is delete-then-insert however it is spelled, so an UPDATE policy would
-- only add a second spelling of something already permitted.
-- =============================================================================

create table if not exists public.activity_days (
  -- `auth.uid()` bare, not `(select auth.uid())`. Postgres does not permit a
  -- subquery in a column DEFAULT, and the (select ...) wrapper in the policies
  -- below is an initplan optimization that has no meaning here. As 0011 says:
  -- a default removes a footgun, the POLICY is the security control.
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  day     date not null default current_date,
  primary key (user_id, day)
);

comment on table public.activity_days is
  'One row per account per UTC day on which it made an authenticated API request. Exists because the three write-based activity signals (messages, logged sessions, programs) cannot see the most ordinary use of this product - opening the app in the gym, reading the session, and training - which made every retention number a floor. Deliberately holds nothing but the pair: no timestamp, no route, no count, no address, no user agent. Not health data and never sent to the model.';

comment on column public.activity_days.day is
  'UTC calendar date, from current_date on the server rather than from the browser. A late evening in the Americas is filed under the following day; the return curve is computed in elapsed hours from signup and never reads this as a calendar, so the skew affects only the descriptive day count.';

alter table public.activity_days enable row level security;

create policy "activity: owner can read own"
  on public.activity_days for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "activity: owner can insert own"
  on public.activity_days for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Their own history to erase, the same as every other table here. Account
-- deletion is what actually matters and it arrives through the cascade above.
create policy "activity: owner can delete own"
  on public.activity_days for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Deny by default is the posture since 0009, so a policy without a grant is a
-- policy that never runs. No UPDATE: see the header.
grant select, insert, delete on public.activity_days to authenticated;

-- --- retention ---------------------------------------------------------------
-- Twenty-four months, matching usage_events. Long enough that a year-over-year
-- cohort comparison is possible, short enough that this does not quietly become
-- a permanent record of when somebody trained.
--
-- The row and the DELETE go in TOGETHER. check-db-invariants.mjs asserts that
-- every category named in retention_periods appears in the body of
-- apply_retention(), because a published retention promise that nothing keeps
-- is the same shape as the RLS policy with no GRANT in 0021 - correct on paper,
-- inert in fact.
insert into public.retention_periods (category, months, note) values
  ('activity_days', 24,
   'The dates an account used the app, kept two years so cohorts can be compared across a year, then removed.')
on conflict (category) do update
  set months = excluded.months, note = excluded.note;

-- CREATE OR REPLACE, and the return type is untouched: this adds a ROW to the
-- returned table, not a column. Adding a column would be a return-type change
-- and Postgres refuses those with 42P13 - see 0061, which had to be amended
-- with a DROP before it could replay.
create or replace function private.apply_retention()
returns table(category text, affected bigint)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  m_health int := (select rp.months from public.retention_periods rp where rp.category = 'health_restrictions');
  m_glp1   int := (select rp.months from public.retention_periods rp where rp.category = 'glp1_status');
  m_msgs   int := (select rp.months from public.retention_periods rp where rp.category = 'conversation_messages');
  m_audit  int := (select rp.months from public.retention_periods rp where rp.category = 'audit_events');
  m_usage  int := (select rp.months from public.retention_periods rp where rp.category = 'usage_events');
  m_stripe int := (select rp.months from public.retention_periods rp where rp.category = 'stripe_events');
  m_errors int := (select rp.months from public.retention_periods rp where rp.category = 'error_events');
  m_guard  int := (select rp.months from public.retention_periods rp where rp.category = 'guardian_email');
  m_intent int := (select rp.months from public.retention_periods rp where rp.category = 'training_intention');
  m_greq   int := (select rp.months from public.retention_periods rp where rp.category = 'guardian_consent_requests');
  m_days   int := (select rp.months from public.retention_periods rp where rp.category = 'activity_days');
  n bigint;
begin
  update public.user_profile
     set health_restrictions = null,
         health_restrictions_updated_at = null,
         cleared_to_train = false
   where health_restrictions is not null
     and health_restrictions_updated_at < now() - make_interval(months => m_health);
  get diagnostics n = row_count;
  category := 'health_restrictions'; affected := n; return next;

  update public.user_profile
     set glp1_status = null,
         glp1_status_updated_at = null
   where glp1_status is not null
     and glp1_status_updated_at < now() - make_interval(months => m_glp1);
  get diagnostics n = row_count;
  category := 'glp1_status'; affected := n; return next;

  update public.user_profile
     set training_obstacle = null,
         training_if_then = null,
         training_intention_updated_at = null
   where training_intention_updated_at is not null
     and training_intention_updated_at < now() - make_interval(months => m_intent);
  get diagnostics n = row_count;
  category := 'training_intention'; affected := n; return next;

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

  delete from public.audit_events ae where ae.created_at < now() - make_interval(months => m_audit);
  get diagnostics n = row_count;
  category := 'audit_events'; affected := n; return next;

  delete from public.usage_events ue where ue.created_at < now() - make_interval(months => m_usage);
  get diagnostics n = row_count;
  category := 'usage_events'; affected := n; return next;

  update public.consent_records cr
     set guardian_email = null
   where cr.guardian_email is not null
     and cr.created_at < now() - make_interval(months => m_guard);
  get diagnostics n = row_count;
  category := 'guardian_email'; affected := n; return next;

  delete from public.stripe_events se where se.received_at < now() - make_interval(months => m_stripe);
  get diagnostics n = row_count;
  category := 'stripe_events'; affected := n; return next;

  delete from public.error_events ee where ee.created_at < now() - make_interval(months => m_errors);
  get diagnostics n = row_count;
  category := 'error_events'; affected := n; return next;

  delete from public.guardian_consent_requests
   where created_at < now() - make_interval(months => m_greq);
  get diagnostics n = row_count;
  category := 'guardian_consent_requests'; affected := n; return next;

  -- Cast back to date. current_date minus an interval is a TIMESTAMP, and
  -- comparing a date column against a timestamp widens every row to midnight
  -- rather than comparing days - which happens to give the right answer here
  -- and would stop doing so the moment the interval gains an hours component.
  delete from public.activity_days ad
   where ad.day < (current_date - make_interval(months => m_days))::date;
  get diagnostics n = row_count;
  category := 'activity_days'; affected := n; return next;
end;
$function$;

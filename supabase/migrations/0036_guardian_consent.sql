-- =============================================================================
-- 0036 — Coaching 13 to 17 year olds: the database half
--
-- The design, the reasoning and the law behind it are in docs/UNDER_18.md.
-- This migration builds the storage and the invariants. It does NOT switch
-- anything on: the gate reads a flag that is off by default, and while it is
-- off no row here is ever written. Writing the code is not the decision to
-- ship it.
--
-- Four things:
--   1. `guardian_consent` becomes a consent type in the existing ledger.
--   2. The ledger learns one new column - the guardian's email - under a
--      constraint that stops it becoming a general-purpose PII column.
--   3. That email gets a retention period and a line in the nightly sweep.
--   4. A minor cannot join the leaderboard, enforced in the database.
-- =============================================================================

-- ── 1. A new consent type ────────────────────────────────────────────────────
--
-- The ledger is already append-only, already ordered, already version-aware,
-- and already invalidates every consent on a policy bump. A guardian consent is
-- another type in it, which means withdrawal, re-consent after a policy change
-- and the audit trail all work on day one with no new machinery. The CHECK
-- constraint enumerates the types on purpose: a new one is a deliberate,
-- auditable schema change rather than a string somebody passes.
alter table public.consent_records
  drop constraint if exists consent_records_consent_type_check;

alter table public.consent_records
  add constraint consent_records_consent_type_check
  check (consent_type in (
    'health_data_collection',
    'ai_processing',
    'terms_of_service',
    'leaderboard_publication',
    'guardian_consent'
  ));

insert into public.policy_versions (consent_type, version)
values ('guardian_consent', 'gc-2026-08-29a')
on conflict (consent_type) do update set version = excluded.version, effective_at = now();

-- ── 2. The guardian's email ──────────────────────────────────────────────────
--
-- This is personal data about a THIRD PARTY who never signed up for anything,
-- which is the most sensitive kind of thing this table could hold. It gets the
-- same treatment as everything else: minimised to one field, never logged,
-- covered by the existing RLS, in the export, and in the retention sweep.
--
-- The CHECK is the important part. Without it this is simply a nullable text
-- column on a table every consent flows through, and the next person who needs
-- somewhere to put a string will find it. Tying it to the one consent type that
-- has any business carrying an email keeps the column honest.
alter table public.consent_records
  add column if not exists guardian_email text;

alter table public.consent_records
  drop constraint if exists consent_records_guardian_email_only_for_guardian_consent;

alter table public.consent_records
  add constraint consent_records_guardian_email_only_for_guardian_consent
  check (guardian_email is null or consent_type = 'guardian_consent');

comment on column public.consent_records.guardian_email is
  'Third-party personal data. The address a guardian consent was sent to and recorded from. Never logged, cleared by apply_retention(), included in the data export.';

-- No new grants and no new policies: the table already grants select and insert
-- to authenticated and restricts both to the owner's own rows, and has
-- deliberately no update or delete policy. A guardian consent is withdrawn the
-- way every other consent is - by appending a row with granted = false.

-- ── 3. Retention ─────────────────────────────────────────────────────────────
--
-- A guardian's address has no purpose once the consent is old. It is not the
-- consent record itself that expires - the ledger is the audit trail and stays
-- append-only - only the contactable address inside it.
insert into public.retention_periods (category, months, note) values
  ('guardian_email', 24,
   'The guardian address on a consent record is cleared after 24 months. The consent itself is never deleted - the ledger is the audit trail - but the contact detail for a third party who never signed up does not need to outlive its purpose.')
on conflict (category) do update
  set months = excluded.months, note = excluded.note;

create or replace function private.apply_retention()
returns table (category text, affected bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  m_health int := (select rp.months from public.retention_periods rp where rp.category = 'health_restrictions');
  m_glp1   int := (select rp.months from public.retention_periods rp where rp.category = 'glp1_status');
  m_msgs   int := (select rp.months from public.retention_periods rp where rp.category = 'conversation_messages');
  m_audit  int := (select rp.months from public.retention_periods rp where rp.category = 'audit_events');
  m_usage  int := (select rp.months from public.retention_periods rp where rp.category = 'usage_events');
  m_stripe int := (select rp.months from public.retention_periods rp where rp.category = 'stripe_events');
  m_errors int := (select rp.months from public.retention_periods rp where rp.category = 'error_events');
  m_guard  int := (select rp.months from public.retention_periods rp where rp.category = 'guardian_email');
  n bigint;
begin
  update public.user_profile
     set health_restrictions = null,
         health_restrictions_updated_at = null,
         -- Not null: the column forbids it, and "has not answered yet" is false.
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

  -- The consent stays; only the third party's address goes. UPDATE rather than
  -- DELETE for exactly that reason: deleting the row would destroy the record
  -- that a guardian once agreed, which is the thing the ledger exists to keep.
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
end;
$fn$;

-- `create or replace function` silently drops these unless they are restated.
-- The deployed catalogue is the fact; this file is only the intent.
revoke all on function private.apply_retention() from public, anon, authenticated;

-- ── 4. A minor cannot join the leaderboard ───────────────────────────────────
--
-- Publishing a minor's display name and lifts to every other user is a
-- different question from publishing an adult's, and the simplest defensible
-- answer is that they cannot opt in at all.
--
-- It is enforced HERE and not only in the API for the same reason the writes go
-- through a definer function that accepts no numbers: the browser holds a real
-- JWT and can reach PostgREST directly. A rule that lives only in JavaScript is
-- a rule that a network tab can walk around.
--
-- The age is computed from the date of birth at the moment of the call, never
-- from a stored flag - a flag is correct until the morning of somebody's
-- eighteenth birthday and silently wrong afterwards.
create or replace function public.set_leaderboard_opt_in(opt_in boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  handle text;
  unit text;
  dob date;
begin
  if uid is null then
    raise exception 'set_leaderboard_opt_in() requires an authenticated caller';
  end if;

  -- Before every other check. Leaving is always available.
  if not opt_in then
    delete from public.leaderboard_entries where user_id = uid;
    return;
  end if;

  if not public.has_active_consent('leaderboard_publication') then
    raise exception 'leaderboard_consent_required'
      using hint = 'Agree to the leaderboard terms before joining.';
  end if;

  select p.display_name, p.units, p.date_of_birth into handle, unit, dob
  from public.user_profile p where p.user_id = uid;

  -- Fails closed on a missing date, like every other gate in this product.
  if dob is null or extract(year from age(current_date, dob)) < 18 then
    raise exception 'leaderboard_adults_only'
      using hint = 'The leaderboard is for lifters aged 18 and over.';
  end if;

  if handle is null then
    raise exception 'display_name_required'
      using hint = 'Choose a display name before joining the leaderboard.';
  end if;

  insert into public.leaderboard_entries (user_id, display_name, units)
  values (uid, handle, coalesce(unit, 'lb'))
  on conflict (user_id) do update set display_name = excluded.display_name;

  perform public.refresh_leaderboard_entry();
end;
$fn$;

revoke all on function public.set_leaderboard_opt_in(boolean) from anon, public;
grant execute on function public.set_leaderboard_opt_in(boolean) to authenticated;

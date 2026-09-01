-- =============================================================================
-- 0054 — Coaching 13 to 17 year olds: the database half
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
--   3. That email gets a retention period. The sweep itself is defined in 0055.
--   4. A minor cannot join the leaderboard, enforced in the database.
--
-- ── RENUMBERED FROM 0036, AND WHY THAT WAS NOT COSMETIC ─────────────────────
--
-- This was written as 0036 and never applied anywhere; main went to 0053 while
-- it sat on a branch. Renumbering it to the top is not tidiness. Migrations
-- reach production by hand, pasted into the SQL editor in the order somebody
-- opens the files, so a file numbered 0036 arriving at a database that is
-- already at 0053 runs LAST while claiming to run seventeenth.
--
-- Two things in the original would have been silently undone by that:
--
--   set_leaderboard_opt_in()  0052 put the second-factor gate inside it. This
--                             file restated the function without it.
--   apply_retention()         0053 added the training-intention sweep. This
--                             file restated the function without it.
--
-- Neither would have failed. `create or replace function` replaces rather than
-- merges and reports success either way, and a retention sweep that stops
-- clearing a column produces no error - just a column that stops being
-- cleared, behind a privacy policy that still promises it is.
--
-- Worse than either: the numbers made the two paths to a schema disagree. A
-- rebuild from this directory applies 0036 before 0052 and gets the gate; a
-- production database applies it after and loses it. The schema fingerprint
-- exists to catch exactly that divergence, and it would have caught this one
-- AFTER it shipped.
--
-- Both reversions are repaired in place below and in 0055, and each carries a
-- comment saying where it came from, because the next person reading a minors
-- migration has no reason to expect an MFA check inside it.
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
-- same treatment as everything else: minimized to one field, never logged,
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

-- ── THE NIGHTLY SWEEP IS NOT RESTATED HERE ───────────────────────────────────
--
-- The original of this migration restated private.apply_retention() in full, to
-- add the guardian_email line above. Two migrations later 0055 restates it
-- again for guardian_consent_requests, so the definition here would have lived
-- for exactly one file - and in the meantime it would have been WRONG, because
-- it was written before 0053 added the training-intention sweep and `create or
-- replace` replaces rather than merges.
--
-- The retention period above is a row, and rows accumulate. The function is a
-- definition, and definitions overwrite. So the row goes in here and the
-- function is defined once, in 0055, with every category that exists by then.
-- Nothing sweeps guardian_email between this file and that one; both are
-- pasted in the same sitting, and a column that has never been written to has
-- nothing to sweep.


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

  -- ── RESTORED FROM 0052, NOT WRITTEN HERE ──────────────────────────────────
  --
  -- This file was authored against a database at 0035. 0052 then gated this
  -- function behind the second factor, because RLS does not apply inside a
  -- SECURITY DEFINER function and a stolen password could otherwise publish an
  -- athlete's name and numbers. `create or replace function` replaces rather
  -- than merges, so pasting the original file into a database at 0052 would
  -- have taken that gate back out - and the migration that did it reads as
  -- though it only concerns minors.
  if not public.mfa_satisfied() then
    raise exception 'second factor required' using errcode = '42501';
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

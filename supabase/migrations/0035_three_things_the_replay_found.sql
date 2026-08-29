-- =============================================================================
-- 0035 — three defects found by replaying the migrations into an empty database
--
-- FOUND BY: building a second Supabase project from these 34 files and diffing
-- the result against production. Not by anything failing. Nothing here had a
-- failure signal; that is what they have in common and why they are in one
-- migration.
--
-- The diff was exact everywhere else: every column, policy, grant, constraint
-- and index matched, table for table. So these files ARE a description of
-- production rather than a history of it - except in the one place below.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. "DELETE MY ACCOUNT" WAS UNREACHABLE IN PRODUCTION
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 0007 creates `public.delete_my_account()`. Production had it in `private`,
-- with the same body and the same comment, created by no migration in this
-- directory - somebody moved it by hand, plausibly in the sweep that became
-- 0004, and the ledger has no record of it.
--
-- The consequence is not cosmetic. server/src/routes/account.js calls
-- `supabase.rpc('delete_my_account')`, and supabase-js resolves an rpc against
-- the client's schema, which is `public`. PostgREST does not expose `private`
-- and would not be asked to if it did. So the call returned PGRST202, the
-- route mapped it to `storage_unavailable`, and the athlete saw "Could not
-- delete the account."
--
-- That is the GDPR Art. 17 path, and it is a promise the privacy policy makes
-- in writing. It was broken in production and passing in every test, because
-- the tests mock `rpc` and a mock answers to any name.
--
-- Recreated here rather than moved back, so this file is the whole story and
-- runs correctly against a database in either state.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- ON DELETE CASCADE on every user-scoped table does the rest.
  delete from auth.users where id = v_user;
end;
$fn$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'GDPR Art.17 erasure. Deletes the calling user and, by cascade, all of their data. Takes no arguments; the target is auth.uid() and cannot be redirected. Must live in public: it is reached by PostgREST rpc, which cannot see the private schema.';

-- The stray copy. Dropped rather than left in place, because two functions with
-- one name and one comment is how somebody fixes the wrong one next time.
drop function if exists private.delete_my_account();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE RETENTION SWEEP WOULD HAVE THROWN THE FIRST TIME IT HAD WORK TO DO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `apply_retention()` set `cleared_to_train = null`. That column has been
-- `boolean not null default false` since 0001 and was never altered.
--
-- plpgsql does not plan a statement until it executes, so the function created
-- cleanly, the invariant checks passed, and the nightly cron job succeeded
-- every night - because no row had yet aged past the health retention period.
-- The first row that did would raise a not-null violation, and because the
-- categories run in one function with no exception handling, the abort takes
-- the whole sweep with it: conversation messages, audit events, usage events,
-- Stripe events and error events would all stop being pruned too. A retention
-- policy that fails closed on its first real day, into a cron log nobody reads.
--
-- `false` is what 0031 meant. Its own note says an athlete whose injury has
-- expired should be "treated exactly as somebody who has not answered yet", and
-- somebody who has not answered yet has `cleared_to_train = false` - that is
-- the column default. `null` was reaching for the same idea in a column that
-- cannot hold it.
--
-- Replaced in full, and `security definer` plus the pinned search_path are
-- RE-STATED, because `create or replace function` silently drops both.

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

  delete from public.stripe_events se where se.received_at < now() - make_interval(months => m_stripe);
  get diagnostics n = row_count;
  category := 'stripe_events'; affected := n; return next;

  delete from public.error_events ee where ee.created_at < now() - make_interval(months => m_errors);
  get diagnostics n = row_count;
  category := 'error_events'; affected := n; return next;
end;
$fn$;

revoke all on function private.apply_retention() from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE CONSENT GATE HAD QUIETLY STOPPED COVERING MOST OF THE HEALTH FIELDS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- From 0012 to 0032 the trigger compared `private.health_fingerprint()`, which
-- lists every column commented as health data: injuries, nutrition notes,
-- sleep, alcohol, nicotine, gender, self-described gender.
--
-- 0033 replaced the trigger with a version that reads `health_restrictions` and
-- `glp1_status` directly and never calls the fingerprint. Everything else
-- became writable with no active consent. The fingerprint stayed in the
-- database, correct and orphaned.
--
-- ── WHY THE CHECK THAT EXISTS FOR THIS DID NOT FIRE ────────────────────────
--
-- scripts/check-db-invariants.mjs asserts "every column documented as health
-- data appears in private.health_fingerprint". It kept passing, because it was
-- true: the fingerprint still listed every column. Nothing asserted that the
-- TRIGGER still called it. The check was reading the right object and asking
-- the wrong question - which is the same shape as the RLS policy with no GRANT
-- in 0021 and the rate limiter that failed open in 0022.
--
-- The invariant now also asserts the call, so the fingerprint cannot be
-- orphaned again without something going red.
--
-- ── WHAT CHANGES ──────────────────────────────────────────────────────────
--
-- The fingerprint gains `glp1_status`, which 0033 introduced and gated
-- separately. 'declined_to_say' is nullified before it is included: declining
-- to answer is not a disclosure, and treating it as one would make the polite
-- answer cost the same as the honest one.
--
-- The trigger goes back to 0013's arrangement: fingerprint-based, and SECURITY
-- DEFINER because `authenticated` has no USAGE on the private schema and
-- cannot call the helper. 0033 dropped back to SECURITY INVOKER, which was
-- survivable only because it had stopped calling the helper at all.

create or replace function private.health_fingerprint(p public.user_profile)
returns text
language sql
immutable
set search_path to ''
as $$
  select nullif(concat_ws('|',
    nullif(btrim(coalesce(p.health_restrictions, '')), ''),
    nullif(btrim(coalesce(p.nutrition_notes, '')), ''),
    p.sleep_hours_typical::text,
    p.alcohol_units_per_week::text,
    nullif(p.nicotine_use, ''),
    nullif(p.gender, ''),
    nullif(btrim(coalesce(p.gender_self_described, '')), ''),
    -- Declining to answer is not a disclosure. See 0033.
    nullif(p.glp1_status, 'declined_to_say')
  ), '');
$$;

comment on function private.health_fingerprint(public.user_profile) is
  'Every column commented "Health data." reduced to one value. The consent trigger compares it; scripts/check-db-invariants.mjs asserts both that the list is complete and that the trigger still calls this function.';

create or replace function private.require_health_data_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_incoming text := private.health_fingerprint(new);
begin
  -- Clearing every health field, or never setting one, needs no consent.
  -- Withdrawal must never be blocked by the absence of the thing withdrawn.
  if v_incoming is null then return new; end if;

  -- An unrelated update that leaves the health fields exactly as they were is
  -- not a new collection event. Changing a bodyweight must not require
  -- re-consent.
  if tg_op = 'UPDATE'
     and private.health_fingerprint(old) is not distinct from v_incoming then
    return new;
  end if;

  -- No authenticated caller means a migration, a cron job or an admin path.
  -- Those are not end-user collection and are not what this guards.
  if auth.uid() is null then return new; end if;

  if not public.has_active_consent('health_data_collection') then
    raise exception 'health data cannot be stored without active health_data_collection consent'
      using errcode = '42501',
            hint = 'Record consent via POST /api/consent before writing health or lifestyle fields.';
  end if;

  return new;
end;
$fn$;

-- The trigger is invoked by the executor, not by a caller. Nothing should be
-- able to call it directly, and SECURITY DEFINER makes that worth saying.
revoke all on function private.require_health_data_consent() from public, anon, authenticated;

comment on function private.require_health_data_consent() is
  'Refuses a health-data write without current health_data_collection consent. SECURITY DEFINER because authenticated cannot reach private.health_fingerprint - see 0013, and see 0035 for what happened when that arrangement was undone.';

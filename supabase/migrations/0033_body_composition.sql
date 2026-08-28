-- =============================================================================
-- 0033_body_composition.sql
--
-- Two additions for people who want the barbell without the platform: a
-- body-composition goal, and a field recording whether they are using a GLP-1.
--
-- ── THE SECOND ONE IS MEDICATION DATA ───────────────────────────────────────
--
-- Which means it is health information, and the whole apparatus built for
-- health_restrictions has to cover it or it is a hole with a comment over it:
-- consent before storage, redaction from logs, retention, disclosure in the
-- policy, and exclusion from anywhere it is not needed.
--
-- The consent trigger from 0008 guards ONE column by name. It was written when
-- there was one health field, and it fails open for a second: a new column
-- would be writable with no health_data_collection consent at all, silently,
-- because the trigger simply would not be looking at it. Extended below, and
-- written so the next field is an entry in a list rather than a rewrite.
--
-- ── WHY 'CONSIDERING' IS ONE OF THE VALUES ──────────────────────────────────
--
-- Because it is a real state a lot of people are in, and because it changes
-- what the coach should say - which is NOT whether to take the drug. That is a
-- conversation with a prescriber and the coach is told so in the prompt. What
-- it changes is that somebody weighing it up benefits from knowing what
-- resistance training does either way, and somebody already taking one has a
-- specific, evidenced problem worth solving: 25-39% of weight lost on GLP-1
-- therapy is lean mass, and lifting two to three times a week cuts that loss
-- by 30-50% without slowing fat loss.
-- =============================================================================

-- ── The goal enum lives in FOUR places, and profileOptions.test.js knows it ──
--
-- The form, the zod schema, the i18n labels and this CHECK constraint. Adding
-- the option to three of them failed that test with "the form offers
-- body_composition and the database refuses it", which is exactly the error
-- somebody would otherwise have met as a 500 on submit.
alter table public.user_profile
  drop constraint if exists user_profile_goal_check;

alter table public.user_profile
  add constraint user_profile_goal_check
  check (goal is null or goal in (
    'learn_the_lifts',
    'general_strength',
    'return_from_layoff',
    'body_composition',
    'first_meet',
    'meet_prep'
  ));

alter table public.user_profile
  add column if not exists glp1_status text
    check (glp1_status is null or glp1_status in ('none', 'using', 'considering', 'declined_to_say'));

comment on column public.user_profile.glp1_status is
  'Whether the athlete uses, is considering, or does not use a GLP-1 medication. HEALTH DATA: consent-gated, log-redacted, expires with the other health fields. Recorded so the coaching can protect lean mass, never so the app can have an opinion about the medication.';

-- Its own timestamp, same reasoning as health_restrictions in 0031: expiring on
-- user_profile.updated_at would reset the clock whenever any other field moved.
alter table public.user_profile
  add column if not exists glp1_status_updated_at timestamptz;

create or replace function private.stamp_health_restrictions()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.health_restrictions is not null then
      new.health_restrictions_updated_at := now();
    end if;
    if new.glp1_status is not null then
      new.glp1_status_updated_at := now();
    end if;
  else
    if new.health_restrictions is distinct from old.health_restrictions then
      new.health_restrictions_updated_at :=
        case when new.health_restrictions is null then null else now() end;
    end if;
    if new.glp1_status is distinct from old.glp1_status then
      new.glp1_status_updated_at :=
        case when new.glp1_status is null then null else now() end;
    end if;
  end if;
  return new;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- The consent gate, now covering every health field rather than one.
--
-- 'declined_to_say' is deliberately NOT treated as health data: it is the
-- absence of an answer, and requiring consent to record that somebody declined
-- would mean the only way to decline is to consent first.
-- ----------------------------------------------------------------------------
create or replace function private.require_health_data_consent()
returns trigger language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_restrictions text := nullif(btrim(coalesce(new.health_restrictions, '')), '');
  v_glp1 text := nullif(new.glp1_status, 'declined_to_say');
  v_new_health boolean := false;
begin
  if tg_op = 'INSERT' then
    v_new_health := v_restrictions is not null or v_glp1 is not null;
  else
    v_new_health :=
      (v_restrictions is not null
        and nullif(btrim(coalesce(old.health_restrictions, '')), '') is distinct from v_restrictions)
      or (v_glp1 is not null
        and nullif(old.glp1_status, 'declined_to_say') is distinct from v_glp1);
  end if;

  if not v_new_health then return new; end if;

  -- No authenticated caller means a migration or an admin path, which is not
  -- what this guards. Unchanged from 0008.
  if auth.uid() is null then return new; end if;

  if not public.has_active_consent('health_data_collection') then
    raise exception 'health data cannot be stored without active health_data_collection consent'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- Retention: the new field expires with the old one.
--
-- Same period, same reasoning - a medication status from two years ago is as
-- misleading as an injury from two years ago, and the coach should ask rather
-- than assume.
-- ----------------------------------------------------------------------------
insert into public.retention_periods (category, months, note) values
  ('glp1_status', 12,
   'Whether somebody uses a GLP-1 medication is cleared 12 months after it last changed, and the coach asks again rather than assuming a two-year-old answer still holds.')
on conflict (category) do update set months = excluded.months, note = excluded.note;

create or replace function private.apply_retention()
returns table (category text, affected bigint)
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  m_health int := (select rp.months from public.retention_periods rp where rp.category = 'health_restrictions');
  m_glp1   int := (select rp.months from public.retention_periods rp where rp.category = 'glp1_status');
  m_msgs   int := (select rp.months from public.retention_periods rp where rp.category = 'conversation_messages');
  m_audit  int := (select rp.months from public.retention_periods rp where rp.category = 'audit_events');
  m_usage  int := (select rp.months from public.retention_periods rp where rp.category = 'usage_events');
  m_stripe int := (select rp.months from public.retention_periods rp where rp.category = 'stripe_events');
  n bigint;
begin
  update public.user_profile
     set health_restrictions = null,
         health_restrictions_updated_at = null,
         cleared_to_train = null
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
end;
$fn$;

revoke all on function private.apply_retention() from anon, authenticated, public;

-- The health policy now describes a medication field, so it moves again and
-- everybody is asked to agree. Second bump in a day; that is what an
-- append-only consent ledger and an honest policy cost, and it is cheap.
update public.policy_versions
   set version = 'chd-2026-08-28b', effective_at = now()
 where consent_type = 'health_data_collection';

-- The AI processing policy now lists the medication field among what is sent,
-- so it moves too. Two documents, two versions, one ask.
update public.policy_versions
   set version = 'aip-2026-08-28a', effective_at = now()
 where consent_type = 'ai_processing';

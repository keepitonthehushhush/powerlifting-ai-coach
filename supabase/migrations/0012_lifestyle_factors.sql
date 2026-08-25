-- =============================================================================
-- 0012_lifestyle_factors.sql
--
-- Recovery inputs the coach should know about: sleep, alcohol, nicotine, and
-- how the athlete is eating.
--
-- THESE ARE HEALTH DATA, AND THE CONSENT TRIGGER MUST KNOW IT. Washington's
-- My Health My Data Act defines consumer health data as information linked to
-- "past, present or future physical or mental health status". How much someone
-- drinks and whether they use nicotine are squarely inside that, and so is a
-- statement that they do neither.
--
-- The trigger from migration 0008 guarded exactly one column. Adding these
-- fields without extending it would have created the precise hole that trigger
-- exists to close: consumer health data collected with no consent on file, and
-- nothing in the system noticing. The columns and the guard therefore ship in
-- the same migration - separating them would leave a window where the schema
-- can hold data the policy has not authorised.
--
-- The fingerprint approach replaces the old single-column comparison. It has a
-- property worth stating: adding a health column later and forgetting to list
-- it here silently un-guards it. That is a real footgun, so the RLS test suite
-- asserts the fingerprint covers every column this migration knows about, and
-- will fail if the two drift.
-- =============================================================================

alter table public.user_profile
  add column if not exists sleep_hours_typical    numeric(3,1),
  add column if not exists alcohol_units_per_week integer,
  add column if not exists nicotine_use           text,
  add column if not exists nutrition_notes        text;

-- Ranges are wide on purpose. A constraint here is a data-quality guard, not a
-- judgement about anybody's habits, and a value the athlete reports honestly
-- must never be rejected for being unflattering.
alter table public.user_profile
  drop constraint if exists user_profile_sleep_hours_typical_check,
  add  constraint user_profile_sleep_hours_typical_check
       check (sleep_hours_typical is null or (sleep_hours_typical >= 0 and sleep_hours_typical <= 24));

alter table public.user_profile
  drop constraint if exists user_profile_alcohol_units_per_week_check,
  add  constraint user_profile_alcohol_units_per_week_check
       check (alcohol_units_per_week is null or (alcohol_units_per_week >= 0 and alcohol_units_per_week <= 200));

alter table public.user_profile
  drop constraint if exists user_profile_nicotine_use_check,
  add  constraint user_profile_nicotine_use_check
       check (nicotine_use is null or nicotine_use in ('none','occasional','daily'));

comment on column public.user_profile.sleep_hours_typical is
  'Health data. Typical nightly sleep in hours. Gated by health_data_collection consent.';
comment on column public.user_profile.alcohol_units_per_week is
  'Health data. Self-reported standard drinks per week. Gated by health_data_collection consent.';
comment on column public.user_profile.nicotine_use is
  'Health data. none | occasional | daily. Gated by health_data_collection consent.';
comment on column public.user_profile.nutrition_notes is
  'Health data. Free text about how the athlete eats. Gated by health_data_collection consent.';

-- --- the guard ---------------------------------------------------------------

-- Every column on user_profile that constitutes consumer health data, in one
-- place. Anything listed here requires active consent before it can be stored.
create or replace function private.health_fingerprint(p public.user_profile)
returns text
language sql
immutable
set search_path to ''
as $$
  -- concat_ws skips NULL arguments, so an all-NULL row yields '' and nullif
  -- turns that into NULL: "this write carries no health data".
  select nullif(concat_ws('|',
    nullif(btrim(coalesce(p.health_restrictions, '')), ''),
    nullif(btrim(coalesce(p.nutrition_notes, '')), ''),
    p.sleep_hours_typical::text,
    p.alcohol_units_per_week::text,
    nullif(p.nicotine_use, '')
  ), '');
$$;

create or replace function private.require_health_data_consent()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_incoming text := private.health_fingerprint(new);
begin
  -- Clearing every health field, or never setting one, needs no consent.
  -- Withdrawal must never be blocked by the absence of the thing withdrawn.
  if v_incoming is null then
    return new;
  end if;

  -- An unrelated update that leaves the health fields exactly as they were is
  -- not a new collection event. Changing bodyweight must not require re-consent.
  if tg_op = 'UPDATE'
     and private.health_fingerprint(old) is not distinct from v_incoming then
    return new;
  end if;

  -- Service role and migrations run with a null auth.uid(). They are not
  -- end-user collection and are not gated here.
  if auth.uid() is null then
    return new;
  end if;

  if not public.has_active_consent('health_data_collection') then
    raise exception
      'health data cannot be stored without active health_data_collection consent'
      using errcode = 'check_violation',
            hint = 'Record consent via POST /api/consent before writing health or lifestyle fields.';
  end if;

  return new;
end;
$$;

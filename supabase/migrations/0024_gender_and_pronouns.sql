-- =============================================================================
-- 0024 — gender, and how to address somebody
--
-- ── TWO FIELDS, DELIBERATELY, AND THEY ARE TREATED DIFFERENTLY ───────────────
--
-- `pronouns` is how the coach should refer to this person. It is NOT health
-- data and is NOT behind the health consent, because gating how somebody is
-- addressed behind an optional consent would mean a non-binary athlete who
-- declines health-data collection gets misgendered by the product for their
-- trouble. Being addressed correctly is not a feature you should have to trade
-- privacy for.
--
-- `gender` IS treated as consumer health data and sits behind the health
-- consent with the injury and lifestyle fields. Washington's MHMDA names
-- gender-affirming care information explicitly, and while identity alone is
-- arguably outside the plain reading, this codebase has been conservative
-- everywhere else and there is no reason to stop here. It is optional, the
-- product works without it, and "prefer not to say" is a first-class answer
-- rather than an absence.
--
-- ── PRONOUNS ARE NOT DERIVED FROM GENDER, AND GENDER IS NOT DERIVED FROM ─────
-- ── ANYTHING ────────────────────────────────────────────────────────────────
--
-- They are separate columns because they are separate facts. Inferring one
-- from the other is the exact mistake this is meant to avoid, and it is also
-- simply wrong often enough to matter.
--
-- Nothing in the application infers physiology from either. Where a number
-- genuinely differs - the energy availability floor is the only one in this
-- product, 25 vs 30 kcal/kg FFM - the conservative figure is used and the
-- coach is told to ask rather than to assume. A trans man may menstruate, a
-- trans woman may not, and a post-menopausal woman is a different case again;
-- a category label answers none of those and pretending it does would be worse
-- than not asking.
-- =============================================================================

alter table public.user_profile
  add column if not exists gender                text,
  add column if not exists gender_self_described text,
  add column if not exists pronouns              text;

alter table public.user_profile
  add constraint gender_known check (
    gender is null or gender in ('woman','man','nonbinary','self_described','prefer_not_to_say')
  );

-- Bounded, because both are free text that reaches a prompt.
alter table public.user_profile
  add constraint gender_self_described_length
    check (gender_self_described is null or length(gender_self_described) <= 60);
alter table public.user_profile
  add constraint pronouns_length
    check (pronouns is null or length(pronouns) <= 40);

comment on column public.user_profile.gender is
  'Health data. woman | man | nonbinary | self_described | prefer_not_to_say. Gated by health_data_collection consent.';
comment on column public.user_profile.gender_self_described is
  'Health data. Free text, meaningful only when gender = self_described. Gated by health_data_collection consent.';
comment on column public.user_profile.pronouns is
  'How to refer to this athlete, e.g. "she/her", "they/them". Deliberately NOT health data and NOT consent-gated: being addressed correctly must not be something a person trades privacy for.';

-- ── THE CONSENT TRIGGER HAS TO LEARN ABOUT THEM ──────────────────────────────
--
-- private.health_fingerprint is what the trigger compares to decide whether a
-- write carries health data. A column documented as health data and absent
-- from this function would be gated in the comment and ungated in fact - which
-- is precisely what supabase/tests asserts against, and why that assertion
-- exists.
--
-- pronouns is NOT added, on purpose. See the note at the top.
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
    nullif(btrim(coalesce(p.gender_self_described, '')), '')
  ), '');
$$;

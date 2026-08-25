-- =============================================================================
-- 0015_date_of_birth.sql
--
-- Age, which the product needs for two unrelated reasons.
--
-- 1. PROGRAMMING. A 15-year-old and a 55-year-old with identical numbers do not
--    get the same block. Recovery capacity, appropriate rate of progression and
--    the wisdom of maximal singles all move with age, and the coach currently
--    has no idea which it is talking to.
--
-- 2. ELIGIBILITY. Until a parental-consent path exists, an under-18 athlete
--    cannot lawfully have health data collected from them here. That gate needs
--    an age to act on.
--
-- WHY DATE OF BIRTH AND NOT AN AGE. An age is wrong within a year of being
-- stored and silently wrong forever after. A birth date stays true, and lets a
-- 17-year-old become eligible on the correct day without anyone re-asking.
--
-- WHY THIS IS NOT IN THE HEALTH FINGERPRINT. It is personal data and is
-- protected as such, but it is not a statement about health status, so it is
-- not consumer health data under MHMDA and does not belong behind the
-- health_data_collection consent. Putting it there would be worse, not safer:
-- the gate would then require consent before it could determine eligibility to
-- give consent.
--
-- The CHECK bounds are a data-quality guard, not a policy. Policy lives in one
-- place - server/src/lib/ageGate.js - because a rule with legal weight should
-- be readable, testable, and not scattered across a schema constraint.
-- =============================================================================

alter table public.user_profile
  add column if not exists date_of_birth date;

alter table public.user_profile
  drop constraint if exists user_profile_date_of_birth_check,
  add  constraint user_profile_date_of_birth_check
       check (
         date_of_birth is null
         or (date_of_birth > date '1900-01-01' and date_of_birth <= current_date)
       );

comment on column public.user_profile.date_of_birth is
  'Personal data, not health data: a birth date is not a statement about health status, so it sits outside private.health_fingerprint() and the consent gate on purpose. Used for age-appropriate programming and for eligibility.';

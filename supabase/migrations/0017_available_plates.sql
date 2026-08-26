-- =============================================================================
-- 0017_available_plates.sql
--
-- The smallest plate the athlete can actually put on a bar.
--
-- Progression prescribes a jump; a jump the lifter cannot load is not a
-- prescription, it is homework. Adding weight means adding it to both ends, so
-- the smallest possible increment is twice the smallest plate they own.
--
-- This is not a nicety. Rippetoe is explicit that plates below the standard
-- 2.5 lb become necessary "for women almost immediately and for every lifter
-- eventually" — an athlete whose gym stops at 5 lb plates has a hard floor of
-- 10 lb per jump and will exhaust linear progression early for a reason that
-- has nothing to do with their body. The coach should know that and say so.
--
-- Deliberately NOT health data: what plates a gym stocks says nothing about
-- the person. It carries no 'Health data.' comment, so the consent trigger's
-- fingerprint does not cover it and the structural test in
-- rls_isolation_test.sql will not expect it to.
-- =============================================================================

alter table public.user_profile
  add column smallest_plate_pair numeric(5,3)
    check (smallest_plate_pair is null or (smallest_plate_pair > 0 and smallest_plate_pair <= 25));

comment on column public.user_profile.smallest_plate_pair is
  'Equipment. The smallest single plate available to the athlete, in their own units. The smallest loadable increment is twice this.';

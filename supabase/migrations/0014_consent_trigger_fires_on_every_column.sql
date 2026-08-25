-- =============================================================================
-- 0014_consent_trigger_fires_on_every_column.sql
--
-- Closes the second half of the 0012 mistake, and the more serious half.
--
-- WHAT WAS WRONG. Migration 0008 created the guard as:
--
--     create trigger user_profile_require_health_consent
--       before insert or update OF health_restrictions on public.user_profile
--
-- That column list was correct when exactly one column held health data. 0012
-- added four more - sleep, alcohol, nicotine, nutrition - and replaced the
-- trigger FUNCTION to cover them, but never touched the TRIGGER. A trigger
-- declared `update of health_restrictions` does not fire when only the other
-- four change.
--
-- So updating alcohol, sleep, nicotine or nutrition stored consumer health
-- data without the consent check ever running. INSERT was still covered - a
-- column list does not apply to INSERT - but the application upserts, and for
-- an existing profile row that is an UPDATE. Every route a real user takes was
-- through the hole.
--
-- This is worse than the permission bug 0013 fixed. That one was loud: intake
-- failed and nobody could save anything. This one was silent, and silent is
-- the failure mode that matters for a control whose whole job is to be there
-- when nobody is looking.
--
-- WHY THE TESTS DID NOT CATCH IT. The unit tests read the migration's TEXT and
-- assert the fingerprint function lists every health column. It does. They
-- cannot see that the trigger which CALLS that function is scoped to one
-- column - that fact lives in pg_trigger, not in any file.
--
-- `supabase/tests/rls_isolation_test.sql` performs exactly these four updates
-- and asserts each raises. It would have caught this on the first run. It has
-- never been run against a database, because it needs a psql connection and is
-- not part of `npm run check`. Two bugs in one migration have now been missed
-- for that single reason.
--
-- THE FIX. Drop the column list. The trigger fires on every insert and update,
-- and the function decides - it already returns immediately when the health
-- fingerprint is unchanged, so an unrelated update costs one comparison of a
-- short string.
--
-- That trade is deliberate. The column list was an optimisation; correctness
-- here depends on remembering to extend it every time a health column is
-- added, and that is exactly the kind of remembering this project has now got
-- wrong once. Firing always and deciding in one place cannot rot: a health
-- column added next year is covered the moment it is listed in
-- private.health_fingerprint(), which is the one place that already has to
-- know.
-- =============================================================================

drop trigger if exists user_profile_require_health_consent on public.user_profile;

create trigger user_profile_require_health_consent
  before insert or update on public.user_profile
  for each row
  execute function private.require_health_data_consent();

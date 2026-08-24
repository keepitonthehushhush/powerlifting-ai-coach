-- =============================================================================
-- 0009_deny_by_default_table_privileges.sql
--
-- Found while testing the consent ledger. The test asserted that a user cannot
-- rewrite their own consent history; the UPDATE succeeded.
--
-- Cause: Supabase ships ALTER DEFAULT PRIVILEGES granting ALL on new tables in
-- `public` to both anon and authenticated. So `grant select, insert on
-- consent_records to authenticated` was not a restriction - it was a no-op on
-- top of a blanket grant that already included UPDATE, DELETE and TRUNCATE.
-- And because that table was created after migration 0002's one-time
-- `revoke all ... from anon`, anon held privileges on it too.
--
-- RLS was still holding: no UPDATE policy exists on consent_records, so the
-- statement matched zero rows rather than rewriting history. But that is one
-- layer of defence doing the work of two, and the failure was silent - an
-- UPDATE affecting zero rows returns success.
--
-- GENERALISABLE LESSON: a one-time REVOKE does not protect tables created by
-- later migrations. Change the default, or every future table silently
-- reopens the hole.
-- =============================================================================

-- 1. Stop it at the source: new tables get nothing automatically.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- 2. Clear what was already handed out, to both roles this time.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 3. Re-grant exactly what each table needs. anon gets nothing anywhere.
grant select, insert, update, delete on
  public.user_profile,
  public.workout_programs,
  public.workout_sessions,
  public.progress_logs,
  public.conversations
to authenticated;

grant select on public.exercise_library to authenticated;

-- Append-only ledger: no UPDATE, no DELETE.
grant select, insert on public.consent_records to authenticated;

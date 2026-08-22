-- =============================================================================
-- 0007_self_service_account_deletion.sql
--
-- Right to erasure (GDPR Art. 17), without introducing an admin credential.
--
-- Deleting a row from auth.users normally requires the service role key, which
-- bypasses RLS on every table. Adding that key to the environment just to
-- support "delete my account" would undo the central decision of this
-- architecture (ADR-1) for the sake of one endpoint.
--
-- Instead: one narrowly-scoped SECURITY DEFINER function that can delete
-- exactly one row - the caller's own. It takes no arguments at all, so there
-- is no parameter to manipulate; the target is derived solely from auth.uid().
-- =============================================================================

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- ON DELETE CASCADE on every user-scoped table does the rest. Verified in
  -- supabase/tests/rls_isolation_test.sql: zero residual rows afterwards.
  delete from auth.users where id = v_user;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'GDPR Art.17 erasure. Deletes the calling user and, by cascade, all of their data. Takes no arguments; the target is auth.uid() and cannot be redirected.';

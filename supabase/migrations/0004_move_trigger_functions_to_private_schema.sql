-- =============================================================================
-- 0004_move_trigger_functions_to_private_schema.sql
--
-- The Supabase security linter flagged public.handle_new_user() and
-- public.set_updated_at(). Anything living in `public` is automatically
-- exposed by PostgREST as /rest/v1/rpc/<name>, so both SECURITY DEFINER
-- functions were reachable from the open internet by both the anon and the
-- authenticated role.
--
-- In practice a trigger function invoked directly raises
-- "can only be called as trigger", so this was very likely unexploitable.
-- That is not a good enough reason to leave it: a SECURITY DEFINER function
-- reachable from the internet is a standing invitation, and the fix costs
-- one migration. Move them to a schema PostgREST does not serve.
-- =============================================================================

create schema if not exists private;

revoke all on schema private from anon, authenticated, public;
grant usage on schema private to postgres, service_role;

drop trigger if exists on_auth_user_created         on auth.users;
drop trigger if exists user_profile_set_updated_at  on public.user_profile;
drop trigger if exists conversations_set_updated_at on public.conversations;

drop function if exists public.handle_new_user();
drop function if exists public.set_updated_at();

create function private.set_updated_at()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.user_profile (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.set_updated_at()  from anon, authenticated, public;
revoke all on function private.handle_new_user() from anon, authenticated, public;

create trigger user_profile_set_updated_at
  before update on public.user_profile
  for each row execute function private.set_updated_at();

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function private.set_updated_at();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

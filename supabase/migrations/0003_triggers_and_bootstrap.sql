-- =============================================================================
-- 0003_triggers_and_bootstrap.sql
-- Automatic row maintenance.
--
-- Both functions are SECURITY DEFINER with `set search_path = ''`. SECURITY
-- DEFINER is required because the trigger on auth.users runs in the auth
-- system's context, not the new user's. The empty search_path is the important
-- half: without it, a SECURITY DEFINER function resolves unqualified names
-- against the caller's search_path, which is a classic privilege-escalation
-- vector. Every object reference below is therefore fully schema-qualified.
-- =============================================================================

-- --- touch updated_at on write ---------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger user_profile_set_updated_at
  before update on public.user_profile
  for each row execute function public.set_updated_at();

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- --- create a profile row the moment a user signs up ------------------------
-- Doing this in the database rather than in application code means a profile
-- row cannot fail to exist. The alternative - having the client insert it
-- after signup - has a window where a crashed or abandoned request leaves an
-- auth user with no profile, and every downstream query has to defend against
-- that. Enforce the invariant where the data lives.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profile (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

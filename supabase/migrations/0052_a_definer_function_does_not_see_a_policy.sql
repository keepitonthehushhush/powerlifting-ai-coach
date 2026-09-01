-- =============================================================================
-- 0052_a_definer_function_does_not_see_a_policy.sql
--
-- 0050 put a restrictive RLS policy on every table holding personal or health
-- data, and proved it: the same account at aal1 sees zero rows in all of them
-- and every row at aal2.
--
-- RLS does not apply to a SECURITY DEFINER function. That is the entire point
-- of one - it runs with the owner's rights so it can do something the caller
-- cannot - and it means the gate 0050 installed is invisible to every RPC in
-- this schema. Found by reading the database linter after the deploy, not by
-- anything failing: the policies were correct, the functions were correct, and
-- the hole was between them.
--
-- The browser holds a real JWT and can call these directly at
-- /rest/v1/rpc/<name>. So with MFA turned on and a stolen password, an aal1
-- session could not read a single row of an athlete's training history - and
-- could still delete the entire account.
--
-- ── WHICH ONES, AND WHY NOT ALL OF THEM ─────────────────────────────────────
--
-- delete_my_account()          gated. Irreversible, and the most valuable
--                              thing an attacker with a password could do.
-- set_leaderboard_opt_in()     gated. Publishes an athlete's name and numbers
--                              to a surface other people read.
--
-- Deliberately NOT gated, each for a reason:
--
-- refresh_leaderboard_entry()  Recomputes the caller's own already-published
--                              row from the caller's own logs. It publishes
--                              nothing new and does nothing at all for
--                              somebody who has not opted in.
-- my_leaderboard_entry()       Reads the caller's own published row - already
--                              public to everybody by design.
-- record_error_event, record_client_error_event, record_auth_failure,
-- record_audit_event           Diagnostics. A session in the middle of a
--                              step-up is exactly the session most likely to
--                              hit a problem, and a control that blinds the
--                              error log during the state it created is a
--                              control that hides its own defects.
-- consume_rate_limit()         Refusing it would fail open on rate limiting,
--                              which trades a small risk for a larger one.
--
-- ── THE BODIES BELOW ARE COPIES ─────────────────────────────────────────────
--
-- `create or replace` needs the whole function, so each body here was read out
-- of pg_get_functiondef on PRODUCTION and is reproduced with one guard added
-- and nothing else changed - including `set search_path to ''` on
-- delete_my_account, which is why every reference in it is schema-qualified.
-- Copying from the migration files instead would have re-applied whatever the
-- files say and silently reverted any later fix. The catalogue is the fact.
-- =============================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- A definer function does not see the policies from 0050, so it asks.
  -- Deleting an account is irreversible and is the one operation where a
  -- password alone must not be enough once somebody has said it is not.
  if not public.mfa_satisfied() then
    raise exception 'second factor required' using errcode = '42501';
  end if;

  -- ON DELETE CASCADE on every user-scoped table does the rest.
  delete from auth.users where id = v_user;
end;
$function$;

create or replace function public.set_leaderboard_opt_in(opt_in boolean)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
  handle text;
  unit text;
begin
  if uid is null then
    raise exception 'set_leaderboard_opt_in() requires an authenticated caller';
  end if;

  -- Joining publishes a name and numbers where other people read them, and
  -- leaving is a privacy decision. Neither should turn on a password alone
  -- once the account holder has asked for a second factor.
  if not public.mfa_satisfied() then
    raise exception 'second factor required' using errcode = '42501';
  end if;

  if not opt_in then
    delete from public.leaderboard_entries where user_id = uid;
    return;
  end if;

  if not public.has_active_consent('leaderboard_publication') then
    raise exception 'leaderboard_consent_required'
      using hint = 'Agree to the leaderboard terms before joining.';
  end if;

  select p.display_name, p.units into handle, unit
  from public.user_profile p where p.user_id = uid;

  if handle is null then
    raise exception 'display_name_required'
      using hint = 'Choose a display name before joining the leaderboard.';
  end if;

  insert into public.leaderboard_entries (user_id, display_name, units)
  values (uid, handle, coalesce(unit, 'lb'))
  on conflict (user_id) do update set display_name = excluded.display_name;

  perform public.refresh_leaderboard_entry();
end;
$function$;

-- ── THE GRANTS ARE RESTATED, NOT ASSUMED ───────────────────────────────────
--
-- `create or replace` keeps the existing grants, so on the live databases
-- these lines change nothing. They are here because a database rebuilt from
-- this directory has no existing grants to keep, and the newest migration
-- defining a function is the only one that describes it - a rebuild that
-- stopped at 0052 would otherwise leave both functions executable by whatever
-- Postgres defaults to rather than by what this project decided.
--
-- server/test/erasure.test.js asserts exactly this, by reading the newest
-- migration that defines delete_my_account. It caught the omission.
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

revoke all on function public.set_leaderboard_opt_in(boolean) from public, anon;
grant execute on function public.set_leaderboard_opt_in(boolean) to authenticated;

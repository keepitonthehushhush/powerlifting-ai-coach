-- =============================================================================
-- 0013_consent_trigger_can_reach_its_helper.sql
--
-- Fixes a bug introduced by 0012 that made intake impossible.
--
-- WHAT BROKE. 0012 refactored the consent trigger to compare a fingerprint of
-- every health column instead of one field, and moved that computation into a
-- helper, `private.health_fingerprint()`. The trigger function is SECURITY
-- INVOKER, so its body executes as `authenticated` - and `authenticated` has
-- no USAGE on the `private` schema, deliberately, since migration 0004 put
-- those functions there precisely so signed-in users cannot reach them.
--
-- So every write carrying health data failed with:
--
--     42501: permission denied for schema private
--
-- which the API reported as a generic "Could not save your profile." Intake
-- had never once succeeded.
--
-- WHY IT PASSED EVERY CHECK. The migration applied cleanly, because DDL runs
-- as the migration role, which does have that access. The failure only exists
-- at trigger-execution time, as the invoking user. Nothing in `npm run check`
-- touches a database - the unit tests read the migration's TEXT to confirm the
-- fingerprint lists every health column, which it does. The file was correct
-- and unrunnable, and a test that reads SQL rather than executing it cannot
-- tell those apart.
--
-- `supabase/tests/rls_isolation_test.sql` WOULD have caught it: it performs
-- exactly this write as `authenticated`. It has never been run against this
-- database. That is the actual gap, and it is recorded in docs/BUILD_LOG.md
-- rather than papered over here.
--
-- THE FIX, AND WHY THIS ONE. The trigger becomes SECURITY DEFINER, so its body
-- runs as the owner and can consult a helper that lives in a schema the caller
-- cannot see. The alternative - granting `authenticated` USAGE on `private` -
-- would hand every signed-in user the internals that 0004 deliberately hid, to
-- solve a problem that is entirely internal to the trigger.
--
-- SECURITY DEFINER is a real escalation and is justified narrowly:
--
--   * `set search_path to ''` is already set, which is the essential hardening:
--     every reference is schema-qualified, so no caller-controlled search_path
--     can substitute a different function.
--   * The function lives in `private`, so PostgREST does not expose it. It is
--     not callable over the API; the only caller is the trigger itself.
--   * It takes no arguments from the caller. Its inputs are NEW and OLD, which
--     the database supplies.
--   * Running as owner does NOT widen what it can see about other users:
--     `public.has_active_consent()` filters on `auth.uid()` explicitly rather
--     than relying on RLS, and `auth.uid()` reads the request's verified JWT
--     claim, not the current role. A definer-rights trigger therefore still
--     answers "has THIS caller consented", which is the whole question.
--
-- `private.health_fingerprint()` stays SECURITY INVOKER. It is only ever
-- called from the definer-rights trigger, so it needs no privileges of its
-- own, and leaving it invoker keeps the escalation to exactly one function.
-- =============================================================================

create or replace function private.require_health_data_consent()
returns trigger
language plpgsql
security definer
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
  -- not a new collection event. Changing bodyweight must not require
  -- re-consent.
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

-- Belt and braces. A trigger fires its function without consulting EXECUTE
-- privilege, so nothing needs to hold it - and a SECURITY DEFINER function
-- that nobody can call directly is a smaller target than one that anybody can.
revoke all on function private.require_health_data_consent() from public;

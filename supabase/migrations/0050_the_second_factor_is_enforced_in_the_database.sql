-- =============================================================================
-- 0050_the_second_factor_is_enforced_in_the_database.sql
--
-- Supabase's own guidance, quoted because it is the reason this file exists:
-- "Adding MFA to your app's UI does not in-and-of-itself offer a higher level
-- of security to your users. You also need to enforce the MFA rules in your
-- application's database, APIs, and server-side rendering."
--
-- The browser decides what to render. The API refuses an aal1 token when the
-- account has a verified factor. Both are code that can be wrong, and this
-- project has a rule about controls that assume the code running is the code
-- we shipped. This is the layer that holds when they are.
--
-- ── OPT-IN, NOT BLANKET, AND THAT IS THE WHOLE DESIGN ───────────────────────
--
-- The policy demands aal2 ONLY from accounts that have a verified factor.
-- Everybody else keeps both levels. Written the other way round - require
-- aal2 from everyone - it would lock every existing athlete out of their own
-- health record the moment it was applied, with no way back in, because
-- enrolling requires being signed in.
--
-- ── WHY A FUNCTION AND NOT THE SUBQUERY IN TEN POLICIES ─────────────────────
--
-- Ten copies of one rule is ten chances for one of them to drift, and the one
-- that drifts is the one nobody reads again. It is also the difference
-- between a fix and a rewrite the day the rule changes.
--
-- SECURITY DEFINER because auth.mfa_factors is not readable by `authenticated`.
-- It takes no arguments and keys entirely on auth.uid(), so there is no
-- version of calling it that asks about somebody else.
--
-- ── WHICH TABLES, AND THE TWO DELIBERATE OMISSIONS ──────────────────────────
--
-- Everything holding personal, health or training data. Two are left out on
-- purpose:
--
--   error_events      - a browser in the middle of a step-up may be exactly
--                       the browser that crashes, and a control that blinds
--                       the crash reporter during the state it created is a
--                       control that hides its own defects.
--   user_preferences  - the theme. 0045 exists precisely because that is not
--                       health data, and locking it would mean the sign-in
--                       screen loses its palette for no security gain.
--
-- ── THE LOCKOUT THIS CREATES, STATED PLAINLY ────────────────────────────────
--
-- Once an athlete verifies a factor, losing their authenticator locks them
-- out of their own data, and Supabase requires an aal2 session to unenroll -
-- so they cannot undo it themselves. There is no built-in recovery code.
-- scripts/mfa-recovery.mjs is the documented way out, and it needs the
-- service-role key, which means it needs the operator. That is a real cost of
-- turning this on and it is written here rather than discovered later.
-- =============================================================================

create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- `<@` is "contained in". The session's level must be one of the levels this
  -- account accepts: only aal2 once a factor is verified, either otherwise.
  select array[(select auth.jwt() ->> 'aal')] <@ (
    select case
             when count(id) > 0 then array['aal2']
             else array['aal1', 'aal2']
           end
      from auth.mfa_factors
     where user_id = (select auth.uid())
       and status = 'verified'
  );
$function$;

revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

comment on function public.mfa_satisfied() is
  'True when the caller''s session is strong enough for their own account: aal2 is required once they have a verified MFA factor, and either level is accepted before that. Keys entirely on auth.uid(); there is no way to ask it about somebody else.';

-- `as restrictive` is not optional and not a style choice. A permissive policy
-- is OR-ed with the others, so it would grant access rather than withhold it -
-- the exact opposite of what this is for. Supabase's guide says so three times
-- and it is repeated here because a future edit that drops the word compiles.
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_profile', 'conversations', 'workout_programs', 'progress_logs',
    'workout_sessions', 'consent_records', 'subscriptions',
    'leaderboard_entries', 'audit_events', 'usage_events'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'migration 0050 names a table that does not exist: %', t;
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_requires_mfa', t);
    execute format(
      'create policy %I on public.%I as restrictive to authenticated using (public.mfa_satisfied())',
      t || '_requires_mfa', t
    );
  end loop;
end $$;

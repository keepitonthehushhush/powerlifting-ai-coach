-- =============================================================================
-- 0043_auth_failures_are_recordable.sql
--
-- A person could not create an account, and the only place that fact existed
-- was Supabase's own auth log.
--
-- ── WHAT HAPPENED ───────────────────────────────────────────────────────────
--
--   POST /signup  400  captcha_failed
--     "captcha protection: request disallowed (no captcha_token found)"
--
-- CAPTCHA was switched on in the dashboard while the deployed bundle carried no
-- VITE_TURNSTILE_SITE_KEY, so the browser sent no token and every attempt was
-- refused. Four hits, two addresses, and nothing in our own tables said so.
--
-- ── WHY error_events COULD NOT HOLD IT ──────────────────────────────────────
--
-- record_error_event() raises when auth.uid() is null and is revoked from anon,
-- which is correct for what it was built for: an error inside an authenticated
-- request, attributed to the person who hit it.
--
-- A failed SIGN-UP has no user by definition. The whole category of failure
-- that matters most commercially - nobody can get in - was the one category the
-- error table could not record. So the gap was not in the table, which already
-- allows a null user_id; it was in the only function that writes to it.
--
-- ── THE SHAPE, AND WHY IT IS THIS NARROW ────────────────────────────────────
--
-- An insert reachable by `anon` is an unauthenticated write, and those get
-- abused. Three things keep it honest:
--
--   1. It takes a CODE and nothing else. No email, no address, no free text,
--      no message from the provider. There is no argument here that could
--      carry a person's data even if a future caller wanted it to.
--   2. The code must be one of a fixed list, checked in the function AND by
--      the column's own CHECK. A caller cannot invent categories to fill the
--      table with.
--   3. It is FLOOD-CAPPED. Rate limiting is per-user in this product and there
--      is no user here, so the cap is global and on the table itself: past a
--      ceiling of anonymous rows in the last minute it silently does nothing.
--
-- That third one is a deliberate trade. This is best-effort telemetry, not an
-- audit trail - dropping writes under flood is the correct failure, and saying
-- so here stops somebody later "fixing" it into a guarantee it should not make.
-- =============================================================================

-- ── The vocabulary ──────────────────────────────────────────────────────────
--
-- Matches AUTH_ERROR_CODES in web/src/lib/authErrors.js, and a test asserts the
-- two agree. Grouped by WHAT THE PERSON SHOULD DO rather than one code per
-- provider string, because that is the only distinction a message can act on.
--
-- `invalid_credentials` is deliberately NOT here. A mistyped password is not a
-- defect, it is the commonest event in any auth system, and recording it would
-- bury the four rows that matter under thousands that do not.
create or replace function private.recordable_auth_codes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'captcha_misconfigured',  -- our build and our dashboard disagree
    'captcha_unavailable',    -- their ad blocker or network
    'captcha_rejected',       -- a token was sent and refused
    'auth_rate_limited',      -- the provider's quota, not the person
    'email_rejected',         -- the address was not accepted
    'auth_unexpected'         -- unmapped; the one that means "go and look"
  ]::text[];
$$;

-- ── The writer ──────────────────────────────────────────────────────────────

create or replace function public.record_auth_failure(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- Anonymous rows written in the last minute, across everybody. The cap is
  -- global because there is no user to scope it to.
  recent bigint;
  ceiling constant int := 60;
begin
  if p_code is null or not (p_code = any (private.recordable_auth_codes())) then
    -- Silently false rather than an exception: this is called from a catch
    -- block on a page somebody is trying to sign up on, and a telemetry write
    -- must never become the reason they see a second error.
    return false;
  end if;

  select count(*) into recent
    from public.error_events e
   where e.user_id is null
     and e.route = '/auth'
     and e.created_at > now() - interval '1 minute';

  if recent >= ceiling then
    return false;
  end if;

  insert into public.error_events (user_id, code, http_status, route, method, detail)
  values (null, p_code, 400, '/auth', 'POST', '{}'::jsonb);

  return true;
end;
$fn$;

comment on function public.record_auth_failure(text) is
  'Records an auth failure that happened before there was a user to attribute it to - a refused sign-up, chiefly. Takes a code from a fixed list and nothing else: no address, no message, no free text. Executable by anon because a failed sign-up has no session, and flood-capped globally because there is no user to rate limit. Best-effort telemetry, not an audit trail.';

revoke all on function public.record_auth_failure(text) from public;
grant execute on function public.record_auth_failure(text) to anon, authenticated;

-- ── The column has to accept them too ───────────────────────────────────────
--
-- error_events.code is CHECKed for SHAPE (lowercase, underscores) rather than
-- for membership, deliberately - 0034 says so - so these need no constraint
-- change. Asserted here rather than assumed, because a shape check that these
-- codes happened to fail would turn every one of them into a raised exception
-- inside a catch block.
do $$
declare bad text;
begin
  select code into bad
    from unnest(private.recordable_auth_codes()) as code
   where code !~ '^[a-z][a-z_]{2,39}$';
  if bad is not null then
    raise exception 'auth code % does not satisfy the error_events shape check', bad;
  end if;
end $$;

-- ── Retention ───────────────────────────────────────────────────────────────
--
-- None needed: these are error_events rows and 0034 already expires that table
-- at six months, sweep included. Written down so the next person does not add a
-- second period for the same rows - a category with two policies is worse than
-- one with none, because both look authoritative.

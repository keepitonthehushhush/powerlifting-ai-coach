-- =============================================================================
-- 0022 — consume_rate_limit lost SECURITY DEFINER, so nothing was rate limited
--
-- FOUND BY: reading Vercel runtime logs while chasing a stuck loading state.
-- Every authenticated request for the past day carried
--
--   {"level":"error","message":"ratelimit.check_failed",
--    "code":"42501","message":"permission denied for schema private"}
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- Migration 0006 declares this function `security definer`. The function
-- actually deployed had prosecdef = false. A SECURITY INVOKER function runs as
-- the CALLER - `authenticated` - and 0004 deliberately revoked that role's
-- USAGE on the private schema, which is where the counters live and is the
-- whole point of putting them there. So every call raised 42501.
--
-- ── WHY NOBODY NOTICED FOR A DAY ─────────────────────────────────────────────
--
-- Because the middleware fails OPEN, deliberately: if the rate limit check
-- breaks, refusing every request converts a counter problem into a total
-- outage. That trade is still right. What was missing is that a fail-open
-- path had no consequence anybody would meet - the error went to a log nobody
-- was reading, and the product carried on looking perfectly healthy while its
-- only brute-force and API-spend protection was absent.
--
-- The lesson is the same one migration 0021 taught about grants versus RLS:
-- a security control that fails silently is indistinguishable from one that is
-- not there, and the only difference is how long it takes to find out.
--
-- ── WHY SECURITY DEFINER IS SAFE HERE ────────────────────────────────────────
--
-- The function takes no user id. It derives the caller from auth.uid() and
-- refuses when that is null, so a definer-rights function cannot be pointed at
-- somebody else's counter. The bucket is validated against a closed whitelist
-- and the quotas are constants in the body, so a caller invoking the RPC
-- directly with their own JWT cannot raise their own ceiling. search_path is
-- pinned to '' and every reference is schema-qualified, which is what stops a
-- definer function being hijacked by a caller-controlled search_path.
-- =============================================================================

create or replace function public.consume_rate_limit(p_bucket text)
returns table (allowed boolean, used int, quota int, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int; v_window_seconds int; v_window_start timestamptz; v_count int;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  case p_bucket
    when 'chat'       then v_limit := 60;  v_window_seconds := 3600;
    when 'chat_daily' then v_limit := 300; v_window_seconds := 86400;
    when 'write'      then v_limit := 240; v_window_seconds := 3600;
    when 'export'     then v_limit := 5;   v_window_seconds := 86400;
    else raise exception 'unknown rate limit bucket: %', p_bucket;
  end case;

  v_window_start := to_timestamp(floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds);

  insert into private.rate_limit_counters as rl (user_id, bucket, window_start, count)
  values (v_user, p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start) do update set count = rl.count + 1
  returning rl.count into v_count;

  return query select v_count <= v_limit, v_count, v_limit,
                      v_window_start + make_interval(secs => v_window_seconds);
end;
$$;

-- `create or replace` preserves the owner but NOT the grants that were revoked
-- against the previous definition, so both are restated rather than assumed.
alter function public.consume_rate_limit(text) owner to postgres;
revoke all on function public.consume_rate_limit(text) from public, anon;
grant execute on function public.consume_rate_limit(text) to authenticated;

comment on function public.consume_rate_limit(text) is
  'Atomically consumes one unit from a fixed-window rate limit bucket for the calling user. SECURITY DEFINER: the counters live in the private schema, which authenticated cannot reach directly - that is the point, and losing this clause silently disabled all rate limiting between 2026-08-26 and 2026-08-27. Target is auth.uid() and cannot be redirected; quotas are constants and not caller-supplied.';

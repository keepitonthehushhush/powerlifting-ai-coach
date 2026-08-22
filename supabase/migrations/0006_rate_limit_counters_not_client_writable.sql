-- =============================================================================
-- 0006_rate_limit_counters_not_client_writable.sql
--
-- Fixes a hole in migration 0005, found before it shipped.
--
-- The atomic upsert in consume_rate_limit() needed INSERT and UPDATE
-- privileges on rate_limit_counters. Because the function was SECURITY
-- INVOKER, those privileges had to be granted to `authenticated` directly -
-- which meant a user could bypass the function entirely and call PostgREST:
--
--     PATCH /rest/v1/rate_limit_counters?bucket=eq.chat   { "count": 0 }
--
-- and reset their own quota at will. The RLS policies were correct; the
-- problem was that the table was reachable at all. A rate limit the limited
-- party can edit is not a rate limit.
--
-- The fix moves the counter into the `private` schema, which PostgREST does
-- not serve, and makes the function SECURITY DEFINER so it - and nothing else -
-- can write there.
--
-- Why this SECURITY DEFINER function is acceptable when migration 0004 moved
-- two others out of `public` for being reachable: this one is MEANT to be
-- called by users. It takes a single argument, validates it against a closed
-- whitelist, and derives the row it touches from auth.uid() rather than from
-- any parameter. The worst an attacker can do by calling it directly is
-- consume their own quota faster. The Supabase linter still flags it; that
-- warning is accepted and documented in docs/SECURITY.md rather than silenced.
-- =============================================================================

create table private.rate_limit_counters as table public.rate_limit_counters;

alter table private.rate_limit_counters add primary key (user_id, bucket, window_start);
alter table private.rate_limit_counters
  add constraint rate_limit_counters_user_fk
  foreign key (user_id) references auth.users (id) on delete cascade;
alter table private.rate_limit_counters
  alter column count set not null,
  alter column count set default 0;

create index rate_limit_counters_window_idx on private.rate_limit_counters (window_start);

drop function public.consume_rate_limit(text);
drop table public.rate_limit_counters;

revoke all on private.rate_limit_counters from anon, authenticated, public;

create function public.consume_rate_limit(p_bucket text)
returns table (allowed boolean, used int, quota int, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int; v_window_seconds int; v_window_start timestamptz; v_count int;
  v_user uuid := auth.uid();
begin
  -- SECURITY DEFINER runs with the owner's privileges, so an unauthenticated
  -- caller must be refused explicitly rather than relying on RLS.
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Closed whitelist. Quotas are server-side authority and deliberately not
  -- caller-supplied: a limit passed as an argument would be trivially raised
  -- by anyone invoking the RPC directly with their own JWT.
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

revoke all on function public.consume_rate_limit(text) from public, anon;
grant execute on function public.consume_rate_limit(text) to authenticated;

comment on function public.consume_rate_limit(text) is
  'Atomically consumes one unit from a fixed-window rate limit bucket for the calling user. Counters live in the private schema and are unreachable via PostgREST; quotas are server-side and not caller-supplied.';

-- Expired windows accumulate. At current volume this is negligible, but the
-- sweep belongs in a scheduled job (pg_cron) before launch:
--   delete from private.rate_limit_counters where window_start < now() - interval '2 days';

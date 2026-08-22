-- =============================================================================
-- 0005_rate_limiting.sql
--
-- Per-user rate limiting.
--
-- Serverless functions have no shared memory: an in-process counter would be
-- per-instance and therefore meaningless. The state has to live somewhere both
-- shared and atomic, and Postgres is already in the request path - using it
-- avoids adding Redis as a dependency and a second thing to operate.
--
-- Fixed-window rather than sliding-window or token bucket. A fixed window
-- permits a burst at a boundary (up to 2x the quota across two adjacent
-- windows). Accepted deliberately: the purpose is to bound cost and stop
-- runaway loops, not to smooth traffic, and a fixed window is one atomic
-- upsert where a sliding window needs either a sorted set or a range scan.
--
-- NOTE: migration 0006 supersedes the table and function created here. See
-- that file for the flaw this version contained.
-- =============================================================================

create table public.rate_limit_counters (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  bucket       text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (user_id, bucket, window_start)
);

create index rate_limit_counters_window_idx on public.rate_limit_counters (window_start);

grant select, insert, update on public.rate_limit_counters to authenticated;
alter table public.rate_limit_counters enable row level security;

create policy "rate limits: owner can read own"
  on public.rate_limit_counters for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "rate limits: owner can insert own"
  on public.rate_limit_counters for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "rate limits: owner can update own"
  on public.rate_limit_counters for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- No delete policy: a user cannot clear their own counter to reset their quota.

create function public.consume_rate_limit(p_bucket text)
returns table (allowed boolean, used int, quota int, resets_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit int; v_window_seconds int; v_window_start timestamptz; v_count int;
begin
  case p_bucket
    when 'chat'       then v_limit := 60;  v_window_seconds := 3600;
    when 'chat_daily' then v_limit := 300; v_window_seconds := 86400;
    when 'write'      then v_limit := 240; v_window_seconds := 3600;
    when 'export'     then v_limit := 5;   v_window_seconds := 86400;
    else raise exception 'unknown rate limit bucket: %', p_bucket;
  end case;

  v_window_start := to_timestamp(floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds);

  insert into public.rate_limit_counters as rl (user_id, bucket, window_start, count)
  values (auth.uid(), p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start) do update set count = rl.count + 1
  returning rl.count into v_count;

  return query select v_count <= v_limit, v_count, v_limit,
                      v_window_start + make_interval(secs => v_window_seconds);
end;
$$;

revoke all on function public.consume_rate_limit(text) from public, anon;
grant execute on function public.consume_rate_limit(text) to authenticated;

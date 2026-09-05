-- =============================================================================
-- 0056_the_cap_is_what_the_business_underwrites.sql
--
-- `chat_daily` was 300 replies per user per day. Nobody sends 300 messages a
-- day, so it never refused anybody - which is exactly why it needed looking
-- at: an unbinding cap is not a limit, it is the number the business is
-- quietly underwriting. At the cost per reply measured in September 2026 a
-- single capped-out month was worth tens of months of one subscription.
--
-- ── THE NUMBERS COME FROM PRODUCTION, NOT FROM COMFORT ──────────────────────
--
-- Measured across every usage_event to date:
--
--     replies in one hour   mean  4.9   p90  7.8   max 29
--     replies in one day    mean  8.6   p90 16.3   max 38
--
-- And the shape matters as much as the peak. Use is FRONT-LOADED: the busiest
-- account sent 12 replies on its first day and 38 on its second, then 19 over
-- the following five days combined. Somebody meeting this coach does intake,
-- gets a program, asks about it, and then settles into checking in. A cap set
-- below that first burst would refuse the most valuable conversation the
-- product ever has with somebody.
--
-- So:
--
--   chat         60/hour     unchanged - already about twice the observed max
--   chat_daily  300 -> 60    1.6x the busiest real day, 7x the mean
--   chat_monthly    -> 400   NEW, and this is the one that actually bounds it
--
-- ── WHY A MONTHLY BUCKET IS THE REAL CONTROL ────────────────────────────────
--
-- A daily cap bounds a bad day. It does nothing about thirty bad days, and
-- thirty days is the billing period - so the daily cap has never been the
-- number that decides whether a subscriber is profitable. 400 a month lets
-- somebody spend fifty replies meeting the coach and still have twelve a day
-- for the rest of the month, which is far more than anybody in this data uses,
-- while capping the exposure at a few months of one subscription instead of
-- tens.
--
-- ── THE WINDOW IS NOT A CALENDAR MONTH ──────────────────────────────────────
--
-- Every bucket here floors epoch seconds into fixed windows, so "monthly" is a
-- rolling 30-day block that begins whenever 2,592,000 seconds last divided
-- evenly - not the first of the month, and not the subscriber's billing date.
-- That is a deliberate accepted imprecision rather than an oversight: aligning
-- it to a billing period would mean reading the subscription inside a function
-- that must never fail open, to move a boundary by at most a few days on a
-- limit nobody is expected to reach.
--
-- ── THE BODY BELOW IS A COPY ────────────────────────────────────────────────
--
-- `create or replace` needs the whole function. This body was read out of
-- pg_get_functiondef on PRODUCTION rather than copied from 0022, because the
-- file is the intent and the catalog is the fact. It is unchanged except for
-- the three limits: still SECURITY DEFINER, still `set search_path = ''`, and
-- still deliberately without the mfa_satisfied() gate that 0052 added to its
-- neighbors - refusing this one would fail open on rate limiting, which trades
-- a small risk for a larger one.
--
-- Registered in function-owners.json so a later migration cannot silently
-- become the last word on it.
-- =============================================================================

create or replace function public.consume_rate_limit(p_bucket text)
returns table(allowed boolean, used integer, quota integer, resets_at timestamp with time zone)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_limit int; v_window_seconds int; v_window_start timestamptz; v_count int;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  case p_bucket
    when 'chat'         then v_limit := 60;  v_window_seconds := 3600;
    when 'chat_daily'   then v_limit := 60;  v_window_seconds := 86400;
    when 'chat_monthly' then v_limit := 400; v_window_seconds := 2592000;
    when 'write'        then v_limit := 240; v_window_seconds := 3600;
    when 'export'       then v_limit := 5;   v_window_seconds := 86400;
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
$function$;

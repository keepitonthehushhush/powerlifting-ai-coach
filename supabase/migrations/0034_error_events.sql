-- =============================================================================
-- 0034_error_events.sql
--
-- A record of what broke, that outlives the log stream.
--
-- ── WHY THE LOGS WERE NOT ENOUGH, AGAIN ─────────────────────────────────────
--
-- "The coach returned an empty response" was reported by a person, and the
-- only reason it could be investigated at all is that somebody happened to
-- look at Vercel's runtime logs within a few hours. Those logs have a
-- retention window measured in days, cannot be grouped by anything meaningful,
-- and are gone by the time a pattern would become visible.
--
-- The question this table exists to answer is not "what happened just now" -
-- the logs answer that. It is "what keeps happening", which nothing could
-- answer before, because the one failure everybody hits and nobody reports is
-- exactly the one a log stream loses.
--
-- ── WHAT GOES IN, AND WHAT MUST NOT ─────────────────────────────────────────
--
-- The code, the route, the status, and a whitelisted handful of diagnostic
-- keys. Never the athlete's message, never the coach's reply, never a field
-- VALUE - `detail` is constrained by the CHECK below rather than by everybody
-- remembering, exactly as audit_events is.
--
-- Health data has no key it could arrive under. Adding one is a migration
-- somebody has to justify in writing, which is the point.
--
-- ── WHY code IS NOT A CHECK CONSTRAINT ──────────────────────────────────────
--
-- The obvious design is `check (code in ('coach_empty', ...))`. It was
-- rejected: the registry lives in server/src/lib/errorCodes.js, and a CHECK
-- would mean every new code needs a migration applied BEFORE the code that
-- throws it deploys - or writes fail in production for a failure that has
-- already happened, which is the worst possible moment to lose the record.
--
-- The column is shape-checked instead. The JS registry is the authority on
-- meaning; a test asserts every code thrown is registered there.
--
-- ── on delete set null, NOT cascade ─────────────────────────────────────────
--
-- Same reasoning as 0030. Cascade would delete the evidence of every failure
-- an athlete hit on their way to deciding to delete their account - which is
-- the population whose errors matter most. Set null keeps "a chat request
-- failed with CD-002 at 20:59" and drops the person, which is no longer
-- personal data and is the whole of what a pattern needs.
-- =============================================================================

create table if not exists public.error_events (
  seq         bigserial primary key,
  user_id     uuid references auth.users (id) on delete set null,
  -- The registry key, e.g. 'coach_refused'. Shape, not membership - see above.
  code        text not null check (code ~ '^[a-z][a-z_]{2,39}$'),
  http_status integer not null check (http_status between 400 and 599),
  -- The route pattern, never the full URL: a path can carry an id, and a query
  -- string can carry anything at all.
  route       text not null check (route ~ '^/[A-Za-z0-9/_-]{0,80}$'),
  method      text not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  /**
   * Whitelisted keys. `jsonb - text[]` removes the permitted ones; if what
   * remains is empty, every key was permitted. Immutable, so it is legal in a
   * CHECK, and it fails the write rather than trusting a code path.
   *
   * Every key here is a fixed vocabulary or a number. None of them can hold a
   * sentence somebody typed.
   */
  detail      jsonb not null default '{}'::jsonb
                check (detail - array[
                  'stopReason', 'stopCategory', 'blockTypes', 'hadText',
                  'upstreamStatus', 'cause', 'needs', 'reason', 'subject',
                  'field', 'limit', 'length', 'attempt', 'retryable'
                ] = '{}'::jsonb),
  created_at  timestamptz not null default now()
);

comment on table public.error_events is
  'What broke, grouped by error code. Contains the code, route and a whitelisted set of diagnostic keys - never a message, a reply, or a field value. user_id is SET NULL on account deletion, so the failure history survives without remaining personal data.';

-- The two questions asked of it: "what is this athlete hitting" and "what is
-- everybody hitting". One index each.
create index if not exists error_events_user_seq_idx on public.error_events (user_id, seq desc);
create index if not exists error_events_code_time_idx on public.error_events (code, created_at desc);

alter table public.error_events enable row level security;

-- They can read their own. A person who quotes CD-002 in a support message
-- should be able to see the same row we are looking at; and it goes in the
-- data export, so it has to be readable with their own JWT.
drop policy if exists error_events_read_own on public.error_events;
create policy error_events_read_own
  on public.error_events for select to authenticated
  using (user_id = auth.uid());

-- SELECT only. No insert, update or delete policy exists for anybody: a
-- failure log a user can write is a failure log an attacker can flood, and one
-- they can edit is not evidence. The privilege is the control - RLS narrows a
-- granted privilege and does not create one (0021).
grant select on public.error_events to authenticated;
revoke all on public.error_events from anon;
revoke insert, update, delete on public.error_events from authenticated;

-- ----------------------------------------------------------------------------
-- record_error_event(code, http_status, route, method, detail)
--
-- The only way a write reaches this table. Definer, so it can insert where the
-- caller cannot, and it stamps user_id from the JWT rather than accepting one -
-- so a browser cannot attribute a failure to somebody else.
--
-- Requires an authenticated caller, which means unauthenticated failures (a
-- 401 with no session) are NOT recorded. That is a deliberate gap: a function
-- anon can call is an unauthenticated insert endpoint, and the failures worth
-- counting are the ones that happen to people who got in.
-- ----------------------------------------------------------------------------
create or replace function public.record_error_event(
  p_code        text,
  p_http_status integer,
  p_route       text,
  p_method      text,
  p_detail      jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'record_error_event() requires an authenticated caller';
  end if;

  insert into public.error_events (user_id, code, http_status, route, method, detail)
  values (uid, p_code, p_http_status, p_route, p_method, coalesce(p_detail, '{}'::jsonb));
end;
$$;

revoke all on function public.record_error_event(text, integer, text, text, jsonb) from public, anon;
grant execute on function public.record_error_event(text, integer, text, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- private.error_summary(days)
--
-- The review surface, and the reason the table exists rather than a log query.
-- Owner-only: it aggregates across everybody, so it is not something any user
-- may run. Read it from the SQL editor - see docs/RUNBOOK.md.
-- ----------------------------------------------------------------------------
create or replace function private.error_summary(p_days integer default 7)
returns table (
  code           text,
  occurrences    bigint,
  people         bigint,
  routes         text[],
  first_seen     timestamptz,
  last_seen      timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    e.code,
    count(*)                                   as occurrences,
    count(distinct e.user_id)                  as people,
    array_agg(distinct e.route order by e.route) as routes,
    min(e.created_at)                          as first_seen,
    max(e.created_at)                          as last_seen
  from public.error_events e
  where e.created_at > now() - make_interval(days => p_days)
  group by e.code
  order by count(*) desc;
$$;

revoke all on function private.error_summary(integer) from public, anon, authenticated;

-- ── Retention ───────────────────────────────────────────────────────────────
--
-- Six months. Long enough to see a seasonal pattern and to answer "has this
-- been happening since the June deploy", short enough that a table nobody
-- prunes does not become the largest thing in the database.
insert into public.retention_periods (category, months, note) values
  ('error_events', 6,
   'Records of failures - an error code, a route and a status, never message content. Kept six months so a recurring fault is visible, then removed. Rows whose account was deleted already carry no user id.')
on conflict (category) do update
  set months = excluded.months, note = excluded.note;

-- ── The sweep learns about the new table ────────────────────────────────────
--
-- Adding a row to retention_periods does NOT prune anything: apply_retention()
-- reads the months from that table but the DELETE for each category is written
-- out by hand. A category with a policy and no sweep is a promise in a table
-- that nothing keeps - the same shape as the RLS policy with no GRANT in 0021.
--
-- Replaced in full rather than patched, and `security definer` plus the pinned
-- search_path are RE-STATED: `create or replace function` silently drops both,
-- which is how consume_rate_limit spent a day raising 42501 while its migration
-- file said otherwise. scripts/check-db-invariants.mjs asserts them from the
-- catalogue afterwards, because the file is the intent and the catalogue is the
-- fact.
create or replace function private.apply_retention()
returns table (category text, affected bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  m_health int := (select rp.months from public.retention_periods rp where rp.category = 'health_restrictions');
  m_glp1   int := (select rp.months from public.retention_periods rp where rp.category = 'glp1_status');
  m_msgs   int := (select rp.months from public.retention_periods rp where rp.category = 'conversation_messages');
  m_audit  int := (select rp.months from public.retention_periods rp where rp.category = 'audit_events');
  m_usage  int := (select rp.months from public.retention_periods rp where rp.category = 'usage_events');
  m_stripe int := (select rp.months from public.retention_periods rp where rp.category = 'stripe_events');
  m_errors int := (select rp.months from public.retention_periods rp where rp.category = 'error_events');
  n bigint;
begin
  update public.user_profile
     set health_restrictions = null,
         health_restrictions_updated_at = null,
         cleared_to_train = null
   where health_restrictions is not null
     and health_restrictions_updated_at < now() - make_interval(months => m_health);
  get diagnostics n = row_count;
  category := 'health_restrictions'; affected := n; return next;

  update public.user_profile
     set glp1_status = null,
         glp1_status_updated_at = null
   where glp1_status is not null
     and glp1_status_updated_at < now() - make_interval(months => m_glp1);
  get diagnostics n = row_count;
  category := 'glp1_status'; affected := n; return next;

  with trimmed as (
    select c.id,
           coalesce(jsonb_agg(msg order by ord), '[]'::jsonb) as kept,
           jsonb_array_length(c.messages) as before_count
      from public.conversations c
      cross join lateral jsonb_array_elements(c.messages) with ordinality as t(msg, ord)
     where jsonb_array_length(c.messages) > 0
       and (
             (msg ? 'at' and (msg->>'at')::timestamptz >= now() - make_interval(months => m_msgs))
          or (not (msg ? 'at') and c.created_at >= now() - make_interval(months => m_msgs))
           )
     group by c.id, c.messages
  )
  update public.conversations c
     set messages = t.kept
    from trimmed t
   where c.id = t.id
     and jsonb_array_length(t.kept) < t.before_count;
  get diagnostics n = row_count;
  category := 'conversation_messages'; affected := n; return next;

  delete from public.audit_events ae where ae.created_at < now() - make_interval(months => m_audit);
  get diagnostics n = row_count;
  category := 'audit_events'; affected := n; return next;

  delete from public.usage_events ue where ue.created_at < now() - make_interval(months => m_usage);
  get diagnostics n = row_count;
  category := 'usage_events'; affected := n; return next;

  delete from public.stripe_events se where se.received_at < now() - make_interval(months => m_stripe);
  get diagnostics n = row_count;
  category := 'stripe_events'; affected := n; return next;

  delete from public.error_events ee where ee.created_at < now() - make_interval(months => m_errors);
  get diagnostics n = row_count;
  category := 'error_events'; affected := n; return next;
end;
$fn$;

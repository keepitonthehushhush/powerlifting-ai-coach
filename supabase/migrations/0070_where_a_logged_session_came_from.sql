-- =============================================================================
-- 0070_where_a_logged_session_came_from.sql
--
-- `client_key` gains a source prefix, and a place to keep a third-party
-- credential that nothing else in this database can read.
--
-- ── WHY THE KEY NEEDED A PREFIX ─────────────────────────────────────────────
--
-- 0065 added `client_key text check (client_key ~ '^[0-9a-f]{1,32}$')` with a
-- partial unique index on (user_id, client_key), so that tapping "log this"
-- twice writes one row. The coach's own key is an 8-character FNV-1a hash of
-- the session's content.
--
-- A workout imported from an outside tracker needs the same protection, and
-- the natural key is that tracker's own workout id - a UUID, which with its
-- dashes removed is exactly 32 hex characters and fits the constraint above
-- without a single change.
--
-- That coincidence is the problem. Two sources would share one namespace and
-- be told apart ONLY by length: eight characters means the coach, thirty-two
-- means an import. That is true today and it is true because of a hash width
-- nobody has any reason to keep. Someone widens the hash to sixteen characters
-- for perfectly good reasons in a year, and a coach-proposed session silently
-- becomes indistinguishable from an imported one - in a column whose entire
-- job is to say "this row is the same workout as that row".
--
-- So the origin is written down rather than inferred. `coach:` and `hevy:`,
-- and the migration rewrites every existing row rather than leaving two
-- generations of format in one column for somebody to discover later.
--
-- ── AND WHY THE CREDENTIAL LIVES IN `private` ───────────────────────────────
--
-- Connecting an outside tracker means holding an API key for somebody's paid
-- account on another service. That is a bearer credential, not a preference,
-- and this codebase already has the right shape for it: `private.trial_usage`
-- in 0057 sits in a schema `authenticated` holds no USAGE on, which is the
-- entire reason a trial counter cannot be reset from a network tab.
--
-- Not `user_profile`: that table is health data, with a consent trigger and a
-- retention sweep tuned to health data, and a credential needs neither.
-- Not `user_preferences`: described in 0045 as "settings that are not health
-- data" and read in a dozen places written on the assumption that nothing
-- there is dangerous.
--
-- Reached through a SECURITY DEFINER function scoped to auth.uid(), so the
-- service-role client count stays at exactly ONE - which ADR-12 says is the
-- point of having it.
--
-- ── WHAT IS DELIBERATELY NOT STORED ─────────────────────────────────────────
--
-- The tracker's exercise catalog. Their template ids are used as RUNTIME
-- IDENTIFIERS to address one API call and are never persisted as a library of
-- our own: that library is their content, their terms reserve it, and a
-- compilation of somebody else's selection and categorization is the one thing
-- in this integration with real copyright exposure. Our exercise library is
-- built independently and stays that way.
-- =============================================================================

-- --- the source prefix -------------------------------------------------------

alter table public.workout_sessions drop constraint if exists workout_sessions_client_key_check;

-- Rewrite first, widen second. The other order leaves a window in which the
-- old rows violate the new constraint, and `alter table ... add constraint`
-- validates existing rows by default - so the wrong order simply fails, which
-- is the good outcome, but only after the DDL has already been typed.
update public.workout_sessions
   set client_key = 'coach:' || client_key
 where client_key is not null
   and client_key !~ ':';

alter table public.workout_sessions
  add constraint workout_sessions_client_key_check
  check (client_key is null or client_key ~ '^(coach|hevy):[0-9a-f]{1,32}$');

comment on column public.workout_sessions.client_key is
  'Idempotency key, namespaced by where the row came from: coach:<8 hex> is a content hash of a session the coach proposed and the athlete confirmed (0065), hevy:<32 hex> is an imported workout id with its dashes removed. Null for a hand-entered session, which is why the unique index below is partial - two identical workouts typed by hand are two workouts. The prefix exists so the source is recorded rather than inferred from the length of a hash nobody promised to keep.';

-- --- the credential ----------------------------------------------------------

create table if not exists private.hevy_connections (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  api_key        text not null,
  connected_at   timestamptz not null default now(),
  -- The high-water mark for GET /workouts/events?since=. Null until the
  -- backfill has finished, because an incremental sync that starts before the
  -- history is in would leave a permanent hole nothing ever goes back for.
  synced_through timestamptz,
  -- Where the bounded backfill has reached, as a page cursor. Null when the
  -- backfill is complete. Kept so that a sync interrupted at page 7 of 12
  -- resumes rather than restarts - at ten workouts a page, restarting is the
  -- difference between finishing and never finishing.
  backfill_page  integer,
  backfill_done  boolean not null default false,
  last_error     text,
  updated_at     timestamptz not null default now()
);

comment on table private.hevy_connections is
  'One row per athlete who has connected an outside tracker. Holds a bearer credential for a paid account on another service, which is why it is in `private` rather than in any table `authenticated` holds a grant on - the same reasoning as private.trial_usage in 0057. Never logged, never sent to the model, and deliberately excluded from the data export: an export is a file people email to themselves and a live credential does not belong in one.';

revoke all on private.hevy_connections from anon, authenticated, public;

create trigger hevy_connections_set_updated_at
  before update on private.hevy_connections
  for each row execute function private.set_updated_at();

-- --- what the athlete may see, and what they may change ----------------------

/*
 * The STATE of the connection, never the key.
 *
 * There is no function that returns the credential to a browser, and that
 * absence is the design: the UI needs to know whether a connection exists and
 * when it last synced, and it never needs the secret back. A key that can be
 * read is a key that ends up in a screenshot, a bug report, or a support chat.
 */
create or replace function public.hevy_connection_status()
returns table (connected boolean, connected_at timestamptz, synced_through timestamptz, backfill_done boolean, last_error text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select
    c.user_id is not null,
    c.connected_at,
    c.synced_through,
    coalesce(c.backfill_done, false),
    c.last_error
  from (select auth.uid() as uid) u
  left join private.hevy_connections c on c.user_id = u.uid
  where u.uid is not null;
$$;

comment on function public.hevy_connection_status() is
  'Whether this athlete has an outside tracker connected, and how far the sync has got. Returns no row for an unauthenticated caller and never returns the credential itself.';

create or replace function public.connect_hevy(p_api_key text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'connect_hevy() requires an authenticated caller';
  end if;
  /*
   * Shape-checked here as well as in the API. The key is a UUID; anything
   * else is a paste error, and refusing it at the door is kinder than a
   * failed sync an hour later. It is NOT validated against the provider
   * here - Postgres does not make outbound calls, and the route proves the
   * key works before it ever gets this far.
   */
  if p_api_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'that does not look like a Hevy API key';
  end if;

  insert into private.hevy_connections as h (user_id, api_key)
  values (uid, p_api_key)
  on conflict (user_id) do update
    set api_key = excluded.api_key,
        connected_at = now(),
        -- Reconnecting starts the history again. A new key can belong to a
        -- different account, and carrying the old cursor forward would skip
        -- everything before it on an account we have never read.
        synced_through = null,
        backfill_page = null,
        backfill_done = false,
        last_error = null;
end;
$$;

create or replace function public.disconnect_hevy()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'disconnect_hevy() requires an authenticated caller';
  end if;
  -- The row goes, rather than the key being blanked. A disconnected
  -- integration that still holds the credential is not disconnected.
  delete from private.hevy_connections where user_id = uid;
end;
$$;

/*
 * The one function that hands the credential back, and it hands it to the
 * SERVER acting as the athlete - the same client every other query in this
 * codebase uses, so RLS and auth.uid() are what scope it. There is no service
 * role anywhere in this integration.
 *
 * Named so that its appearance in a diff is conspicuous.
 */
create or replace function public.hevy_key_for_sync()
returns table (api_key text, synced_through timestamptz, backfill_page integer, backfill_done boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select h.api_key, h.synced_through, h.backfill_page, h.backfill_done
    from private.hevy_connections h
   where h.user_id = auth.uid();
$$;

create or replace function public.record_hevy_sync(
  p_synced_through timestamptz default null,
  p_backfill_page  integer default null,
  p_backfill_done  boolean default null,
  p_last_error     text default null
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'record_hevy_sync() requires an authenticated caller';
  end if;
  update private.hevy_connections
     set synced_through = coalesce(p_synced_through, synced_through),
         backfill_page  = p_backfill_page,
         backfill_done  = coalesce(p_backfill_done, backfill_done),
         -- Passed explicitly as null on success, so a fixed error clears
         -- rather than haunting the settings page forever.
         last_error     = p_last_error
   where user_id = uid;
end;
$$;

revoke all on function public.hevy_connection_status() from public, anon;
revoke all on function public.connect_hevy(text) from public, anon;
revoke all on function public.disconnect_hevy() from public, anon;
revoke all on function public.hevy_key_for_sync() from public, anon;
revoke all on function public.record_hevy_sync(timestamptz, integer, boolean, text) from public, anon;

grant execute on function public.hevy_connection_status() to authenticated;
grant execute on function public.connect_hevy(text) to authenticated;
grant execute on function public.disconnect_hevy() to authenticated;
grant execute on function public.hevy_key_for_sync() to authenticated;
grant execute on function public.record_hevy_sync(timestamptz, integer, boolean, text) to authenticated;

-- --- retention ---------------------------------------------------------------
-- A connection nobody has used in a year is a credential we are holding for no
-- reason. The sweep clears it, and the athlete reconnects in one paste.
insert into public.retention_periods (category, months, note) values
  ('hevy_connections', 12,
   'An outside-tracker connection is removed 12 months after its last sync, because a credential nobody is using is a credential nobody should be holding.')
on conflict (category) do update
  set months = excluded.months, note = excluded.note;

-- The row and the DELETE go in together. check-db-invariants.mjs asserts that
-- every category named in retention_periods appears in the body of
-- apply_retention(), because a published retention promise that nothing keeps
-- is correct on paper and inert in fact.
create or replace function private.apply_retention()
returns table(category text, affected bigint)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  m_health int := (select rp.months from public.retention_periods rp where rp.category = 'health_restrictions');
  m_glp1   int := (select rp.months from public.retention_periods rp where rp.category = 'glp1_status');
  m_msgs   int := (select rp.months from public.retention_periods rp where rp.category = 'conversation_messages');
  m_audit  int := (select rp.months from public.retention_periods rp where rp.category = 'audit_events');
  m_usage  int := (select rp.months from public.retention_periods rp where rp.category = 'usage_events');
  m_stripe int := (select rp.months from public.retention_periods rp where rp.category = 'stripe_events');
  m_errors int := (select rp.months from public.retention_periods rp where rp.category = 'error_events');
  m_guard  int := (select rp.months from public.retention_periods rp where rp.category = 'guardian_email');
  m_intent int := (select rp.months from public.retention_periods rp where rp.category = 'training_intention');
  m_greq   int := (select rp.months from public.retention_periods rp where rp.category = 'guardian_consent_requests');
  m_days   int := (select rp.months from public.retention_periods rp where rp.category = 'activity_days');
  m_hevy   int := (select rp.months from public.retention_periods rp where rp.category = 'hevy_connections');
  n bigint;
begin
  update public.user_profile
     set health_restrictions = null,
         health_restrictions_updated_at = null,
         cleared_to_train = false
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

  update public.user_profile
     set training_obstacle = null,
         training_if_then = null,
         training_intention_updated_at = null
   where training_intention_updated_at is not null
     and training_intention_updated_at < now() - make_interval(months => m_intent);
  get diagnostics n = row_count;
  category := 'training_intention'; affected := n; return next;

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

  update public.consent_records cr
     set guardian_email = null
   where cr.guardian_email is not null
     and cr.created_at < now() - make_interval(months => m_guard);
  get diagnostics n = row_count;
  category := 'guardian_email'; affected := n; return next;

  delete from public.stripe_events se where se.received_at < now() - make_interval(months => m_stripe);
  get diagnostics n = row_count;
  category := 'stripe_events'; affected := n; return next;

  delete from public.error_events ee where ee.created_at < now() - make_interval(months => m_errors);
  get diagnostics n = row_count;
  category := 'error_events'; affected := n; return next;

  delete from public.guardian_consent_requests
   where created_at < now() - make_interval(months => m_greq);
  get diagnostics n = row_count;
  category := 'guardian_consent_requests'; affected := n; return next;

  -- Cast back to date. current_date minus an interval is a TIMESTAMP, and
  -- comparing a date column against a timestamp widens every row to midnight
  -- rather than comparing days - which happens to give the right answer here
  -- and would stop doing so the moment the interval gains an hours component.
  delete from public.activity_days ad
   where ad.day < (current_date - make_interval(months => m_days))::date;
  get diagnostics n = row_count;
  category := 'activity_days'; affected := n; return next;

  -- coalesce, because a connection that has never completed a sync has a null
  -- synced_through and would otherwise be immortal - the exact row most worth
  -- clearing, since it is a credential that has never been used for anything.
  delete from private.hevy_connections h
   where coalesce(h.synced_through, h.connected_at) < now() - make_interval(months => m_hevy);
  get diagnostics n = row_count;
  category := 'hevy_connections'; affected := n; return next;
end;
$function$;

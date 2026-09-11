-- =============================================================================
-- 0071_the_page_a_sync_resumes_at_is_not_only_the_backfill.sql
--
-- Renames `backfill_page` to `sync_page`, and the three functions that name it.
--
-- ── WHY, ONE DAY AFTER WRITING IT ───────────────────────────────────────────
--
-- 0070 gave the connection a cursor for the first import and called it
-- `backfill_page`, on the assumption that only the backfill would ever need to
-- stop half way and resume.
--
-- Reading Hevy's live OpenAPI document rather than yesterday's notes about it
-- changed that. `GET /v1/workouts` documents NO ordering - not newest-first,
-- not anything - and the whole backfill rested on it being newest-first to
-- know when it had walked past the ninety-day floor. `GET /v1/workouts/events`
-- is documented "ordered from newest to oldest", takes an arbitrary `since`,
-- and returns deletions as well as updates. So both phases now read the same
-- endpoint and differ only in where `since` points.
--
-- The consequence for this column: an INCREMENTAL pass can now run out of page
-- budget too. Somebody who does not sync for two months comes back to more
-- events than one invocation should fetch, and events are newest-first, so the
-- pages left unread are the OLDEST ones. Advancing the high-water mark after a
-- partial pass would step the cursor past them, and `?since=` never looks
-- backwards - the exact hole the backfill cursor exists to prevent, in the
-- other phase.
--
-- So both phases resume by page, and the column is named for what it holds.
--
-- ── WHY A RENAME AND NOT A SECOND COLUMN ────────────────────────────────────
--
-- Two cursors would need a rule about which one is authoritative, and that
-- rule would be a comment rather than a constraint. There is one position in
-- one stream; the mode says which stream. And the table is empty in every
-- environment, so this costs nothing today and would cost a data migration in
-- a month.
--
-- A rename is not a cosmetic change here. `backfill_page` holding an
-- incremental cursor is the kind of small lie that is still being believed
-- three debugging sessions later.
-- =============================================================================

alter table private.hevy_connections rename column backfill_page to sync_page;

comment on column private.hevy_connections.sync_page is
  'The page of the event stream the next sync resumes at, in either phase, or null when the last pass reached the end. Both phases read the same newest-first endpoint, so an unread page is always older than what has been read - which is why the cursor is a page rather than a timestamp.';

-- --- the functions that name the column ---------------------------------------
-- Dropped rather than replaced: Postgres refuses to change the name of an
-- input parameter or of an output column through CREATE OR REPLACE, and
-- leaving the old names in the signatures is how the lie survives the rename.

drop function if exists public.hevy_key_for_sync();

create or replace function public.hevy_key_for_sync()
returns table (api_key text, synced_through timestamptz, sync_page integer, backfill_done boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select h.api_key, h.synced_through, h.sync_page, h.backfill_done
    from private.hevy_connections h
   where h.user_id = auth.uid();
$$;

comment on function public.hevy_key_for_sync() is
  'The only function in this database that returns the stored credential. Called by the server with the athlete''s own RLS-scoped client, never with a service role. Named so that its appearance in a diff is conspicuous.';

drop function if exists public.record_hevy_sync(timestamptz, integer, boolean, text);

create or replace function public.record_hevy_sync(
  p_synced_through timestamptz default null,
  p_sync_page      integer default null,
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
         sync_page      = p_sync_page,
         backfill_done  = coalesce(p_backfill_done, backfill_done),
         -- Passed explicitly as null on success, so a fixed error clears
         -- rather than haunting the settings page forever.
         last_error     = p_last_error
   where user_id = uid;
end;
$$;

-- connect_hevy() resets the cursor on reconnect, so it names the column too.
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
        sync_page = null,
        backfill_done = false,
        last_error = null;
end;
$$;

revoke all on function public.hevy_key_for_sync() from public, anon;
revoke all on function public.record_hevy_sync(timestamptz, integer, boolean, text) from public, anon;
revoke all on function public.connect_hevy(text) from public, anon;

grant execute on function public.hevy_key_for_sync() to authenticated;
grant execute on function public.record_hevy_sync(timestamptz, integer, boolean, text) to authenticated;
grant execute on function public.connect_hevy(text) to authenticated;

-- --- the audit log learns two more account events ------------------------------
--
-- Connecting an outside tracker puts a bearer credential for another service on
-- this account, and disconnecting takes it off. That is the same class of event
-- as `mfa_factor_removed`, which is already here: not something the athlete is
-- likely to forget doing, but exactly what somebody asks about after an account
-- is compromised - "when did that appear, and was it me".
--
-- The whole list is restated because `drop constraint; add constraint` is
-- last-writer-wins, the same shape as `create or replace function`, and a
-- restatement that drops a value silently un-audits an event. Values from 0041
-- and 0051 are carried forward deliberately rather than by accident.
alter table public.audit_events drop constraint if exists audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check
  check (action in (
    'data_exported',
    'account_deleted',
    'subscription_changed',
    'clearance_asserted',
    'mfa_factor_removed',
    'tracker_connected',
    'tracker_disconnected'
  ));

-- --- and the function that is the real gate -----------------------------------
--
-- The CHECK constraint above says which actions may EXIST. record_audit_event()
-- says which ones a USER may claim about themselves, and it is a shorter list -
-- `subscription_changed` comes from the Stripe webhook and `mfa_factor_removed`
-- from the function that removes the factor, so neither is something a browser
-- may assert.
--
-- Widening only the constraint was a real bug for about an hour: the route
-- called record_audit_event('tracker_connected'), the function refused it, the
-- route logged a warning and carried on - so connecting would have worked, and
-- nothing would ever have been audited, and no test that reads the constraint
-- would have noticed. Found by running the round trip as the `authenticated`
-- role rather than by reading either definition.
--
-- Connecting and disconnecting are the athlete's own acts, so both belong on
-- the shorter list too.
create or replace function public.record_audit_event(p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'record_audit_event() requires an authenticated caller';
  end if;

  if p_action not in ('data_exported', 'account_deleted', 'clearance_asserted', 'tracker_connected', 'tracker_disconnected') then
    raise exception 'audit_action_not_permitted'
      using hint = 'Only data_exported, account_deleted, clearance_asserted, tracker_connected and tracker_disconnected may be recorded by a user.';
  end if;

  insert into public.audit_events (user_id, action, actor, detail)
  values (uid, p_action, 'user', coalesce(p_detail, '{}'::jsonb));
end;
$function$;

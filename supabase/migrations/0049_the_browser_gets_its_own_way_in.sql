-- =============================================================================
-- 0049_the_browser_gets_its_own_way_in.sql
--
-- 0048 gave error_events room for client rows. This gives a browser a way to
-- write one, and only one shape of one.
--
-- ── WHY A SECOND FUNCTION RATHER THAN A LONGER FIRST ONE ────────────────────
--
-- record_error_event() takes an http_status and a method and is called on
-- every handled server failure. Adding an origin argument to it would make
-- every existing call site pass a value it has no opinion about, and would put
-- 'client' one wrong argument away from being written by the server's own
-- error handler. Two functions cannot be confused for each other.
--
-- ── WHY THE CODE VOCABULARY IS ENFORCED HERE AND NOT ONLY IN EXPRESS ────────
--
-- The route validates the body, and the route is a thing somebody edits. The
-- prefix check below is the property that does not depend on remembering:
-- whatever calls this function, a row written through it is a client row and
-- says so in its code. A dashboard grouping by code cannot be quietly polluted
-- with server codes wearing a client origin.
--
-- Note what is NOT checked here: the exact member of the vocabulary. The
-- registry lives in web/src/lib/crashReport.js and the route enforces it.
-- Pinning the full list in the database would mean a migration every time a
-- new failure mode is worth naming, and the constraint that matters - that
-- this is a browser saying something about itself - is the prefix.
-- =============================================================================

create or replace function public.record_client_error_event(
  p_code text,
  p_route text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
begin
  -- Same rule as record_error_event: a function anon can call is an
  -- unauthenticated insert endpoint wearing a different name.
  if uid is null then
    raise exception 'record_client_error_event() requires an authenticated caller';
  end if;

  if p_code is null or p_code not like 'client\_%' then
    raise exception 'record_client_error_event() only writes client_* codes, got %', p_code;
  end if;

  insert into public.error_events (user_id, code, http_status, route, method, detail, origin)
  values (uid, p_code, null, p_route, null, coalesce(p_detail, '{}'::jsonb), 'client');
end;
$function$;

revoke all on function public.record_client_error_event(text, text, jsonb) from public, anon;
grant execute on function public.record_client_error_event(text, text, jsonb) to authenticated;

comment on function public.record_client_error_event(text, text, jsonb) is
  'Records a failure that happened in a browser. Writes origin = client with no http_status and no method, because there was no HTTP exchange. Refuses an unauthenticated caller and refuses any code not prefixed client_.';

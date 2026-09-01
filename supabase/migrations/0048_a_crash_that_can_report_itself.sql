-- =============================================================================
-- 0048_a_crash_that_can_report_itself.sql
--
-- On 2026-08-31 the coach page crashed Safari on an iPhone, repeatedly, and
-- error_events was empty for the entire window. Every server-side check was
-- green and every one of them was right: nothing had gone wrong on the server.
-- The failure was in the browser, and this table had no way to hear about it.
--
-- ── WHY THIS TABLE RATHER THAN A NEW ONE ────────────────────────────────────
--
-- A second table would need its own RLS, its own retention entry, its own
-- export line, and its own place in every query that asks "what is breaking".
-- The daily deployment check already reads error_events; the moment client
-- failures land here, they are in that pipeline for free. One table, one
-- answer to "what broke".
--
-- ── WHAT A CLIENT ROW CANNOT HAVE ───────────────────────────────────────────
--
-- http_status and method describe an HTTP exchange. A render that threw is not
-- an HTTP exchange, and writing 500 into a column that means "the server
-- answered 500" would make every existing query about server health quietly
-- wrong. So both become nullable, and a check enforces the pairing rather than
-- trusting a code path to remember it:
--
--     origin = 'server'  ->  http_status present, method present
--     origin = 'client'  ->  both absent
--
-- Existing rows are all server rows and the default preserves that, so this
-- migration cannot change the meaning of anything already written.
--
-- ── WHY THE DETAIL WHITELIST GROWS BY FOUR KEYS AND NOT BY A MESSAGE ────────
--
-- The obvious thing to record about a browser error is its message and its
-- stack. Both are refused here, and the reason is the health-data rule: this
-- app holds injuries and restrictions, and a thrown Error's message is
-- whatever the throwing code interpolated into it. "Invalid value X" is a
-- template that has already put a field value in a string once. A stack frame
-- from a minified bundle is different in kind - it is a coordinate produced by
-- the browser out of the build, and there is no path by which an athlete's
-- data reaches it.
--
-- So a client row records WHERE, not WHAT: the error's constructor name, the
-- top frame, how deep the stack was, and which build. With a source map that
-- is enough to open the line. Without a message it is a slower diagnosis, and
-- that is the trade this project makes every time: less convenience, no path
-- from a health field to a log line.
--
-- topFrame is the one key whose value is not a fixed vocabulary or a number,
-- so its SHAPE is constrained here as well as in the route that writes it. A
-- client can post anything; the database is what makes that not matter.
-- =============================================================================

alter table public.error_events
  add column if not exists origin text not null default 'server'
    check (origin in ('server', 'client'));

alter table public.error_events alter column http_status drop not null;
alter table public.error_events alter column method drop not null;

-- The original NOT NULL checks stay for server rows; they are re-expressed
-- here as a pairing so a client row cannot borrow a server row's vocabulary.
alter table public.error_events drop constraint if exists error_events_origin_shape;
alter table public.error_events add constraint error_events_origin_shape check (
  (origin = 'server'
     and http_status is not null and http_status between 400 and 599
     and method is not null and method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE'))
  or
  (origin = 'client' and http_status is null and method is null)
);

-- Four more permitted detail keys, and a shape for the only one that is text.
alter table public.error_events drop constraint if exists error_events_detail_check;
alter table public.error_events add constraint error_events_detail_check check (
  detail - array[
    'stopReason', 'stopCategory', 'blockTypes', 'hadText',
    'upstreamStatus', 'cause', 'needs', 'reason', 'subject',
    'field', 'limit', 'length', 'attempt', 'retryable',
    -- client rows
    'errorName', 'topFrame', 'frames', 'build'
  ] = '{}'::jsonb
);

alter table public.error_events drop constraint if exists error_events_top_frame_shape;
alter table public.error_events add constraint error_events_top_frame_shape check (
  detail->>'topFrame' is null
  or detail->>'topFrame' ~ '^[A-Za-z0-9._-]{1,80}:[0-9]{1,7}:[0-9]{1,7}$'
);

-- "What is breaking in browsers, this week" without scanning server rows.
create index if not exists error_events_origin_time_idx
  on public.error_events (origin, created_at desc);

comment on column public.error_events.origin is
  'Where the failure happened. server = an HTTP request this API answered badly; client = a browser that threw or died. Client rows carry no http_status and no method, because there was no HTTP exchange to describe.';

comment on table public.error_events is
  'What broke, grouped by error code, from the server and from browsers. Contains the code, route and a whitelisted set of diagnostic keys - never a message, a reply, a stack trace, or a field value. Client rows record where a failure happened (build, top frame) and never what was in scope when it did. user_id is SET NULL on account deletion, so the failure history survives without remaining personal data.';

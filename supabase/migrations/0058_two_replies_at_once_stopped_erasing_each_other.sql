-- =============================================================================
-- 0058_two_replies_at_once_stopped_erasing_each_other.sql
--
-- The conversation is appended to by the database, not overwritten by the API.
--
-- ── THE DEFECT, AND HOW IT WAS FOUND ────────────────────────────────────────
--
-- POST /api/chat read the whole message array at the start of the request,
-- spent up to 77 seconds in the model, and then wrote the array back:
--
--     history = conversation.messages                 -- read at t=0
--     updated = [...history, userMessage, reply]      -- built from that
--     update({ messages: updated }).eq('id', ...)     -- unconditional
--
-- Read-modify-write on a JSONB column with no version check and no lock. Two
-- overlapping requests both read the same snapshot, and the second write
-- deletes the first exchange:
--
--     A reads m1..m20, thinks for 60s
--     B reads m1..m20, thinks for 45s
--     A writes m1..m20 + uA + aA
--     B writes m1..m20 + uB + aB      <- A's question and answer are gone
--
-- Nothing fails. Both replies were generated, both were paid for, and the
-- athlete may have read both. One then vanishes on the next load, and - worse
-- and more quietly - the coach never sees that exchange again, so a correction
-- or an injury mentioned in the erased turn is simply forgotten.
--
-- It was found in the data, not from a report. On 2026-09-02 there were seven
-- usage_events rows and six assistant messages. Six of the seven sit within
-- one second of a stored message; the seventh, at 00:20:25 with 1,900 output
-- tokens, is fifteen seconds from the nearest one, and sixteen seconds later a
-- second full reply landed and matched. That is the shape of a clobbered turn,
-- and reading the route confirmed it.
--
-- ── WHY IT IS REACHABLE DESPITE THE CLIENT GUARD ────────────────────────────
--
-- The composer disables the send button while a request is in flight, so one
-- tab cannot do it. Two can, and so can the case this product already knows
-- about: iOS kills the fetch when the app is backgrounded, the catch clears
-- the busy flag, the server carries on regardless, and the athlete - who has
-- seen nothing - sends again. The recovery path exists precisely because that
-- happens, which makes this the likeliest way to hit it rather than the least.
--
-- ── APPEND, RATHER THAN COMPARE-AND-RETRY ───────────────────────────────────
--
-- Optimistic concurrency (`.eq('updated_at', ...)` plus a retry) would detect
-- the collision and then have to decide what to do about it, and the only
-- decent answer is to append anyway. So append directly: `messages ||
-- jsonb_build_array(...)` is one atomic statement, both exchanges survive in
-- arrival order, and there is no failure mode to handle. The reply was
-- composed against a history a few seconds stale, which is what happens in any
-- conversation where two messages cross, and is enormously better than
-- deleting one of them.
--
-- ── SECURITY INVOKER, DELIBERATELY ──────────────────────────────────────────
--
-- Every other function in this schema is SECURITY DEFINER because each one
-- needs to reach something the caller cannot - a private counter, a
-- projection table, an owner-rights write. This one needs nothing of the sort:
-- it touches `public.conversations`, which the athlete already has RLS-scoped
-- access to. Running it as the caller means `where id = p_conversation` can
-- only ever match a row the caller owns, enforced by the same policy that
-- protects every other read, and the function confers no privilege at all.
--
-- Definer here would be strictly worse: it would take the id from an argument
-- while bypassing RLS, which is the exact shape this project has been careful
-- to avoid everywhere else. The search_path is still pinned and every
-- reference still schema-qualified, because that is hygiene rather than a
-- consequence of definer.
-- =============================================================================

create or replace function public.append_conversation_turn(
  p_conversation uuid,
  p_user_message text,
  p_assistant_message text,
  p_window integer default 30
)
returns jsonb
language sql
set search_path to ''
as $fn$
  with appended as (
    update public.conversations
       set messages = coalesce(messages, '[]'::jsonb) || jsonb_build_array(
             jsonb_build_object('role', 'user',      'content', p_user_message,      'at', now()),
             jsonb_build_object('role', 'assistant', 'content', p_assistant_message, 'at', now()))
     where id = p_conversation
    returning messages
  )
  -- The tail the client renders, so the response describes what is actually
  -- stored - including the other request's exchange when two crossed. Sending
  -- the array the API built locally would show the athlete a conversation that
  -- disagrees with the one they will see on reload.
  --
  -- NO `from appended` ON THE OUTER SELECT, and that is the whole difference
  -- between returning `[]` and returning NULL. Written the obvious way -
  -- `select coalesce(...) from appended` - the outer select produces no rows
  -- at all when the UPDATE matched none, and a scalar SQL function with no
  -- rows returns SQL NULL; the coalesce never runs, because there is nothing
  -- to run it on. Measured as `authenticated` against a conversation belonging
  -- to somebody else: it came back NULL, not the documented `[]`.
  --
  -- Referencing the CTE only inside the subquery is safe: a data-modifying
  -- WITH is executed exactly once and always to completion, whether or not the
  -- primary query reads its output. So the append still happens, and the
  -- function now always returns exactly one row.
  select coalesce(
           (select jsonb_agg(m order by ord)
              from appended,
                   lateral jsonb_array_elements(appended.messages) with ordinality t(m, ord)
             where ord > greatest(jsonb_array_length(appended.messages) - p_window, 0)),
           '[]'::jsonb);
$fn$;

comment on function public.append_conversation_turn(uuid, text, text, integer) is
  'Append one user/assistant exchange to a conversation atomically and return the tail window. SECURITY INVOKER: RLS on public.conversations is what scopes it to the caller''s own row. Replaces a read-modify-write in the API that silently erased one of two overlapping turns.';

revoke all on function public.append_conversation_turn(uuid, text, text, integer) from public;
grant execute on function public.append_conversation_turn(uuid, text, text, integer) to authenticated;

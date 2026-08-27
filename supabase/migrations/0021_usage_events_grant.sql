-- =============================================================================
-- 0021 — usage_events was unwritable, and nothing said so
--
-- FOUND BY: auditing the data export against the schema, while checking the
-- three policy documents. Not by anything failing.
--
-- ── THE BUG ──────────────────────────────────────────────────────────────────
--
-- Migration 0020 created usage_events, enabled RLS, and wrote both policies.
-- It never granted the table to `authenticated`. RLS narrows a privilege that
-- has been granted; it does not grant one. So every insert from the chat route
-- returned "permission denied for table usage_events" and the table stood at
-- zero rows against three real conversations.
--
-- ── WHY NOBODY NOTICED ───────────────────────────────────────────────────────
--
-- Because the insert is deliberately fire-and-forget. That decision is right
-- and stays: an athlete must never lose a coaching reply they already received
-- because a metrics row failed to write. But "failures are survivable" was
-- allowed to become "failures are invisible" - the error went to
-- logger.warn('usage.record_failed') in a promise nobody was reading.
--
-- The cost this bug had was not user-facing at all. usage_events exists to
-- answer "what does an active athlete cost per month", which is the input to
-- every pricing decision, and it was answering it with silence.
--
-- ── WHAT THIS GRANTS, AND WHAT IT DOES NOT ───────────────────────────────────
--
-- select and insert only, matching 0020's policies exactly. No update and no
-- delete, for the reason 0020 gives: a cost record that can be edited after
-- the fact is not a cost record. Rows are removed only by the user_id foreign
-- key when an account is erased.
-- =============================================================================

grant select, insert on public.usage_events to authenticated;

-- No backfill. The rows that were refused carried token counts for calls that
-- have already happened and were never recorded anywhere else; inventing them
-- from the conversation history would be manufacturing cost data, which is
-- worse than a gap that is documented.
comment on table public.usage_events is
  'One row per model call: tokens and cost only. Contains no message content and must never be extended to. Exists to answer what an active athlete costs per month, which is the input to every pricing decision. NOTE: empty before 2026-08-27 - see migration 0021, the table was ungranted and every insert was refused.';

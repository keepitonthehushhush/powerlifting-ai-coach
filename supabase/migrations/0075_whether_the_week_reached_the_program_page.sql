-- =============================================================================
-- 0075  Whether the week reached the Program page
-- =============================================================================
--
-- ── THE QUESTION NOBODY CAN ANSWER ───────────────────────────────────────────
--
-- workout_programs holds rows for exactly one account: the owner's. Read from
-- production on 2026-09-14, and it has been the shape of this table for the
-- life of the product. One athlete sent ten messages, logged a session, and has
-- no program. Another sent four and has none.
--
-- The route already knows why, every single time. It computes a one-word
-- outcome for the program block on every reply - storable, gated, unusable,
-- absent, or one of the repair results - and the comment above that line says
-- exactly what it is for: "Three explanations fit and they need completely
-- different fixes... A single word in the completion line separates them. It is
-- not the fix; it is the thing that says which fix to build."
--
-- It is written to a logger.info. This platform keeps runtime logs for about a
-- day and gates historical reads behind the plan. So the word that says which
-- fix to build has been computed several hundred times and read approximately
-- never.
--
-- This is the same defect migration 0073 fixed for stop_reason, sitting on the
-- more expensive problem. And it is now urgent rather than tidy: the first-week
-- panel shipped this morning tells every new athlete "your program lands on the
-- Program tab", which is a promise the product has kept for one person.
--
-- ── WHY usage_events AND NOT A TABLE OF ITS OWN ──────────────────────────────
--
-- Same argument as 0073. There is already exactly one row per reply. Whether
-- that reply carried a program belongs beside what it cost and how it ended,
-- because the three questions are asked together: a reply that hit its token
-- ceiling and lost its block is one row, not a join.
--
-- ── A CLOSED SET, AND WHY absent IS NOT A FINDING ────────────────────────────
--
-- Nine values, ours, constrained here and mirrored by recordableProgramOutcome
-- in code with a test holding the two together.
--
-- Most replies are not programs, so most rows will read 'absent', and that is
-- correct rather than a problem: the route's own comment defines absent as no
-- block AND no session that wanted one. The rows that answer the question are
-- 'gated', 'unusable' and the repair_* family, and the ratio that matters is
-- those against 'storable'.
--
-- Nullable, and every row written before today stays null. Backfilling it from
-- anything would be a guess recorded as a fact.
-- =============================================================================

alter table public.usage_events
  add column if not exists program_outcome text;

alter table public.usage_events
  drop constraint if exists usage_events_program_outcome_check;

alter table public.usage_events
  add constraint usage_events_program_outcome_check
  check (
    program_outcome is null
    or program_outcome in (
      'storable', 'gated', 'unusable', 'absent',
      'repaired', 'repair_declined', 'repair_unusable', 'repair_failed', 'repair_skipped_slow',
      'other'
    )
  );

comment on column public.usage_events.program_outcome is
  'What happened to the machine-readable program block on this reply: storable (emitted and stored), gated (emitted, withheld by the medical clearance gate), unusable (emitted and failed validation), absent (no block and no session that wanted one), or one of the repair results from the second transcription call. An unrecognized value is stored as other rather than passed through. Exists because workout_programs has only ever held rows for one account and the word that says why was going to a log stream this platform keeps for a day. Null for every row written before 2026-09-14 and deliberately not backfilled. Not health data and never sent to the model.';

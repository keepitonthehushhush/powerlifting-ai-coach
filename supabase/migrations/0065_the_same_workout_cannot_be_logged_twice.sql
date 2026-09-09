-- =============================================================================
-- 0065_the_same_workout_cannot_be_logged_twice.sql
--
-- ── THE TWO WAYS ONE SESSION BECOMES TWO ROWS ───────────────────────────────
--
-- The coach now offers to log a workout the athlete described, and they tap
-- yes. Two paths write it twice, and an adversarial review found both:
--
--   1. A SAVE THAT FAILED AFTER COMMITTING. A proxy 502, a timeout, a dropped
--      connection - the request rejects, the card deliberately stays up so the
--      athlete can try again, and the second yes inserts a second row.
--
--   2. THE COACH OFFERING THE SAME SESSION AGAIN. The block is stripped before
--      the reply is stored, so the model's own transcript holds no trace that
--      it already offered one. The prompt tells it not to repeat itself; it is
--      being asked to remember something the pipeline erased.
--
-- Both produce a duplicate that reads to the progression and deload rules as
-- extra volume that was never lifted - "wrong in a way that looks like data",
-- which is the exact failure sessionLogBlock.js says it exists to prevent.
--
-- ── WHY A CONTENT KEY RATHER THAN A REQUEST ID ──────────────────────────────
--
-- A per-request idempotency token fixes (1) and does nothing for (2), because
-- a re-offer is a genuinely new request. A key DERIVED FROM THE SESSION - its
-- date and its movements - is the same string both times, so one constraint
-- closes both doors.
--
-- ── AND WHY NULL IS ALLOWED, DELIBERATELY ───────────────────────────────────
--
-- Postgres permits many NULLs in a unique constraint, and that is the whole
-- reason this shape was chosen. The manual log form sends no key, so somebody
-- entering two identical sessions by hand is not fought - they meant it, they
-- typed it twice. Only the coach's proposals carry a key, and only they are
-- deduplicated.
--
-- ── WHAT THIS COSTS ─────────────────────────────────────────────────────────
--
-- An athlete who genuinely trained twice in one day with identical movements,
-- identical sets, reps and loads, and who describes both to the coach, gets
-- the second one refused. That is rare enough to accept and it is stated here
-- rather than discovered later - and the manual form still takes it, which is
-- the escape hatch that makes the trade honest.
--
-- The route turns the violation into "this is already logged" and returns the
-- existing row, so a duplicate is a calm answer rather than an error. A person
-- who taps yes twice should be told it is saved, because it is.
-- =============================================================================

alter table public.workout_sessions
  add column if not exists client_key text
    check (client_key is null or client_key ~ '^[0-9a-f]{1,32}$');

comment on column public.workout_sessions.client_key is
  'Stable key derived from a coach-proposed session (its date and movements), used only to stop one workout being written twice - by a retry after a save that failed late, or by the coach offering the same session again. NULL for sessions entered by hand, and many NULLs are allowed on purpose so identical manual entries are never refused. See migration 0065.';

-- Unique per person, not globally: two athletes doing the same workout on the
-- same day is the ordinary case, not a collision.
create unique index if not exists workout_sessions_client_key_idx
  on public.workout_sessions (user_id, client_key)
  where client_key is not null;

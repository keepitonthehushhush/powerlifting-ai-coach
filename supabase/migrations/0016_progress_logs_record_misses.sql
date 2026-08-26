-- =============================================================================
-- 0016_progress_logs_record_misses.sql
--
-- progress_logs describes itself, in 0001, as "the substrate for charts and for
-- the AI's progression decisions". It was not that, because routes/sessions.js
-- filtered failed sets out of the fan-out before inserting. Every miss lived
-- only inside workout_sessions.exercises as jsonb.
--
-- That matters now that progression is computed rather than improvised. The
-- deload rule triggers on three consecutive misses; a table that stores only
-- successes cannot answer the question the rule asks, and would have reported
-- an unbroken run of good sessions to an athlete who had failed nine times.
--
-- Existing rows are all completed work by construction, so the default is
-- correct history rather than an assumption.
-- =============================================================================

alter table public.progress_logs
  add column completed boolean not null default true;

comment on column public.progress_logs.completed is
  'Whether the athlete finished the prescribed work. False rows are the input to the deload rule, not noise to be filtered out.';

-- The progression engine reads one lift''s history in date order and stops
-- caring quickly, so the existing (user_id, lift, date) index is the right
-- one. This adds nothing to it.

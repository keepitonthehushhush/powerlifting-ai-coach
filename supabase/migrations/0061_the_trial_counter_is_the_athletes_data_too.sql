-- =============================================================================
-- 0061_the_trial_counter_is_the_athletes_data_too.sql
--
-- trial_status() reports the whole row, so the data export can include it.
--
-- ── HOW THIS WAS MISSED ─────────────────────────────────────────────────────
--
-- The rule in this repository is explicit and predates the trial: every
-- user-scoped table needs ON DELETE CASCADE from auth.users AND a line in the
-- data export, and a table is not finished until both exist.
-- exportCompleteness.test.js enforces the second half.
--
-- It could not enforce it here. The scanner reads
-- `create table (if not exists )?public\.([a-z_]+)` from the migrations, so it
-- sees only tables declared in `public`. Every user-scoped table WAS in public
-- when that was written, and `rate_limit_counters` - the one that lives in
-- private today - was created in public by 0005 and moved by 0006, so its name
-- is still in the historical scan and its exclusion entry still works.
--
-- private.trial_usage (0057) is the first table in this schema born private.
-- The guard never saw it, nothing failed, and a subject access request has
-- been quietly missing how many free replies somebody used, when they started
-- and when they last used one. That is a legal obligation answered
-- incompletely, produced by a check that was correct on the day it was written
-- and silently stopped covering the schema.
--
-- The test now scans `private.` as well, with a floor assertion naming a
-- private table so it cannot go blind again without failing.
--
-- ── WHY THE FUNCTION AND NOT A GRANT ────────────────────────────────────────
--
-- The obvious alternative is to let `authenticated` select from
-- private.trial_usage for the export. That would undo the entire reason the
-- counter is there rather than on user_profile: `authenticated` holds no grant
-- in private, which is what makes the trial impossible to reset from a network
-- tab (migration 0032 for why a column-level revoke would not have done it).
--
-- So the export reads it the same way the leaderboard row is read - through a
-- definer function that returns the caller's own row and nothing else. Same
-- shape, same reason, and it is the pattern EXPORTED_VIA already exists for.
--
-- ── AND WHY DELETION STILL WINS OVER THE TRIAL ──────────────────────────────
--
-- private.trial_usage cascades from auth.users, so deleting an account erases
-- the counter with everything else. That means somebody can delete their
-- account, sign up again and get a fresh 25 replies.
--
-- That is a deliberate trade and it is recorded here so nobody "fixes" it. The
-- only way to close it is to keep something about a person after they asked to
-- be erased - a retained email hash - which is a worse thing to do than to
-- give away $1.78 of coaching to somebody willing to destroy their own
-- program, logs and history to get it. Erasure is a promise; the trial is a
-- marketing cost.
-- =============================================================================

-- ── AMENDED 2026-09-09: THIS FILE COULD NOT REPLAY ──────────────────────────
--
-- 0057 created trial_status() returning three columns; this one returns five.
-- CREATE OR REPLACE cannot do that: "will not let you change the return type
-- of an existing function... To do that, you must drop and recreate the
-- function" (PostgreSQL, CREATE FUNCTION). Adding output columns changes the
-- anonymous composite type the result describes, so replaying 0057 and then
-- this one into an empty database fails at exactly this statement with 42P13.
--
-- Production has the five-column function because it was applied by hand with
-- the drop included, and the file was never brought back into line. That is
-- the ADR-18 defect in its purest form: the database was right and the
-- repository was wrong, and only replaying the files could show it.
--
-- The drop is added here rather than in a later migration because a later one
-- would leave this file still unable to replay, and "the migration directory
-- can rebuild the database" is the property worth having. It is idempotent and
-- the grants below are re-applied in this same file, so a drop takes nothing
-- with it that this file does not immediately put back.
--
-- migrationReplay.test.js now fails on any function replaced with a different
-- return signature, so the next one cannot sit here for a month.
drop function if exists public.trial_status();

create or replace function public.trial_status()
returns table(used integer, allowance integer, remaining integer,
              started_at timestamptz, last_reply_at timestamptz)
language sql stable security definer
set search_path to ''
as $fn$
  select coalesce(t.replies_used, 0),
         public.trial_reply_allowance(),
         greatest(public.trial_reply_allowance() - coalesce(t.replies_used, 0), 0),
         t.started_at,
         t.last_reply_at
    from (select auth.uid() as uid) u
    left join private.trial_usage t on t.user_id = u.uid
   where u.uid is not null;
$fn$;

comment on function public.trial_status() is
  'What is left of the caller''s free trial, and when it started and was last used. Reads only - never spends. The whole of private.trial_usage for this caller, so the data export can be complete without granting anybody access to the table.';

revoke all on function public.trial_status() from public;
grant execute on function public.trial_status() to authenticated;

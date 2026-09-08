-- =============================================================================
-- 0064_where_they_stop_between_the_form_and_the_first_message.sql
--
-- One column, and one existing column made to mean what it is called.
--
-- ── THE QUESTION ────────────────────────────────────────────────────────────
--
-- Of six real signups, four completed the intake form and then sent the coach
-- ZERO messages. Every one of them left the same day. That is the entire
-- product failing at one step, and the database cannot say which step:
--
--   they finished the form and never reached the coach page   -> a BUG
--   they reached it, read it, and did not type                -> a DESIGN problem
--
-- Those have opposite fixes and there is currently no way to tell them apart.
-- Same lesson as 0062, which separated "never came back" from "came back and
-- abandoned the form": add the log line the moment you notice you cannot
-- answer a question about somebody who has already left. It does not help
-- them. It answers the next one.
--
-- ── coach_first_opened_at ───────────────────────────────────────────────────
--
-- The first time this account successfully loaded its conversation, which in
-- practice is the coach page rendering. Not "they saw the openers" and not
-- "they were happy" - just that the page they were sent to answered.
--
-- With intake_completed_at on one side and the first row in `conversations` on
-- the other, the gap is finally addressable: a null here after a completed
-- intake is a routing or loading failure, and a value here with no
-- conversation is a page somebody looked at and walked away from.
--
-- ── AND WHY intake_completed_at IS BEING FIXED RATHER THAN TRUSTED ──────────
--
-- It has existed since 0001 and the route stamps it on EVERY profile save, so
-- it holds the last time somebody edited their intake, not the first time they
-- finished it. The developer's own row says 2026-09-01 for an intake completed
-- on 2026-08-25. A funnel built on that column would have quietly reported
-- people completing intake weeks after they actually did, and nothing would
-- have looked wrong.
--
-- It is write-once from now on, in the route, the same way 0062 does it.
-- ROWS WRITTEN BEFORE THIS MIGRATION STILL HOLD A LAST-SAVE TIME and cannot be
-- recovered - that is stated here rather than quietly assumed away, because
-- somebody will one day plot this column and deserve to know its first three
-- points are a different measurement.
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
--
-- Not health data: it says nothing about a body. Not sent to the model -
-- entered in policyDisclosure.test.js as bookkeeping, the same as the two
-- timestamps beside it. No new collection surface: it is the time of an
-- authenticated request the server already served. It rides the existing
-- ON DELETE CASCADE and the export's `select('*')`, so it is erased with the
-- account and included when somebody asks for their data.
--
-- Written through the CALLER'S OWN RLS-scoped client, so `authenticated`
-- necessarily holds UPDATE on it and a determined person can set their own
-- value. Left that way deliberately, for the reason 0062 gives: the worst
-- available outcome is one person's own funnel timestamp being wrong, in a
-- number nothing is enforced against.
-- =============================================================================

alter table public.user_profile
  add column if not exists coach_first_opened_at timestamptz;

comment on column public.user_profile.coach_first_opened_at is
  'First successful load of this account conversation, which in practice is the coach page rendering. Exists so that finished the intake and never reached the coach is distinguishable from reached it and did not type - a bug and a design problem, which need opposite fixes. Write-once through the caller own RLS-scoped client, so they hold UPDATE on it and the blast radius of tampering is their own funnel row. Not health data and never sent to the model.';

comment on column public.user_profile.intake_completed_at is
  'When the intake form was first completed. Write-once from migration 0064 onward. BEFORE 0064 the route stamped it on every profile save, so rows created earlier hold the last intake EDIT rather than the first completion - do not read the early points as first-completion times.';

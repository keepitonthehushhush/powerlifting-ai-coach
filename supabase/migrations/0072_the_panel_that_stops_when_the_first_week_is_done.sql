-- =============================================================================
-- 0072  The panel that stops when the first week is done
-- =============================================================================
--
-- ── THE FUNNEL THIS IS FOR ───────────────────────────────────────────────────
--
-- 2026-09-14, seven accounts, five of them real people rather than the owner's
-- two. Two never finished the intake form. One finished it in four minutes,
-- faced the composer, sent nothing, and never signed in again. Two talked to
-- the coach - one of them for ten exchanges, with a logged session - and have
-- no program.
--
-- Three different places to stop, and the openers from 0062-era work address
-- exactly one of them. server/src/lib/onboarding.js derives a short checklist
-- of the four stages of a first week, each one marked done from a row that
-- already exists: intake_completed_at, a message in the conversation, a
-- workout_programs row, a workout_sessions row.
--
-- ── WHY THIS COLUMN EXISTS AT ALL ────────────────────────────────────────────
--
-- Everything the panel SAYS is derived, so nothing about it needs storing. The
-- one thing that cannot be derived is "stop showing me this", and it needs a
-- home for two reasons rather than one.
--
-- The obvious one: a dismissal kept in the browser comes back on the next
-- device, which makes the product look like it does not listen.
--
-- The one that decides it: the route pays for two existence checks - does a
-- program row exist, does a session row exist - every time the coach page
-- loads. Without a stored end state it would pay for them forever, for every
-- athlete, for the entire life of the account. With it, the route stamps this
-- the moment the fourth step is done and never looks again. The column is what
-- makes the feature's cost finite.
--
-- ── WHY NOT A DEFINER FUNCTION ───────────────────────────────────────────────
--
-- ADR-12: exactly one service-role client in this product, and it is the
-- Stripe webhook. This column is written through the CALLER'S OWN RLS-scoped
-- client, exactly like profile_first_read_at (0062) and coach_first_opened_at
-- (0064), so `authenticated` already holds UPDATE on it and a determined
-- person can set their own value with a direct PostgREST call.
--
-- Left that way on purpose. The worst available outcome is that somebody hides
-- their own onboarding panel early, which is a thing the button does anyway.
-- Nothing is enforced against this column and nothing else reads it.
-- =============================================================================

alter table public.user_profile
  add column if not exists onboarding_hidden_at timestamptz;

comment on column public.user_profile.onboarding_hidden_at is
  'When the first-week panel stopped being shown to this account - set either by the athlete pressing Hide this, or by the route the moment all four steps are done. Its real job is to make the feature cost finite: while it is null the conversation route runs two existence checks per page load, and once it is set it runs none. Write-once through the caller own RLS-scoped client, so they hold UPDATE on it and the blast radius of tampering is their own onboarding panel. Not health data and never sent to the model.';

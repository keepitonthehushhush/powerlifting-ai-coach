-- Training history the coach can actually act on, and goals it can program for.
--
-- ── WHAT WAS WRONG WITH ASKING SOMEONE TO RATE THEMSELVES ─────────────────
--
-- experience_level offered three answers - never trained, some experience,
-- currently training - and every one of them is a self-assessment. Self-
-- assessment is the least reliable input we could have chosen. People with two
-- years of inconsistent training tick "currently training"; people who ran a
-- novice program a decade ago tick it too; a strong athlete from another sport
-- with no barbell experience has no honest box at all. The answer then feeds
-- straight into how the first program is written.
--
-- The fix is not more boxes. It is to stop asking for a judgement and start
-- asking about behaviour. Two questions, neither of which requires the athlete
-- to place themselves in a category:
--
--   experience_level  - how long have you actually been doing this
--   progress_cadence  - how fast has the weight on the bar been going up
--
-- The second is the one that matters, and it is the one nobody was asking.
-- The novice / intermediate / advanced framework, as Rippetoe originally set
-- it out and as Barbell Medicine still describes it, is defined by exactly
-- this: a novice adds weight session to session, an intermediate week to week,
-- an advanced lifter month to month. Barbell Medicine's own criticism of that
-- framework is worth taking seriously - they argue the biology does not switch
-- modes and that what really changes is how long you must wait before real
-- progress can be told apart from daily noise - but both readings agree on the
-- same practical point: cadence is an observation about what has been
-- happening, not a label to be worn. It is also the single fact that decides
-- whether linear progression is appropriate at all, which is what this app
-- runs on.
--
-- Someone can still answer either question wrongly. But "I have been training
-- about a year and the bar has not gone up in two months" is a memory, and
-- memories are far harder to get accidentally wrong than "am I intermediate?".
--
-- ── ON KEEPING THE OLD VALUES ─────────────────────────────────────────────
--
-- The three original values stay legal. They belong to rows real people
-- already saved, and the alternative is mapping them onto the new ladder -
-- which would mean deciding that "currently training" means, say, six to
-- twenty-four months. It does not mean that. It means nothing precise, which
-- is the entire reason it is being replaced, and inventing a precise value to
-- store would be worse than keeping an imprecise one that is at least true.
--
-- The intake form offers only the new values, so the legacy ones drain away as
-- people next open their profile.

alter table public.user_profile
  drop constraint if exists user_profile_experience_level_check;

alter table public.user_profile
  add constraint user_profile_experience_level_check
  check (experience_level is null or experience_level in (
    -- Current values, in order of training age.
    'never_lifted',
    'learning_lifts',
    'under_6_months',
    'six_to_24_months',
    'over_2_years',
    -- Legacy. Not offered by the form; retained so existing rows stay valid.
    'never_trained',
    'some_experience',
    'currently_training'
  ));

alter table public.user_profile
  add column if not exists progress_cadence text;

alter table public.user_profile
  drop constraint if exists user_profile_progress_cadence_check;

alter table public.user_profile
  add constraint user_profile_progress_cadence_check
  check (progress_cadence is null or progress_cadence in (
    'every_session',
    'every_week',
    'every_month_or_slower',
    'stalled',
    'no_history'
  ));

comment on column public.user_profile.progress_cadence is
  'How quickly load has been increasing recently, in the athlete''s own recollection. Training data, not health data: it says nothing about health status, so it sits outside private.health_fingerprint() and the consent gate deliberately. Used to decide whether linear progression is the right model at all.';

-- ── GOALS ─────────────────────────────────────────────────────────────────
--
-- Two options was too few to be useful: "get generally stronger" was absorbing
-- people who wanted to learn the lifts, people returning after a layoff, and
-- people preparing for a first meet, and those three need visibly different
-- programs. The additions are chosen by one test - can the coach, as it is
-- built today, actually do something different for this goal.
--
-- Two obvious candidates FAIL that test and are deliberately absent:
--
--   * making a weight class. This is a nutrition and fluid-manipulation
--     problem, and the system prompt's hard limits forbid prescribing calorie
--     targets, restriction plans, rapid cuts and fluid schedules - for good
--     reasons that have nothing to do with laziness. Offering it as a goal
--     would advertise something the product then refuses to do.
--   * building muscle. A real hypertrophy program differs from a strength
--     program in volume, rep ranges and exercise selection, and none of the
--     progression logic in this codebase is written for it. Adding the option
--     without the programming would be a lie told in a dropdown.
--
-- Both are worth building. Neither is worth listing before it is built.

alter table public.user_profile
  drop constraint if exists user_profile_goal_check;

alter table public.user_profile
  add constraint user_profile_goal_check
  check (goal is null or goal in (
    'learn_the_lifts',
    'general_strength',
    'return_from_layoff',
    'first_meet',
    'meet_prep'
  ));

-- A competition date now makes sense for either of the two meet goals. The
-- original constraint named meet_prep alone, so a first-time competitor could
-- not record the date they were training towards.
-- Named in 0001 as competition_date_requires_meet_prep; the new name says what
-- it now checks. Both drops are present because a re-run of this file must be
-- a no-op whichever name is currently in place.
alter table public.user_profile
  drop constraint if exists competition_date_requires_meet_prep;

alter table public.user_profile
  drop constraint if exists user_profile_competition_date_requires_goal;

alter table public.user_profile
  add constraint user_profile_competition_date_requires_goal
  check (competition_date is null or goal in ('meet_prep', 'first_meet'));

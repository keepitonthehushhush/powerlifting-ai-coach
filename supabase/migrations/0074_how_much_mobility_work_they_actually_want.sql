-- =============================================================================
-- 0074  How much mobility work they actually want
-- =============================================================================
--
-- ── THE COMPLAINT, AND WHY THE COACH WAS RIGHT ───────────────────────────────
--
-- "It does not provide the stretches."
--
-- The coach was doing exactly what it was told. WARM_UP guidance says, in the
-- prompt, "do not attach a generic stretching routine to every session: a list
-- nobody does is worse than a short one they do" - so an athlete who WANTS that
-- list has no way to ask for it that survives the conversation window. They ask
-- again, and again, and then stop asking.
--
-- Same shape as nutrition_detail in 0066, and the same answer: a setting is the
-- difference between a preference and a request.
--
-- ── ONE IMPORTANT ASYMMETRY WITH 0066 ────────────────────────────────────────
--
-- nutrition_detail can only ever NARROW, because its top level is what the
-- product already does and a wider one would cross a scope-of-practice line.
-- This column can WIDEN: `full` turns on an after-session block the prompt
-- currently suppresses.
--
-- That is defensible because programming range-of-motion work is inside a
-- strength coach's scope, and it is bounded by what the level may CLAIM rather
-- than by what it may prescribe. Which is where the evidence comes in.
--
-- ── FLEXIBILITY. NOT RECOVERY, AND NOT INJURY PREVENTION ─────────────────────
--
-- Three findings decide the framing, and the copy is held to them by a test:
--
--   * Static stretching BEFORE lifting measurably reduces force production -
--     it ranks last of every warm-up method tested for explosive strength. So
--     no level moves it before the session. The prompt already says this.
--   * Active cool-downs are, in Van Hooren and Peake's review, "largely
--     ineffective for improving most psychophysiological markers of
--     post-exercise recovery". So no level may sell this as recovery.
--   * The protective effect people expect from stretching comes from warm-ups
--     and from getting stronger through full range, not from lengthening
--     tissue. So no level may sell this as injury prevention.
--
-- What is left is the honest claim: it improves range of motion, and range of
-- motion is worth having in a squat. Resistance training through full range
-- does much the same job (g = 0.63, against stretching's ES = 0.08), which is
-- why `brief` rather than `full` is the default - most athletes get most of it
-- from the lifting itself.
--
-- ── AND WHAT SITS ABOVE ALL THREE LEVELS ─────────────────────────────────────
--
-- The undiagnosed-injury rule. An athlete who has reported a symptom and has
-- not been cleared may not be offered stretches, mobility work, "corrective"
-- exercises or rehab movements AT ANY LEVEL - that is a clinical call, and a
-- preference does not move one. `full` is a preference about a healthy
-- athlete's programming; it is not consent to be treated.
--
-- Default 'brief' = what every athlete received before this column existed. A
-- migration that adds a setting AND changes behavior for everybody already
-- using the product has made two changes that can only be debugged as one.
-- =============================================================================

alter table public.user_profile
  add column if not exists mobility_detail text not null default 'brief'
    check (mobility_detail in ('off', 'brief', 'full'));

comment on column public.user_profile.mobility_detail is
  'How much mobility and stretching work this athlete wants programmed: off (none unless asked), brief (targeted drills only where there is a specific reason - what every athlete received before this column existed), or full (a short range-of-motion block after the session). NOT health data and deliberately outside private.health_fingerprint(), for the same reason as nutrition_detail: gating a preference behind health consent traps the people most likely to want it changed. No level may present this as recovery or as injury prevention - the evidence does not support either - and no level applies to an athlete with an undiagnosed symptom, where suggesting mobility work is a clinical call a preference cannot authorize. Never logged with its value. See migration 0074.';

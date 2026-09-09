-- =============================================================================
-- 0066_how_much_of_the_food_conversation_they_actually_want.sql
--
-- ── THE PROBLEM WITH A COACH WHO ALWAYS TALKS ABOUT FOOD ────────────────────
--
-- The fueling and food sections are good and they are also unconditional. Every
-- athlete gets protein ranges applied to their bodyweight, meal examples,
-- portions and prep advice, whether that is the help they came for or the last
-- thing they wanted.
--
-- For most people that is a feature. For some it is not, and the ones it is
-- worst for are the ones least able to say so: somebody in recovery from an
-- eating disorder, somebody who has been told by a dietitian to stop reading
-- macro numbers, somebody who simply wants a barbell coach. The product's
-- answer today is "raise it in conversation and hope the model remembers",
-- which is not an answer - the transcript is windowed and the setting is not a
-- setting, it is a sentence somebody has to keep repeating.
--
-- ── THREE LEVELS, AND WHY NOT MORE ──────────────────────────────────────────
--
--   off     Do not raise food. Answer briefly if asked and say the setting can
--           be changed. This is a real position, not a degraded one.
--   ranges  The published population ranges and the timing advice, applied to
--           their bodyweight as arithmetic. No meals, no portions, no plates.
--   meals   Everything above plus real food: what a day of eating looks like,
--           what keeps in the fridge, what to eat before a 6am session.
--
-- `meals` is the default because it is exactly what every athlete gets today.
-- A migration that changes behavior for existing users while adding a setting
-- makes two changes and can only be debugged as one.
--
-- There is no fourth level, and this is the important part: NO SETTING UNLOCKS
-- A CALORIE TARGET OR A PRESCRIBED MEAL PLAN. That line is a scope-of-practice
-- line - individualized meal planning and specific intake recommendations are
-- outside what a fitness professional may provide (ACE) - and a scope line does
-- not move because the person it protects ticked a box. The preference chooses
-- among things the coach may already say. It cannot authorize anything else,
-- and nutritionDetail.test.js asserts that no level's directive grants a
-- permission the unconditional sections withhold.
--
-- ── WHY THIS COLUMN IS NOT HEALTH DATA, AND IS NOT IN THE FINGERPRINT ───────
--
-- It lives on user_profile, which is the RLS-protected table the export already
-- covers, because it is a fact about this athlete rather than an interface
-- preference like the theme. It is deliberately OUTSIDE
-- private.health_fingerprint(), which is the list that decides what the consent
-- trigger gates.
--
-- That is not an oversight and the reasoning runs backwards from the obvious:
-- putting it inside the fingerprint would make changing it require active
-- health consent, and THE PERSON MOST LIKELY TO WANT FOOD TALK TURNED OFF IS
-- THE PERSON LEAST LIKELY TO HAVE GRANTED IT. A withdrawal of health consent
-- would also clear the setting, silently returning somebody to the full food
-- conversation at the exact moment they asked for less. A control that traps
-- people at the setting they are trying to leave is worse than no control.
--
-- The value is never written to a log. It is one of three known strings and
-- carries no free text, but "somebody set food talk to off" is an inference
-- about a person that a log line has no reason to hold.
-- =============================================================================

alter table public.user_profile
  add column if not exists nutrition_detail text not null default 'meals'
    check (nutrition_detail in ('off', 'ranges', 'meals'));

comment on column public.user_profile.nutrition_detail is
  'How much of the food conversation this athlete wants: off (do not raise it), ranges (population ranges and timing only), or meals (also real food, portions and prep). Defaults to meals, which is what every athlete received before this column existed. NOT health data and deliberately outside private.health_fingerprint() - gating it behind health consent would trap the people most likely to want it turned off. No level unlocks a calorie target or a prescribed meal plan; those are a scope-of-practice line and a preference does not move one. Never logged with its value. See migration 0066.';

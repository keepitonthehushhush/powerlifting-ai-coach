-- =============================================================================
-- 0018_seed_exercise_library.sql
--
-- The exercise library has existed since migration 0001 and has been empty ever
-- since. That was not a cosmetic gap. systemPrompt.js says, when the library
-- has no rows, that the coach must NOT link, name or describe any
-- demonstration video at all - so every athlete asking how to squat was told
-- video references were "coming soon" and given verbal cues only. Form guidance
-- is one of the five things this product promises, and it was degraded for
-- beginners, who need it most.
--
-- ── ON THE LINKS ─────────────────────────────────────────────────────────────
--
-- No video is hosted, embedded, mirrored or reproduced. video_url points at the
-- rights holder's own website. Starting Strength publishes these on
-- startingstrength.com, and linking their page rather than a YouTube ID means
-- the destination is unambiguously theirs and stays under their control - if
-- they reorganise or withdraw a video, the link degrades to their own site
-- rather than to a dead ID or, worse, a reuploaded copy on someone else's
-- channel.
--
-- Every URL below was fetched and confirmed to be the video it claims to be
-- before it was written here, rather than recalled. A model asked to remember a
-- "reputable demo link" produces a plausible dead one, which is precisely why
-- the prompt forbids the coach from inventing them and why this table exists.
--
-- ── ON THE CUES ──────────────────────────────────────────────────────────────
--
-- Written here rather than quoted. These are short functional instructions of
-- the kind any coach gives on a platform, phrased in our own words. This file
-- does not reproduce anyone's instructional text.
--
-- Single-source dependency is a known weakness: all four links are Starting
-- Strength. If that site goes away, the library empties and the coach falls
-- back to verbal cues. A second rights holder per lift would fix it and is
-- worth doing before this is a paid product.
-- =============================================================================

insert into public.exercise_library (slug, name, category, cues, common_faults, video_url, video_source)
values
  (
    'low-bar-back-squat',
    'Low-bar back squat',
    'squat',
    array[
      'Set the bar on the rear delts, below the bony ridge of the shoulder blade, not on the neck.',
      'Stance about shoulder width, toes turned out roughly 30 degrees.',
      'Take a big breath and hold it before you descend, and keep holding until you are back up.',
      'Shove your hips back and let the knees travel out over the toes.',
      'Break parallel: the crease of the hip goes below the top of the kneecap.',
      'Drive the hips up out of the bottom and keep the bar over mid-foot the whole way.'
    ],
    array[
      'Coming up out of the bottom with the hips first, turning the squat into a good morning.',
      'Knees drifting inward under load.',
      'Cutting depth - stopping above parallel, usually without knowing it.',
      'Breathing at the bottom, which loses the brace exactly when it is needed.',
      'Looking up at the ceiling, which pulls the chest up and the bar out of line.'
    ],
    'https://startingstrength.com/video/learning-to-squat-the-starting-strength-method',
    'Starting Strength'
  ),
  (
    'bench-press',
    'Bench press',
    'bench',
    array[
      'Eyes under the bar, feet flat and planted, shoulder blades pulled together and down.',
      'Grip so the forearms are vertical at the bottom, not flared wide.',
      'Take the bar to the lower chest, not the throat.',
      'Keep the elbows at roughly 45 degrees to the torso rather than straight out to the sides.',
      'Breath held on the way down, press, then breathe between reps.',
      'The bar travels in a slight arc: down to the chest, up and back over the shoulder joint.'
    ],
    array[
      'Bouncing the bar off the chest.',
      'Elbows flaring to 90 degrees, which puts the shoulder in its least stable position.',
      'Losing the upper-back tightness so the shoulders roll forward under load.',
      'Feet moving, or heels lifting, which leaks the drive.',
      'Pressing straight up from the chest instead of back over the shoulder.'
    ],
    'https://startingstrength.com/video/learning-to-bench-press-the-starting-strength-method',
    'Starting Strength'
  ),
  (
    'conventional-deadlift',
    'Conventional deadlift',
    'deadlift',
    array[
      'Bar over mid-foot before you touch it. It does not move to you; you come to it.',
      'Stance narrower than a squat, shins about an inch from the bar.',
      'Grip just outside the legs, then bend the knees until the shins touch the bar.',
      'Squeeze the chest up to set the back flat before you pull.',
      'Take the slack out of the bar, then drag it up the legs.',
      'Finish standing tall with the hips through - no leaning back at the top.'
    ],
    array[
      'Starting with the bar too far forward, which pulls you onto your toes.',
      'Rounding the lower back - the one fault worth stopping a set for.',
      'Jerking the bar off the floor before the slack is out.',
      'Hips shooting up first so the bar leaves the floor with the back at a worse angle.',
      'Hyperextending at the top, which does nothing for the lift and loads the spine.'
    ],
    'https://startingstrength.com/video/learning-to-deadlift',
    'Starting Strength'
  ),
  (
    'overhead-press',
    'Overhead press',
    'press',
    array[
      'Bar on the heels of the palms, resting on the front delts, elbows slightly in front of the bar.',
      'Stance about hip width, squeeze the glutes and brace the trunk.',
      'Big breath, then press the bar up in a straight line past the face.',
      'As the bar clears the head, push the head and torso forward under it.',
      'Finish with the bar over the mid-foot, elbows locked, shoulders shrugged up.',
      'Come back down to the front delts and reset the breath between reps.'
    ],
    array[
      'Pressing the bar forward around the face instead of moving the face out of the way.',
      'Leaning back at the hips to turn it into an incline press.',
      'Finishing with the bar in front of the body rather than over the mid-foot.',
      'Letting the elbows drop behind the bar at the start.',
      'Missing the shrug at lockout, which leaves the shoulder unsupported overhead.'
    ],
    'https://startingstrength.com/video/learning-to-press',
    'Starting Strength'
  )
on conflict (slug) do update set
  name          = excluded.name,
  category      = excluded.category,
  cues          = excluded.cues,
  common_faults = excluded.common_faults,
  video_url     = excluded.video_url,
  video_source  = excluded.video_source;

-- =============================================================================
-- 0023 — where somebody trains, and closing the under-18 gap
--
-- ── PART 1: THE GYM ──────────────────────────────────────────────────────────
--
-- `equipment_available` is free text and is one of the worst-answered questions
-- on the intake form. People write "the gym". The program is computed from that
-- answer, so a thin answer produces a program built on guesses.
--
-- gym_chains lets somebody name where they train, which pre-fills the text box
-- with something close that they then correct. It is stored ALONGSIDE the text
-- rather than replacing it: the text is still the answer, the chain is context.
--
-- The reason it is worth a column rather than a UI convenience is Planet
-- Fitness, which has no Olympic barbell and no squat rack. A powerlifting
-- program assumes both. The coach has to be told, and told in code, not left to
-- infer it from a sentence in a text box.
--
-- gym_label is deliberately FREE TEXT and deliberately not an address. No chain
-- publishes a per-branch equipment list, so a precise location would buy no
-- accuracy - and precise location stored next to injury data is a named
-- sensitive category under MHMDA and materially worse in a breach. What this
-- holds is whatever the athlete types to remind themselves which club they mean.
-- There is no geocoding, no lookup and no map anywhere in this product.
--
-- ── PART 2: THE ADULT GATE ───────────────────────────────────────────────────
--
-- Until now the terms said the service was for adults and nothing refused an
-- account. The age gate blocked STORING health data below 18 and let everything
-- else through, so a 15-year-old could sign up and be coached. That gap is
-- closed in the application (see requireAdult), and this column is what the
-- gate reads.
--
-- The database cannot enforce it on its own, because date_of_birth is
-- self-reported and nothing here can verify it. What the database can do is
-- refuse to hold an obviously impossible one, so a typo is caught at the
-- boundary rather than producing an age of 900 in a prompt.
-- =============================================================================

alter table public.user_profile
  add column if not exists gym_chains text[] not null default '{}',
  add column if not exists gym_label  text;

-- A closed set, mirroring GYM_SLUGS in server/src/lib/gyms.js. A CHECK rather
-- than a foreign key: this is a short fixed vocabulary that changes with the
-- code, not reference data with a life of its own.
alter table public.user_profile
  add constraint gym_chains_known check (
    gym_chains <@ array[
      'planet_fitness','anytime_fitness','golds_gym','la_fitness','crunch',
      'snap_fitness','ymca','university_gym','barbell_gym','home_gym','other'
    ]::text[]
  );

-- Bounded, because it is free text that reaches a prompt.
alter table public.user_profile
  add constraint gym_label_length check (gym_label is null or length(gym_label) <= 120);

-- Impossible dates refused at the boundary. Not an age check - the rule lives
-- in one place, lib/ageGate.js - just a floor and a ceiling on what a human
-- date of birth can be.
alter table public.user_profile
  add constraint date_of_birth_plausible check (
    date_of_birth is null
    or (date_of_birth > date '1900-01-01' and date_of_birth <= current_date)
  );

comment on column public.user_profile.gym_chains is
  'Which commercial gym chains the athlete trains at. Context for the equipment answer, not an equipment database: no chain publishes per-branch inventories and every profile is a suggestion the athlete confirms.';
comment on column public.user_profile.gym_label is
  'Free-text branch label the athlete types for their own reference, e.g. "Kietzke Lane". Deliberately NOT an address and never geocoded: a precise location beside health data is a sensitive category under MHMDA and would buy no programming accuracy.';

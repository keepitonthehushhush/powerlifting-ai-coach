-- =============================================================================
-- 0001_initial_schema.sql
-- Core domain tables for the Powerlifting AI Coach.
--
-- Design notes (see ARCHITECTURE.md for the long form):
--   * Every user-owned table carries a denormalised `user_id` referencing
--     auth.users. This is deliberate: RLS policies become a single-column
--     predicate with no joins, which keeps them both fast and auditable.
--     A policy you cannot read in one line is a policy you cannot trust.
--   * ON DELETE CASCADE everywhere. Deleting an auth user must actually purge
--     their health data, not orphan it.
--   * CHECK constraints instead of Postgres ENUM types. Enums require
--     ALTER TYPE to extend and are awkward to roll back; a CHECK constraint is
--     a normal, reversible DDL statement in a migration.
--   * numeric(7,2) for loads, not double precision. Barbell weights are
--     decimal quantities; binary floats introduce rounding artefacts that show
--     up in progression maths.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- user_profile : one row per athlete, created automatically on signup (0003).
-- ----------------------------------------------------------------------------
create table public.user_profile (
  user_id             uuid primary key references auth.users (id) on delete cascade,

  experience_level    text
                      check (experience_level in ('never_trained','some_experience','currently_training')),

  current_squat       numeric(7,2) check (current_squat    is null or current_squat    >= 0),
  current_bench       numeric(7,2) check (current_bench    is null or current_bench    >= 0),
  current_deadlift    numeric(7,2) check (current_deadlift is null or current_deadlift >= 0),
  bodyweight          numeric(6,2) check (bodyweight       is null or bodyweight       >  0),

  units               text not null default 'lb' check (units in ('lb','kg')),

  goal                text check (goal in ('general_strength','meet_prep')),
  competition_date    date,

  -- Sensitive health information. See the health-data handling section of the
  -- README: never logged, never sent to error trackers, never leaves the row.
  health_restrictions text,
  cleared_to_train    boolean not null default false,

  equipment_available text,
  days_per_week       int check (days_per_week is null or days_per_week between 1 and 7),

  -- Stamped when the intake form is first submitted. Lets the prompt builder
  -- distinguish "not asked yet" from "asked, and the user has none".
  intake_completed_at timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- A competition date only means something when the athlete is peaking for one.
  constraint competition_date_requires_meet_prep
    check (competition_date is null or goal = 'meet_prep')
);

comment on table  public.user_profile is
  'Athlete intake and current state. Contains health information - treat as sensitive.';
comment on column public.user_profile.health_restrictions is
  'SENSITIVE: user-reported injuries and medical conditions. Must never be logged or forwarded to third-party observability.';

-- ----------------------------------------------------------------------------
-- workout_programs : an AI-generated training block.
-- ----------------------------------------------------------------------------
create table public.workout_programs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  week_number  int  not null default 1 check (week_number > 0),
  phase        text not null check (phase in ('novice','intermediate','peaking')),
  program_data jsonb not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- workout_sessions : one training day, as actually performed.
-- ----------------------------------------------------------------------------
create table public.workout_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  program_id uuid references public.workout_programs (id) on delete set null,
  date       date not null default current_date,
  exercises  jsonb not null default '[]'::jsonb,
  notes      text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- progress_logs : denormalised per-set records, the substrate for charts and
-- for the AI's progression decisions. session_id gives provenance without
-- forcing every chart query to unnest the sessions jsonb.
-- ----------------------------------------------------------------------------
create table public.progress_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.workout_sessions (id) on delete cascade,
  date       date not null default current_date,
  lift       text not null,
  weight     numeric(7,2) not null check (weight >= 0),
  reps       int not null check (reps > 0),
  rpe        numeric(3,1) check (rpe is null or rpe between 1 and 10),
  notes      text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- conversations : chat history. The Anthropic API is stateless, so the full
-- relevant history is replayed on every request and persisted here.
-- ----------------------------------------------------------------------------
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text,
  messages   jsonb not null default '[]'::jsonb,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- exercise_library : shared reference data, not user data. Stores LINKS to
-- third-party demonstration videos. We never host, embed, mirror or reproduce
-- any video content - only outbound URLs to the rights holder's own channel.
-- ----------------------------------------------------------------------------
create table public.exercise_library (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  category      text not null check (category in ('squat','bench','deadlift','press','accessory','warmup')),
  cues          text[] not null default '{}',
  common_faults text[] not null default '{}',
  video_url     text,
  video_source  text,
  created_at    timestamptz not null default now()
);

comment on table public.exercise_library is
  'Shared reference data. video_url links out to third-party rights holders; no video is hosted or reproduced by this application.';

-- ----------------------------------------------------------------------------
-- Indexes. Every user-scoped read is filtered by user_id, usually ordered by
-- date, so the composite indexes match the actual access pattern.
-- ----------------------------------------------------------------------------
create index workout_programs_user_created_idx on public.workout_programs (user_id, created_at desc);
create index workout_sessions_user_date_idx    on public.workout_sessions (user_id, date desc);
create index progress_logs_user_lift_date_idx  on public.progress_logs    (user_id, lift, date);
create index progress_logs_session_idx         on public.progress_logs    (session_id);
create index conversations_user_updated_idx    on public.conversations    (user_id, updated_at desc);

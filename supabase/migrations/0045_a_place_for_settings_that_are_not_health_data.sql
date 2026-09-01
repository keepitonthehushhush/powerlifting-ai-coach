-- =============================================================================
-- 0045_a_place_for_settings_that_are_not_health_data.sql
--
-- Theme packs need somewhere to live. The obvious place - a column on
-- user_profile - is the wrong one, and the reason is worth writing down.
--
-- ── WHY NOT user_profile ────────────────────────────────────────────────────
--
-- That table is documented as sensitive: "Athlete intake and current state.
-- Contains health information - treat as sensitive." It holds
-- health_restrictions, which the README promises is never logged and never
-- forwarded to observability.
--
-- GET /api/profile is `select('*')`. Put the theme there and every page load
-- that wants to know which palette to paint pulls a user's injuries across the
-- wire with it. Nothing breaks. It just means the most sensitive row in the
-- database is now read on the hot path for a cosmetic preference, and any
-- future "log the theme change" is one careless line away from logging health
-- data next to it.
--
-- Separating them is not fastidiousness, it is what makes the promise about
-- health_restrictions cheap to keep. A preferences endpoint can be logged
-- freely, cached, and read on every page. A profile endpoint cannot.
--
-- ── WHAT LIVES HERE ─────────────────────────────────────────────────────────
--
-- Non-sensitive interface preferences, nothing else. The theme today; the chat
-- settings that currently sit in localStorage - undo window, send key - are
-- the obvious next tenants when somebody wants them to follow their account.
-- Anything describing the athlete's BODY belongs in user_profile.
--
-- ── ON NOT CONSTRAINING THE THEME NAME IN SQL ───────────────────────────────
--
-- Deliberately a plain text column with no CHECK against a list of ids. A
-- check constraint would mean every new holiday theme is a migration, and -
-- worse - a rollback of the web app to a previous deploy would leave rows the
-- old code cannot read while the database happily insists they are valid.
--
-- The catalog is validated in the application instead: tokensFor() falls back
-- to the default theme for any id this build does not recognize, so a retired
-- theme, or a row written by a newer deploy, shows somebody the default
-- palette rather than a blank page. The length cap is the only thing SQL
-- enforces, because that is a storage question rather than a product one.
-- =============================================================================

create table if not exists public.user_preferences (
  user_id    uuid primary key references auth.users (id) on delete cascade,

  -- The chosen theme pack's id. Application-validated; see the note above.
  theme      text not null default 'miami'
             check (char_length(theme) between 1 and 64),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_preferences is
  'Non-sensitive interface preferences. Contains NO health data - that is user_profile. Safe to read on any page and safe to log.';
comment on column public.user_preferences.theme is
  'Theme pack id from web/src/lib/themes.js. Unrecognized values fall back to the default in the client.';

-- --- Privileges -------------------------------------------------------------
-- The baseline in 0002 revoked everything from anon and public for the tables
-- that existed then. A new table starts with its own grants, so anon is
-- revoked explicitly rather than by assuming the earlier statement reaches
-- forward in time. It does not.
revoke all on public.user_preferences from anon, public;
grant select, insert, update, delete on public.user_preferences to authenticated;

-- --- Row Level Security -----------------------------------------------------
alter table public.user_preferences enable row level security;

create policy "preferences: owner can read own"
  on public.user_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "preferences: owner can insert own"
  on public.user_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- USING gates which existing rows may be targeted; WITH CHECK gates the row as
-- it will look afterwards. Both, or somebody updates their own row and
-- reassigns user_id to another account.
create policy "preferences: owner can update own"
  on public.user_preferences for update to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "preferences: owner can delete own"
  on public.user_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);

-- --- updated_at -------------------------------------------------------------
-- The same trigger every other table here uses, rather than trusting the
-- application to remember.
--
-- `private`, not `public`. Migration 0003 created this function in public and
-- 0004 moved it, because anything in public is automatically exposed over the
-- REST API. Writing public.set_updated_at() here - which is what reading 0003
-- alone would tell you - fails at apply time with "function does not exist",
-- which is the good outcome; the bad one is assuming the first migration that
-- mentions something is still the one that describes it.
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function private.set_updated_at();

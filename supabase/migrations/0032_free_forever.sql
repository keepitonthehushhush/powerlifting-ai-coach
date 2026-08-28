-- =============================================================================
-- 0032_free_forever.sql
--
-- The mechanism for honouring a promise that has not been broken yet.
--
-- The FAQ says, live today: "It is free while it is being built and tested."
-- Whenever the paywall is switched on, the people who signed up under that
-- sentence keep the coaching free, permanently.
--
-- ── WHY A COLUMN RATHER THAN A DATE COMPARISON ──────────────────────────────
--
-- The obvious implementation compares auth.users.created_at against a cutoff
-- constant. It is one line and it rots: the cutoff is a date nobody can write
-- down until the switch is flipped, it has to be kept in sync between code and
-- anybody's memory, and a later change to how accounts are created (an import,
-- a merge, a support-created account) silently moves people across it.
--
-- A flag is a FACT about a person, set once, that no later change can
-- accidentally alter. Backfilling it is one UPDATE on the day of the switch,
-- and from then on the rule reads "this athlete was promised free access",
-- which is the actual reason - not "this athlete's row is old".
--
-- ── WRITABLE BY NOBODY ──────────────────────────────────────────────────────
--
-- Not by the athlete, obviously - it is free coaching for the asking. Not by
-- the API either: nothing in the request path has any business granting it.
-- It is set by a migration, which is the only place a decision like this
-- should be recorded, and it is auditable afterwards precisely because it took
-- a migration.
-- =============================================================================

alter table public.user_profile
  add column if not exists free_forever boolean not null default false;

comment on column public.user_profile.free_forever is
  'This athlete was promised free coaching before the paywall existed, and keeps it permanently. Set ONLY by migration - never by the API and never by the user. See ADR-14.';

-- ── THE REVOKE THAT DID NOTHING ─────────────────────────────────────────────
--
-- The first attempt was:
--
--   revoke update (free_forever) on public.user_profile from authenticated;
--
-- It ran without error and changed nothing, which is the worst possible
-- outcome. `authenticated` holds a TABLE-level UPDATE grant on user_profile
-- (migration 0009), and in Postgres a column-level revoke cannot subtract from
-- a table-level privilege - column grants are additive to it, not a mask over
-- it. has_column_privilege() still returned true afterwards.
--
-- Had that shipped, "free coaching forever" would have been a boolean any
-- signed-in person could set on themselves through PostgREST.
--
-- Revoking UPDATE at table level and re-granting it column by column would
-- work and is a trap of its own: every column added later is silently
-- unwritable until somebody remembers to grant it, which is a bug that shows
-- up as a form that saves everything except the new field.
--
-- So it is a trigger, which is also how the leaderboard numbers are protected:
-- the value cannot be changed by anybody the table does not belong to, and a
-- migration - which runs as the owner - can still set it.
create or replace function private.protect_free_forever()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  if current_user <> (select tableowner from pg_tables
                       where schemaname = 'public' and tablename = 'user_profile') then
    new.free_forever := old.free_forever;
  end if;
  return new;
end;
$fn$;

revoke all on function private.protect_free_forever() from anon, authenticated, public;

drop trigger if exists protect_free_forever on public.user_profile;
create trigger protect_free_forever
  before update on public.user_profile
  for each row execute function private.protect_free_forever();

-- ----------------------------------------------------------------------------
-- The backfill is NOT run here.
--
-- It belongs to the commit that turns the paywall on, because that is the
-- moment the promise becomes load-bearing and the moment "everybody who has an
-- account" means something definite. Running it now would mark today's three
-- accounts and silently exclude everybody who signs up between now and then -
-- which is precisely the group the sentence on the FAQ is still making the
-- promise to.
--
-- When the paywall goes on, in the same migration:
--
--   update public.user_profile set free_forever = true;
--
-- Everyone who exists at that instant was promised free access. Everyone after
-- it signs up to a page that no longer says so.
-- ----------------------------------------------------------------------------

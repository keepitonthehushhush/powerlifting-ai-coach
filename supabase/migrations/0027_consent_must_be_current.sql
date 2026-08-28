-- =============================================================================
-- 0027_consent_must_be_current.sql
--
-- has_active_consent() ignored policy_version.
--
-- ── WHAT THAT MEANT ─────────────────────────────────────────────────────────
--
-- The function answered "did this person ever grant this consent, most
-- recently?" and nothing more. So after a policy was updated:
--
--   - the consent gate treated the record as stale and refused entry,
--   - the panel (now) renders the checkbox EMPTY, saying they have not agreed,
--   - and the database trigger from 0008 went on accepting health-data writes
--     under the superseded agreement.
--
-- The screen said one thing and the enforcement said another, and the
-- enforcement is the half that decides what actually gets stored. A policy bump
-- is the mechanism by which somebody is asked again; it should not be a
-- mechanism that asks them while quietly proceeding either way.
--
-- Nothing failed, of course. It never does.
--
-- ── WHY A TABLE RATHER THAN A CASE STATEMENT ────────────────────────────────
--
-- The current versions live in server/src/lib/policyVersions.js, and hardcoding
-- a copy into a function body is the drift this codebase has already been bitten
-- by twice. A table can be read, joined, and - crucially - CHECKED: 
-- check-db-invariants.mjs asserts row-for-row that it matches POLICY_VERSIONS,
-- so a version bumped in JavaScript and not here fails a check rather than
-- silently un-gating the database half.
--
-- It also makes a policy bump an auditable event with a timestamp, which is
-- what it is.
-- =============================================================================

create table if not exists public.policy_versions (
  consent_type text primary key,
  version      text not null,
  effective_at timestamptz not null default now()
);

comment on table public.policy_versions is
  'The CURRENT version of each policy. Mirrors POLICY_VERSIONS in server/src/lib/policyVersions.js; check-db-invariants.mjs asserts they match. Read by has_active_consent() so a superseded agreement stops authorising writes.';

alter table public.policy_versions enable row level security;

-- Readable by anybody signed in: knowing which version of a policy is current
-- is not a secret, and the panel benefits from being able to say so.
drop policy if exists policy_versions_read on public.policy_versions;
create policy policy_versions_read
  on public.policy_versions for select to authenticated using (true);

grant select on public.policy_versions to authenticated;
revoke all on public.policy_versions from anon;

insert into public.policy_versions (consent_type, version) values
  ('health_data_collection', 'chd-2026-08-27b'),
  ('ai_processing',          'aip-2026-08-27c'),
  ('terms_of_service',       'tos-2026-08-27b')
on conflict (consent_type) do update set version = excluded.version, effective_at = now();

-- ----------------------------------------------------------------------------
-- has_active_consent(), now version-aware.
--
-- Two conditions, not one: the latest decision must be a grant, AND it must
-- have been made against the version that is current now.
--
-- `order by seq desc` is kept and is load-bearing. now() is transaction start
-- time in Postgres, so a grant and a withdrawal written in one transaction
-- carry identical created_at values and sort arbitrarily - which once made a
-- withdrawal read as a grant. Migration 0010 fixed that; this must not undo it.
--
-- Fails CLOSED. No consent row, or no row in policy_versions for that type,
-- returns false. The cost of a wrong false is somebody being asked again. The
-- cost of a wrong true is health data stored without agreement.
-- ----------------------------------------------------------------------------
create or replace function public.has_active_consent(p_consent_type text)
returns boolean language sql security invoker stable set search_path = ''
as $$
  select coalesce(
    (select c.granted
            and c.policy_version = (
              select v.version from public.policy_versions v
               where v.consent_type = p_consent_type
            )
       from public.consent_records c
      where c.user_id = auth.uid()
        and c.consent_type = p_consent_type
      order by c.seq desc
      limit 1),
    false
  );
$$;

revoke all on function public.has_active_consent(text) from public, anon;
grant execute on function public.has_active_consent(text) to authenticated;

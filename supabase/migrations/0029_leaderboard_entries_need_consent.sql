-- =============================================================================
-- 0029_leaderboard_entries_need_consent.sql
--
-- Remove any published entry with no consent behind it.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
--
-- 0028 made an active `leaderboard_publication` consent a precondition for
-- joining. It could not do anything about the entries that were already there,
-- and there was one: a row published before the consent existed, which is
-- exactly the state 0028 was written to prevent.
--
-- A rule introduced without a backfill is a rule that holds for everybody who
-- arrives after it and nobody who arrived before, which is the weaker half of
-- enforcement pretending to be the whole thing. The entries created before the
-- rule are precisely the ones with no record of agreement, so they are the ones
-- it matters for.
--
-- ── WHAT THIS DELETES, AND WHAT IT DOES NOT ─────────────────────────────────
--
-- Deletes: rows in leaderboard_entries - a cache of published numbers, all of
-- which are recomputed from progress_logs the moment somebody rejoins.
--
-- Does NOT touch: progress_logs, user_profile, display names, programmes,
-- conversations, consent history. Nothing an athlete created is lost. Somebody
-- affected by this rejoins in two clicks and their numbers come back exactly as
-- they were, because the numbers were never stored here in the first place -
-- they were derived here.
--
-- ── AND THE PROPERTY IS CHECKED FROM NOW ON ─────────────────────────────────
--
-- A one-time DELETE fixes today. check-db-invariants.mjs asserts the same
-- condition continuously - zero entries without a granted, current consent - so
-- if any future path ever writes an entry around set_leaderboard_opt_in(), it
-- fails a check instead of sitting there published.
--
-- "Latest decision" is `order by seq desc`, not created_at. now() is
-- transaction start time in Postgres, so a grant and a withdrawal written in
-- one transaction share a timestamp and sort arbitrarily - the bug 0010 fixed,
-- and one this query would otherwise reintroduce.
-- =============================================================================

delete from public.leaderboard_entries e
where not exists (
  select 1
  from (
    select distinct on (c.user_id) c.user_id, c.granted, c.policy_version
      from public.consent_records c
     where c.consent_type = 'leaderboard_publication'
     order by c.user_id, c.seq desc
  ) latest
  where latest.user_id = e.user_id
    and latest.granted
    and latest.policy_version = (
      select v.version from public.policy_versions v
       where v.consent_type = 'leaderboard_publication'
    )
);

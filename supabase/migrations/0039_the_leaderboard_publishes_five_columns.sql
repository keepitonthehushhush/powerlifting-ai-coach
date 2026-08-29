-- =============================================================================
-- 0039_the_leaderboard_publishes_five_columns.sql
--
-- The leaderboard page says, of what other signed-in users can see:
--
--     Exactly four things ... the table the leaderboard reads has no column any
--     of them could be put in without a database migration.
--
-- The second half is true. The first half was not, at the boundary where it
-- matters.
--
-- ── WHAT WAS ACTUALLY READABLE ──────────────────────────────────────────────
--
-- 0026 issued `grant select on public.leaderboard_entries to authenticated`,
-- table-wide, and the RLS policy is `using (true)` because cross-user reading
-- IS the feature. So every signed-in user could read every column of every row,
-- and the table has seven:
--
--     user_id  display_name  best_squat  best_bench  best_deadlift  units
--     updated_at
--
-- Asked of the catalogue rather than assumed - has_column_privilege() returned
-- true for all seven.
--
-- GET /api/leaderboard was never the exposure. It selects named columns and
-- rankEntries() returns a handle and three numbers. The exposure is that the
-- browser holds a real JWT and can reach PostgREST directly, which this schema
-- already knows and says so in the invariant next door: "The browser holds a
-- real JWT and can reach PostgREST directly, so an insert or update privilege
-- here would let anybody set their own squat to 9999."
--
-- The same sentence applies to reads, and nobody had applied it. What leaked
-- through it:
--
--   user_id     the athlete's auth UUID. Opaque, and a persistent unique
--               identifier, which is a named category of personal information
--               under CCPA. Nothing else cross-user is keyed by it today; that
--               is a property of the current schema, not a guarantee.
--   updated_at  when that athlete's best lift last changed, which is an
--               activity signal about a person. Selected by our own route and
--               used by nothing.
--
-- ── THE FIX, AND WHY IT IS A GRANT RATHER THAN A VIEW ───────────────────────
--
-- A view would work and would be more machinery: another object to keep RLS on,
-- another place for the definer writers to disagree with. Postgres grants are
-- column-granular already, and the property wanted here is exactly the one a
-- column grant expresses - these five columns are published, the other two are
-- not.
--
-- The writers are SECURITY DEFINER and run with owner rights, so revoking from
-- `authenticated` does not touch them. Verified against the preview database:
-- joining, reading the board back and leaving all still work, while user_id,
-- updated_at and `select *` all return "permission denied for table
-- leaderboard_entries".
-- =============================================================================

revoke select on public.leaderboard_entries from authenticated;

grant select (display_name, best_squat, best_bench, best_deadlift, units)
  on public.leaderboard_entries to authenticated;

comment on table public.leaderboard_entries is
  'Opt-in published projection. The five columns granted to authenticated are readable by every signed-in user BY DESIGN - that is the feature. user_id and updated_at are deliberately NOT granted: the first is a persistent unique identifier and the second is an activity signal, and the leaderboard document promises neither is published. Writable only through the security-definer functions below, so the numbers cannot be self-reported.';

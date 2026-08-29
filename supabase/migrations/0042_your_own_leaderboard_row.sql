-- =============================================================================
-- 0042_your_own_leaderboard_row.sql
--
-- A subject access request has to include the leaderboard row, and after 0039
-- it could not be read.
--
-- ── HOW THE TWO COLLIDED ────────────────────────────────────────────────────
--
-- 0039 replaced the table-wide SELECT on leaderboard_entries with a column
-- grant on the five published columns, because user_id and updated_at were
-- readable by every signed-in user and the leaderboard document says they are
-- not published. That is right, and it has a consequence: the export cannot say
-- `select * where user_id = auth.uid()` any more, because filtering on a column
-- needs SELECT privilege on that column, and user_id no longer has one.
--
-- The alternatives were both worse. Granting user_id back undoes 0039 for the
-- sake of one query. Matching on display_name instead is a join on a handle
-- somebody can change, in the one code path that must return exactly the
-- subject's own data and never anybody else's.
--
-- ── SO: A DEFINER FUNCTION, SCOPED TO THE CALLER ────────────────────────────
--
-- The shape this schema already uses for "your own row, in full" - owner
-- rights, `where user_id = auth.uid()` written once inside the function, and
-- no argument, so it cannot be pointed at anybody else. Same reasoning as
-- delete_my_account(): a function that takes no user id cannot be given the
-- wrong one.
--
-- It returns updated_at, which 0039 deliberately withheld from OTHER users.
-- That is not a contradiction: the leaderboard document promises updated_at is
-- not published to other people, and this returns it only to the person it
-- belongs to. Access rights and publication are different questions, and the
-- export exists to answer the first.
--
-- In `public`, not `private`, and verified as such: delete_my_account() spent a
-- release in the private schema where PostgREST cannot see it, so the erasure
-- endpoint returned "Could not delete the account" while every mocked test
-- passed. An invariant already asserts that one is in public and executable;
-- this gets the same treatment.
-- =============================================================================

create or replace function public.my_leaderboard_entry()
returns table (
  display_name  text,
  best_squat    numeric,
  best_bench    numeric,
  best_deadlift numeric,
  units         text,
  updated_at    timestamptz
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  -- No argument, so it cannot be aimed at another account. Returns zero rows
  -- for an unauthenticated caller rather than every row, because auth.uid() is
  -- null and nothing equals null.
  select e.display_name, e.best_squat, e.best_bench, e.best_deadlift, e.units, e.updated_at
    from public.leaderboard_entries e
   where e.user_id = auth.uid();
$$;

comment on function public.my_leaderboard_entry() is
  'The caller''s own leaderboard row, in full, for the data export. SECURITY DEFINER because 0039 revoked user_id from authenticated, so the export can no longer filter on it. Takes no argument, so it cannot be pointed at another account.';

revoke all on function public.my_leaderboard_entry() from public, anon;
grant execute on function public.my_leaderboard_entry() to authenticated;

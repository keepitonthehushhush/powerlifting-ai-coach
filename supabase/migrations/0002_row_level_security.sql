-- =============================================================================
-- 0002_row_level_security.sql
-- Row Level Security. This is the single most important file in the project.
--
-- Threat model: this application stores user-reported injuries and medical
-- conditions. A missing or sloppy policy is not a bug, it is a health-data
-- breach. Everything below is written defensively:
--
--   1. RLS is enabled on EVERY table in the public schema. No exceptions.
--   2. Policies are written per-command (select / insert / update / delete)
--      rather than as a single `for all`, so that USING (which rows you may
--      read or target) and WITH CHECK (which rows you may write) are stated
--      explicitly and cannot be conflated.
--   3. Every policy is scoped `to authenticated`. The `anon` role - the role
--      an unauthenticated browser holds - matches no policy at all and can
--      therefore read nothing.
--   4. `(select auth.uid())` rather than a bare `auth.uid()`. Postgres hoists
--      the scalar subquery into an InitPlan and evaluates it once per query
--      instead of once per row. On a table scan this is the difference
--      between one function call and one per row.
--   5. Grants are revoked from anon and public first. RLS filters rows, but
--      the privilege system decides whether you may touch the table at all -
--      belt and braces.
-- =============================================================================

-- --- 1. Privilege baseline -------------------------------------------------
revoke all on all tables in schema public from anon, public;

grant select, insert, update, delete
  on public.user_profile, public.workout_programs, public.workout_sessions,
     public.progress_logs, public.conversations
  to authenticated;

grant select on public.exercise_library to authenticated;

-- --- 2. Enable RLS ---------------------------------------------------------
alter table public.user_profile     enable row level security;
alter table public.workout_programs enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.progress_logs    enable row level security;
alter table public.conversations    enable row level security;
alter table public.exercise_library enable row level security;

-- --- 3. user_profile -------------------------------------------------------
create policy "profile: owner can read own"
  on public.user_profile for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "profile: owner can insert own"
  on public.user_profile for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- USING gates which existing rows may be targeted; WITH CHECK gates the row
-- as it will look afterwards. Both are required or a user could UPDATE their
-- own row and reassign user_id to someone else.
create policy "profile: owner can update own"
  on public.user_profile for update to authenticated
  using       ((select auth.uid()) = user_id)
  with check  ((select auth.uid()) = user_id);

create policy "profile: owner can delete own"
  on public.user_profile for delete to authenticated
  using ((select auth.uid()) = user_id);

-- --- 4. workout_programs ---------------------------------------------------
create policy "programs: owner can read own"
  on public.workout_programs for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "programs: owner can insert own"
  on public.workout_programs for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "programs: owner can update own"
  on public.workout_programs for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "programs: owner can delete own"
  on public.workout_programs for delete to authenticated
  using ((select auth.uid()) = user_id);

-- --- 5. workout_sessions ---------------------------------------------------
create policy "sessions: owner can read own"
  on public.workout_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "sessions: owner can insert own"
  on public.workout_sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "sessions: owner can update own"
  on public.workout_sessions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "sessions: owner can delete own"
  on public.workout_sessions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- --- 6. progress_logs ------------------------------------------------------
create policy "logs: owner can read own"
  on public.progress_logs for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "logs: owner can insert own"
  on public.progress_logs for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "logs: owner can update own"
  on public.progress_logs for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "logs: owner can delete own"
  on public.progress_logs for delete to authenticated
  using ((select auth.uid()) = user_id);

-- --- 7. conversations ------------------------------------------------------
create policy "conversations: owner can read own"
  on public.conversations for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "conversations: owner can insert own"
  on public.conversations for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "conversations: owner can update own"
  on public.conversations for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "conversations: owner can delete own"
  on public.conversations for delete to authenticated
  using ((select auth.uid()) = user_id);

-- --- 8. exercise_library ---------------------------------------------------
-- Shared, non-personal reference data: readable by any signed-in user.
-- Deliberately NO insert/update/delete policy exists, so the table is
-- append-only from migrations and unwritable from the application entirely.
create policy "library: any authenticated user can read"
  on public.exercise_library for select to authenticated
  using (true);

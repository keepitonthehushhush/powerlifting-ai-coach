-- =============================================================================
-- 0011_user_id_defaults_to_auth_uid.sql
--
-- Let the database supply the owner of a new row.
--
-- THE BUG THIS FIXES. `POST /api/chat` could never create a conversation. The
-- route inserts `{ title: 'Coaching' }` and nothing else, because the design
-- premise of this schema - stated in ADR-2 and repeated in the route's own
-- comment - is that application code never names a user id. Reads honour that
-- premise: RLS scopes every SELECT, so no query filters by user_id and none
-- needs to.
--
-- Writes did not. `conversations.user_id` is NOT NULL with no default, so the
-- insert failed with 23502 on every attempt. The first message any user ever
-- sent hit it.
--
-- Five of the six call sites happened to pass `user_id` explicitly and worked.
-- One followed the documented premise and did not. The premise was right and
-- the schema had not been made to support it.
--
-- WHY A DEFAULT RATHER THAN FIXING THE CALL SITE. Adding `user_id: req.user.id`
-- to one route would have fixed this symptom and left the trap armed for the
-- next table and the next route. More importantly it would make application
-- code the thing that decides who owns a row - and this schema's entire
-- security argument is that Postgres decides, not the API.
--
-- `auth.uid()` reads the verified JWT claim of the current request. It is the
-- same expression every RLS policy on these tables already uses, so the value
-- a row gets by default is by construction the value its WITH CHECK requires.
--
-- THIS IS NOT A SECURITY CONTROL, AND MUST NOT BE READ AS ONE. A default is
-- only consulted when the client omits the column. A client that supplies
-- somebody else's user_id is still rejected - by the INSERT policy's
-- WITH CHECK ((select auth.uid()) = user_id), which is unchanged and remains
-- the thing doing the work. The default removes a footgun; the policy is the
-- guard.
--
-- Outside a request there is no JWT, `auth.uid()` returns NULL, and the NOT
-- NULL constraint rejects the insert. That is the correct outcome: a migration
-- or an admin session has no business creating rows that claim to belong to a
-- user it cannot name.
--
-- `consent_records` already had this default - it was written later, after the
-- premise was clear. These five predate it.
-- =============================================================================

alter table public.user_profile      alter column user_id set default auth.uid();
alter table public.workout_programs  alter column user_id set default auth.uid();
alter table public.workout_sessions  alter column user_id set default auth.uid();
alter table public.progress_logs     alter column user_id set default auth.uid();
alter table public.conversations     alter column user_id set default auth.uid();

comment on column public.conversations.user_id is
  'Owner. Defaults to auth.uid() so callers need not name it; the INSERT policy''s WITH CHECK is what enforces it.';

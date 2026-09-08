-- =============================================================================
-- 0063_a_record_of_what_we_told_you_we_changed.sql
--
-- Which people have been told that a policy they agreed to has changed.
--
-- ── WHY THERE HAS TO BE A TABLE ─────────────────────────────────────────────
--
-- Three accounts are sitting on superseded policy versions right now - one on
-- tos-2026-08-24 and two on tos-2026-08-27b, against a current tos-2026-08-31b -
-- and until this migration there was no way to send them anything, because the
-- product has exactly one outbound message and it is a guardian consent link.
--
-- Adding the message is the easy half. The half that needs a table is the
-- question asked afterwards: WHO DID YOU TELL, AND WHEN. That is a consent
-- question, and this project's rule about consent is that the answer lives on
-- an append-only record rather than in somebody's memory of running a script.
-- A notice about an agreement is part of the story of that agreement.
--
-- ── AND WHY THE UNIQUENESS IS IN THE DATABASE ───────────────────────────────
--
-- `unique (user_id, notice_key)` is not bookkeeping, it is the whole safety
-- property of the sending script. An operator tool that emails real people and
-- can be run twice will be run twice - by a retry after a timeout, by a second
-- terminal, by somebody who did not see the first run finish. The insert
-- happens BEFORE the send, so a duplicate run collides on the constraint and
-- sends nothing; a person cannot receive the same notice twice even if every
-- other guard is wrong.
--
-- The key is the versions being announced, sorted and joined, so a notice about
-- a LATER change is a different key and is not mistaken for a duplicate of this
-- one. Storing the versions themselves rather than a date means the record says
-- what the person was actually told about.
--
-- ── WHAT IT DELIBERATELY DOES NOT HOLD ──────────────────────────────────────
--
-- Not the address it went to. That is in Supabase Auth, it is already the
-- subject's, and copying it here would create a second place a person's email
-- has to be erased from. Not the message body - the text is in the repository
-- and is the same for everybody. Not health data, and nothing about training.
--
-- ── IN THE EXPORT ───────────────────────────────────────────────────────────
--
-- Yes. "You wrote to me about this on that date" is a record about a person and
-- belongs in a subject access request; exportCompleteness.test.js would have
-- forced the decision anyway, which is the point of that test.
-- =============================================================================

create table if not exists public.policy_notice_emails (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- The policy versions this notice announced, sorted and joined with '+'.
  -- Constrained to the shape those versions actually have, so a typo in the
  -- sending script is a failed insert rather than a row nobody can interpret.
  notice_key text not null check (notice_key ~ '^[a-z]{2,4}-[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?(\+[a-z]{2,4}-[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?){0,7}$'),
  -- Written before the send is attempted, so this is "we tried", not "it
  -- arrived". delivered_at is what says it left the building.
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  -- The provider's id for the message, for tracing a complaint back to a send.
  -- Never the recipient.
  message_id text,
  unique (user_id, notice_key)
);

comment on table public.policy_notice_emails is
  'One row per person per policy-change notice. Inserted BEFORE the message is attempted, so the unique constraint on (user_id, notice_key) is what makes a re-run of the sending script unable to email anybody twice; delivered_at is set afterwards and is the only claim that anything was sent. Holds no address and no message body. Written only by an operator script running with the service role - authenticated may read its own rows and write none. See migration 0063.';

comment on column public.policy_notice_emails.notice_key is
  'The policy versions announced, sorted and joined with +. A later change is a different key, so it is not mistaken for a duplicate of an earlier notice.';

create index if not exists policy_notice_emails_user_idx
  on public.policy_notice_emails (user_id, created_at desc);

alter table public.policy_notice_emails enable row level security;

-- The person may see what we told them and when. It is about them, and it is
-- the kind of thing somebody checks after receiving an email they did not
-- expect.
drop policy if exists policy_notice_emails_read on public.policy_notice_emails;
create policy policy_notice_emails_read
  on public.policy_notice_emails for select to authenticated
  using (user_id = (select auth.uid()));

-- ── THE PRIVILEGE, NOT THE POLICY, IS THE CONTROL ───────────────────────────
--
-- Same lesson as 0055 and 0039: a policy narrows a privilege and does not
-- create one. SELECT only, and no insert or update grant at all - a person who
-- could write this table could forge a record that we had notified them, which
-- is the one direction this table is evidence in.
grant select on public.policy_notice_emails to authenticated;
revoke insert, update, delete on public.policy_notice_emails from authenticated, anon;

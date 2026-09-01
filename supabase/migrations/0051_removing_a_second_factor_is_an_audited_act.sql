-- =============================================================================
-- 0051_removing_a_second_factor_is_an_audited_act.sql
--
-- 0050 turns on MFA enforcement and names its cost: an athlete who loses their
-- authenticator cannot unenroll, because unenrolling requires the aal2 session
-- they can no longer obtain. The way back in is scripts/mfa-recovery.mjs,
-- which uses the service-role key.
--
-- That script is the single most dangerous thing in this repository. It makes
-- an account reachable with the password alone, on the say-so of whoever holds
-- the key. So it writes an audit row, and this migration is what lets it.
--
-- ── THE THIRD ACTOR ─────────────────────────────────────────────────────────
--
-- `actor` was ('user', 'stripe') - the account holder, and the webhook that
-- has no user. 'operator' is the third: a human with the service-role key
-- acting ON an account rather than as one. Naming it separately is the whole
-- value of the column. A recovery recorded as 'user' would be a lie in the
-- one row most likely to be read back during a dispute.
--
-- ── WHAT THE ROW MAY SAY ────────────────────────────────────────────────────
--
-- Two numbers: how many factors were found, and how many were removed. They
-- differ when a delete fails partway, which is exactly the state somebody
-- would need to know about. No email, no factor secret, no friendly name -
-- "phone in pocket" is somebody's words about their own device and has no
-- business in an append-only table.
-- =============================================================================

-- ── THE LIST IS READ OFF PRODUCTION, NOT REMEMBERED ────────────────────────
--
-- The first draft of this migration listed three actions and was refused by
-- production with "check constraint is violated by some row": a later
-- migration had added `clearance_asserted`, and the preview database - where
-- this was rehearsed, and where it applied cleanly - did not have it. So
-- preview is NOT a faithful rehearsal of production, which is worth knowing
-- separately from this change.
--
-- Rewriting a CHECK means restating every value it already held. There is no
-- additive form. So every value below was read out of pg_constraint on
-- production rather than out of the migration files, for the same reason this
-- project asserts against pg_proc rather than against a .sql file: the
-- catalogue is the fact and the file is the intention.
alter table public.audit_events drop constraint if exists audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (
  action in (
    'data_exported',
    'account_deleted',
    'subscription_changed',
    'clearance_asserted',
    'mfa_factor_removed'
  )
);

alter table public.audit_events drop constraint if exists audit_events_actor_check;
alter table public.audit_events add constraint audit_events_actor_check check (
  actor in ('user', 'stripe', 'operator')
);

alter table public.audit_events drop constraint if exists audit_events_detail_check;
alter table public.audit_events add constraint audit_events_detail_check check (
  detail - array['event_id', 'type', 'status', 'rows', 'tables', 'code', 'cleared', 'found', 'removed']
    = '{}'::jsonb
);

-- An operator row is the only kind that may carry these two, and the only kind
-- 'operator' may write. Stated as a constraint rather than as a convention,
-- because a convention is a thing a future script does not know about.
alter table public.audit_events drop constraint if exists audit_events_operator_shape;
alter table public.audit_events add constraint audit_events_operator_shape check (
  (actor = 'operator') = (action = 'mfa_factor_removed')
);

comment on column public.audit_events.actor is
  'Who performed it. user = the account holder acting for themselves; stripe = the billing webhook, which has no user and uses the service-role client (ADR-12); operator = a human holding the service-role key acting ON an account rather than as one, which today means only MFA recovery.';

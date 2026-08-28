-- =============================================================================
-- 0030_audit_events.sql
--
-- An audit trail for the operations somebody might later dispute.
--
-- ── WHY logger.info IS NOT AN AUDIT TRAIL ───────────────────────────────────
--
-- The three operations that most need a record already have one:
-- account.exported, account.deleted, and the billing webhook's writes all call
-- logger.info. Those go to a hosted log stream with a retention window measured
-- in days, that nobody reads, that the person the record is about cannot see,
-- and that is gone by the time anybody asks. This project has already been
-- bitten twice by "logged loudly" meaning nothing because nobody was
-- listening - the rate limiter and the usage_events GRANT.
--
-- A log line answers "what happened, if you happen to look now". An audit row
-- answers "what happened", later, to whoever asks.
--
-- ── WHAT GOES IN, AND WHAT MUST NOT ─────────────────────────────────────────
--
-- The FACT of an operation, never its contents. That an export ran, not what
-- was in it. That an account was deleted, not what it held. That a subscription
-- became active, not a card.
--
-- `detail` is constrained to a whitelist of keys, enforced by the CHECK below
-- rather than by everybody remembering. Health data has no key it could arrive
-- under, and adding one is a migration somebody has to justify. Injury and
-- restriction text is health information; an audit table is a place it would be
-- copied to and then kept, which is the opposite of the point.
--
-- ── THE DECISION THAT MAKES THIS WORTH BUILDING ─────────────────────────────
--
-- `on delete set null`, NOT cascade.
--
-- Cascade is the obvious choice and it destroys the thing being built. Deleting
-- an account would erase the record that the account was deleted - so the one
-- operation somebody is most likely to dispute is the one operation with no
-- evidence, and the evidence disappears at the exact moment it becomes
-- relevant. Same trap as the leaderboard entry standing in for a consent
-- record, in 0028.
--
-- Set null keeps the row and drops the person. What survives is "an account was
-- deleted at 14:02 on the 28th", with no user id, no email, no hash, nothing
-- that points back. That is not personal data, so it is not something erasure
-- is owed, and it is enough to demonstrate the deletion happened.
-- =============================================================================

create table if not exists public.audit_events (
  seq        bigserial primary key,
  user_id    uuid references auth.users (id) on delete set null,
  action     text not null check (action in (
               'data_exported',
               'account_deleted',
               'subscription_changed'
             )),
  -- Who performed it. 'user' is the account holder acting for themselves;
  -- 'stripe' is the webhook, which has no user and uses the service-role client
  -- (ADR-12). Recording the actor is what makes the service-role exception
  -- observable rather than merely documented.
  actor      text not null check (actor in ('user', 'stripe')),
  /**
   * Keys are whitelisted. `jsonb - text[]` removes the permitted keys; if what
   * remains is empty, every key was permitted. Immutable, so it is legal in a
   * CHECK, and it fails the write rather than trusting a code path.
   */
  detail     jsonb not null default '{}'::jsonb
               check (detail - array['event_id','type','status','rows','tables','code'] = '{}'::jsonb),
  created_at timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only record of operations somebody might dispute. Contains the FACT of an operation, never its contents - no health data, no export payload, no card data. user_id is SET NULL on account deletion so the record that a deletion happened survives the deletion without remaining personal data.';

create index if not exists audit_events_user_seq_idx
  on public.audit_events (user_id, seq desc);

alter table public.audit_events enable row level security;

-- People can read their own audit trail. That is most of the point: a record
-- the subject cannot see is a record they cannot check.
drop policy if exists audit_events_read_own on public.audit_events;
create policy audit_events_read_own
  on public.audit_events for select to authenticated
  using (user_id = auth.uid());

-- SELECT only, and only their own. No insert, update or delete policy exists
-- for anybody: an audit trail a user can write is a diary, and one they can
-- edit is fiction. The privilege is the control, not the policy - RLS narrows a
-- granted privilege and does not create one (0021).
grant select on public.audit_events to authenticated;
revoke all on public.audit_events from anon;
revoke insert, update, delete on public.audit_events from authenticated;

-- ----------------------------------------------------------------------------
-- record_audit_event(action, detail)
--
-- The only way a user-context write reaches this table. Definer, so it can
-- insert where the caller cannot, and narrow: it stamps user_id from the JWT
-- and refuses any action that is not the caller's to record.
--
-- 'subscription_changed' is deliberately NOT callable here. It is written by
-- the webhook through the service-role client, and letting a browser claim a
-- subscription changed - even only in the audit trail - would make the trail
-- something you could plant evidence in.
-- ----------------------------------------------------------------------------
create or replace function public.record_audit_event(p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'record_audit_event() requires an authenticated caller';
  end if;

  if p_action not in ('data_exported', 'account_deleted') then
    raise exception 'audit_action_not_permitted'
      using hint = 'Only data_exported and account_deleted may be recorded by a user.';
  end if;

  insert into public.audit_events (user_id, action, actor, detail)
  values (uid, p_action, 'user', coalesce(p_detail, '{}'::jsonb));
end;
$$;

revoke all on function public.record_audit_event(text, jsonb) from anon, public;
grant execute on function public.record_audit_event(text, jsonb) to authenticated;

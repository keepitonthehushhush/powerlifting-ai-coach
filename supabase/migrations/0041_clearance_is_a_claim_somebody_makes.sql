-- =============================================================================
-- 0041_clearance_is_a_claim_somebody_makes.sql
--
-- audit_events records the operations somebody might dispute. It recorded three:
-- data_exported, account_deleted, subscription_changed. It did not record the
-- one with an injury attached to it.
--
-- ── THE CLAIM THIS IS FOR ───────────────────────────────────────────────────
--
-- "I never told it a doctor had cleared me."
--
-- cleared_to_train is THE safety gate. The Terms say so: "If you report an
-- injury, pain, or a medical condition, the application will stop writing you
-- programs until you confirm that a doctor or physical therapist has cleared you
-- to train. That gate is enforced in code, and working around it is working
-- around the only safety mechanism here."
--
-- So the single most consequential assertion a user makes in this product is a
-- boolean on a form, and until now the only trace of it was a log line saying
-- which FIELD NAMES changed - values deliberately excluded, because the same
-- object carries the injury note - in a log that is gone in days. The current
-- value was recoverable from user_profile. The fact that somebody asserted it,
-- and when, was not recoverable from anywhere.
--
-- That is the wrong way round. The value is the less interesting half: the
-- retention sweep resets clearance every twelve months, so "cleared_to_train is
-- false today" says nothing about what was claimed eighteen months ago, and
-- eighteen months ago is when the injury happened.
--
-- ── WHY IT RECORDS AN ASSERTION AND NOT A TRANSITION ────────────────────────
--
-- The obvious design is to log changes: read the old value, compare, record if
-- it moved. It is worse in three ways. It needs a read before every write. It
-- is silent when somebody re-asserts clearance after the retention sweep reset
-- it - which is a fresh statement about their health, made on a new date, and
-- is exactly the thing worth having. And a "transition" is a fact about our
-- storage, whereas what a dispute turns on is a fact about the person: on this
-- date, this account submitted a form saying a professional had cleared them.
--
-- So it records every assertion, including one that repeats the last. Duplicates
-- in an evidence trail are not noise; a gap in one is.
--
-- ── WHAT IT DOES NOT RECORD ─────────────────────────────────────────────────
--
-- The injury. `cleared` is a boolean and the detail whitelist is enforced by a
-- CHECK, so the injury text cannot be put here by a later code path that
-- thought it would be useful context. Whether somebody says they were cleared
-- is not health data in the way that what they were cleared FOR is, and this
-- table has never held the second kind.
-- =============================================================================

alter table public.audit_events drop constraint if exists audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check
  check (action in (
    'data_exported',
    'account_deleted',
    'subscription_changed',
    -- The account stated that a professional had, or had not, cleared them to
    -- train. See the header: an assertion, not a transition.
    'clearance_asserted'
  ));

alter table public.audit_events drop constraint if exists audit_events_detail_check;
alter table public.audit_events add constraint audit_events_detail_check
  check (detail - array['event_id','type','status','rows','tables','code','cleared'] = '{}'::jsonb);

-- ── The user may now record it ──────────────────────────────────────────────
--
-- record_audit_event() carries owner rights and whitelists what a user may
-- write with them, separately from what the column permits - so a compromised
-- client cannot forge a subscription_changed, which only the Stripe webhook
-- writes. clearance_asserted joins the list a user may write, because a user is
-- the only one who can assert it.
--
-- Taken from the deployed definition and extended by one string rather than
-- retyped: replacing a function by writing it out from memory is how
-- stripe_events.received_at became created_at in 0034 and aborted the whole
-- retention sweep. Read it out of the catalogue, change one line.
create or replace function public.record_audit_event(p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'record_audit_event() requires an authenticated caller';
  end if;

  if p_action not in ('data_exported', 'account_deleted', 'clearance_asserted') then
    raise exception 'audit_action_not_permitted'
      using hint = 'Only data_exported, account_deleted and clearance_asserted may be recorded by a user.';
  end if;

  insert into public.audit_events (user_id, action, actor, detail)
  values (uid, p_action, 'user', coalesce(p_detail, '{}'::jsonb));
end;
$fn$;

-- ── A NOTE ON RETENTION, LEFT OPEN DELIBERATELY ─────────────────────────────
--
-- audit_events expires at 24 months, which was chosen for exports and deletions
-- and is not obviously right for this. A personal injury claim can be brought
-- well after two years in many states, so the evidence could expire inside the
-- window it exists to cover. Extending it is a legal judgment about limitations
-- periods rather than an engineering one, so this migration does not make it -
-- it is written down here and in docs/POLICY_REVIEW_2026-08-29.md as a question
-- for counsel, which is better than a number picked by somebody unqualified to
-- pick it.

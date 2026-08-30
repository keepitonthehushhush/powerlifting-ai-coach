-- =============================================================================
-- 0045_guardian_consent_round_trip.sql
--
-- 0036 built the storage for a guardian consent. It did not build the way one
-- is actually obtained, and docs/UNDER_18.md describes the flow as proposed:
-- "the minor enters a guardian email; the guardian receives a message ...;
-- consent is recorded when they follow the link."
--
-- This is that link.
--
-- ── THE PROBLEM THE SHAPE SOLVES ────────────────────────────────────────────
--
-- The guardian is not a user. They have no account, no session, no auth.uid().
-- consent_records restricts INSERT to `user_id = auth.uid()`, so nothing the
-- guardian can do reaches that table by the normal path.
--
-- The obvious answer is the service-role key, and it is refused. ADR-12 makes
-- the Stripe webhook the single service-role path in this product precisely so
-- that the exception stays countable; a second one turns a documented exception
-- into a habit. The right tool is the one this schema already uses for "write a
-- row the caller could not write themselves": a SECURITY DEFINER function with
-- the rule inside it and no argument that can be aimed somewhere else.
--
-- ── THE TOKEN IS NEVER STORED ───────────────────────────────────────────────
--
-- Only its SHA-256 hash. The token exists in exactly two places: the email in
-- the guardian's inbox, and memory on the server for the milliseconds it takes
-- to hash it. A dump of this table yields no working consent links, which is
-- the same reason nobody stores passwords.
--
-- Generated server-side with 32 bytes of CSPRNG, so guessing is not a threat
-- model - and it could not be rate-limited if it were, because the endpoint
-- that redeems it has no user to limit.
--
-- ── THE RULE THAT MAKES WITHDRAWAL REAL ─────────────────────────────────────
--
-- The document promises "you can withdraw at any time". A single-use token
-- would make that a promise with no mechanism behind it, and a second
-- long-lived token would be another secret to look after.
--
-- So the token has an asymmetry:
--
--     it can always say NO. it can only say YES once.
--
-- Granting is single-use and expires. Withdrawing works forever, on a decided
-- request, on an expired one, and repeatedly - it is idempotent and it fails
-- safe. That asymmetry is the whole design: the direction that removes access
-- is never the direction worth defending against.
-- =============================================================================

create table if not exists public.guardian_consent_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  -- The address the link was sent to. Third-party personal data, same
  -- treatment as consent_records.guardian_email: never logged, in the export,
  -- swept by retention.
  guardian_email text not null check (position('@' in guardian_email) > 1),
  -- SHA-256 of the token, hex. Never the token. `unique` so a collision is a
  -- failed insert rather than an ambiguous lookup.
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  -- Null until the guardian answers. Set on the first decision and updated on a
  -- later withdrawal, so the column always holds the CURRENT answer while
  -- consent_records holds the history - the ledger is the audit trail.
  decided_at     timestamptz,
  decision       boolean
);

comment on table public.guardian_consent_requests is
  'Outstanding and answered guardian consent links. Holds the SHA-256 of the token, never the token. Written only by the security-definer functions below: the athlete may read their own row to see whether a guardian has answered, and may read no token hash. See migration 0045.';

create index if not exists guardian_consent_requests_user_idx
  on public.guardian_consent_requests (user_id, created_at desc);

alter table public.guardian_consent_requests enable row level security;

-- The athlete may see the state of their own request - "we sent it, nobody has
-- answered yet" is information they need and is about them.
drop policy if exists guardian_consent_requests_read on public.guardian_consent_requests;
create policy guardian_consent_requests_read
  on public.guardian_consent_requests for select to authenticated
  using (user_id = auth.uid());

-- ── THE PRIVILEGE, NOT THE POLICY, IS THE CONTROL ───────────────────────────
--
-- A column grant rather than a table grant, for the same reason as 0039: a
-- policy narrows a privilege and does not create one, and `select *` from a
-- browser holding a real JWT would otherwise return token_hash. It is only a
-- hash, and it is still the one column with no business leaving the server.
grant select (id, user_id, guardian_email, created_at, expires_at, decided_at, decision)
  on public.guardian_consent_requests to authenticated;
revoke all on public.guardian_consent_requests from anon;

-- ── 1. The athlete asks ─────────────────────────────────────────────────────
--
-- Called by the minor, with a hash the server computed. Refuses anybody the age
-- gate would not put in the 13-17 band, so a consenting adult cannot manufacture
-- a guardian consent for themselves and a 12-year-old cannot start the flow at
-- all. The age test is written here rather than trusted from the caller,
-- because a rule enforced only in the route is a rule the next route forgets.
create or replace function public.request_guardian_consent(
  p_guardian_email text,
  p_token_hash     text,
  p_ttl_hours      int default 168
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  dob date;
  years int;
  new_id uuid;
begin
  if uid is null then
    raise exception 'request_guardian_consent() requires an authenticated caller';
  end if;

  select p.date_of_birth into dob from public.user_profile p where p.user_id = uid;
  if dob is null then
    raise exception 'guardian_consent_requires_date_of_birth'
      using hint = 'The athlete has no date of birth on file, so their age band is unknown.';
  end if;

  years := extract(year from age(current_date, dob));

  -- 13 to 17 inclusive. An adult does not need one; a child under 13 cannot be
  -- accepted with one. Both are refused here rather than at the edge.
  if years >= 18 or years < 13 then
    raise exception 'guardian_consent_not_applicable'
      using hint = 'A guardian consent applies only to athletes aged 13 to 17.';
  end if;

  insert into public.guardian_consent_requests (user_id, guardian_email, token_hash, expires_at)
  values (uid, lower(btrim(p_guardian_email)), p_token_hash,
          now() + make_interval(hours => greatest(1, least(p_ttl_hours, 720))))
  returning id into new_id;

  return new_id;
end;
$fn$;

comment on function public.request_guardian_consent(text, text, int) is
  'Records an outstanding guardian consent link for the CALLING athlete. Takes a token hash, never a token. Refuses anybody outside the 13-17 band, so the flow cannot be used by an adult to consent to themselves.';

revoke all on function public.request_guardian_consent(text, text, int) from public, anon;
grant execute on function public.request_guardian_consent(text, text, int) to authenticated;

-- ── 2. The guardian answers ─────────────────────────────────────────────────
--
-- Executable by `anon`, deliberately and with the reasoning written down: the
-- guardian has no account, and requiring one would mean making a parent sign up
-- to a service they are being asked to permit rather than use. What authorizes
-- the write is the token, which is 256 bits of CSPRNG and reaches them at an
-- address the athlete named.
--
-- It cannot be aimed: there is no user id argument. The row the token finds
-- decides whose consent is written.
create or replace function public.record_guardian_consent(
  p_token_hash text,
  p_granted    boolean
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  req public.guardian_consent_requests%rowtype;
  current_version text;
begin
  select * into req from public.guardian_consent_requests
   where token_hash = p_token_hash;

  if not found then
    return 'unknown';
  end if;

  -- YES is single-use and expiring. NO is neither - see the header. A guardian
  -- coming back a year later to withdraw must not be told their link is stale.
  if p_granted then
    if req.decided_at is not null then
      return 'already_decided';
    end if;
    if req.expires_at < now() then
      return 'expired';
    end if;
  end if;

  select v.version into current_version
    from public.policy_versions v where v.consent_type = 'guardian_consent';
  if current_version is null then
    raise exception 'guardian_consent_version_missing'
      using hint = 'policy_versions has no row for guardian_consent; migration 0036 seeds it.';
  end if;

  -- The ledger is append-only: a withdrawal is a new row, never an edit.
  insert into public.consent_records (user_id, consent_type, granted, policy_version, guardian_email)
  values (req.user_id, 'guardian_consent', p_granted, current_version, req.guardian_email);

  update public.guardian_consent_requests
     set decided_at = now(), decision = p_granted
   where id = req.id;

  return case when p_granted then 'granted' else 'withdrawn' end;
end;
$fn$;

comment on function public.record_guardian_consent(text, boolean) is
  'Redeems a guardian consent token. Executable by anon because a guardian has no account; the token is what authorizes it and there is no user id argument to aim. Granting is single-use and expires; withdrawing always works, is idempotent, and fails safe.';

revoke all on function public.record_guardian_consent(text, boolean) from public;
grant execute on function public.record_guardian_consent(text, boolean) to anon, authenticated;

-- ── 3. Retention ────────────────────────────────────────────────────────────
--
-- The address on a REQUEST is the same third-party personal data as the address
-- on the consent record, and 0036 gave that 24 months. This is the other copy
-- of it, and a retention promise that covers one copy is not a retention
-- promise. Requests are deleted outright rather than blanked: unlike the
-- ledger, a request row is not an audit trail, it is a pending errand.
insert into public.retention_periods (category, months, note) values
  ('guardian_consent_requests', 24,
   'Guardian consent links are deleted 24 months after they were created. The consent itself lives on the append-only ledger and is never deleted; this table only holds the errand and the address it was sent to.')
on conflict (category) do update
  set months = excluded.months, note = excluded.note;

-- ── 4. The sweep learns about the new table ─────────────────────────────────
--
-- A category in retention_periods prunes NOTHING on its own: apply_retention()
-- reads the months from that table but every DELETE is written out by hand.
-- check-db-invariants.mjs asserts the two agree, so a period without a sweep is
-- a failing check rather than a promise nothing keeps.
--
-- Taken from 0036's definition verbatim and extended by one declaration and one
-- statement, rather than retyped. Retyping this function is how
-- stripe_events.created_at replaced received_at in 0034 and how
-- cleared_to_train was set to null on a NOT NULL column in 0033 - both of which
-- would have aborted every other category on the first row old enough to matter.

create or replace function private.apply_retention()
returns table (category text, affected bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  m_health int := (select rp.months from public.retention_periods rp where rp.category = 'health_restrictions');
  m_glp1   int := (select rp.months from public.retention_periods rp where rp.category = 'glp1_status');
  m_msgs   int := (select rp.months from public.retention_periods rp where rp.category = 'conversation_messages');
  m_audit  int := (select rp.months from public.retention_periods rp where rp.category = 'audit_events');
  m_usage  int := (select rp.months from public.retention_periods rp where rp.category = 'usage_events');
  m_stripe int := (select rp.months from public.retention_periods rp where rp.category = 'stripe_events');
  m_errors int := (select rp.months from public.retention_periods rp where rp.category = 'error_events');
  m_guard  int := (select rp.months from public.retention_periods rp where rp.category = 'guardian_email');
  m_greq   int := (select rp.months from public.retention_periods rp where rp.category = 'guardian_consent_requests');
  n bigint;
begin
  update public.user_profile
     set health_restrictions = null,
         health_restrictions_updated_at = null,
         -- Not null: the column forbids it, and "has not answered yet" is false.
         cleared_to_train = false
   where health_restrictions is not null
     and health_restrictions_updated_at < now() - make_interval(months => m_health);
  get diagnostics n = row_count;
  category := 'health_restrictions'; affected := n; return next;

  update public.user_profile
     set glp1_status = null,
         glp1_status_updated_at = null
   where glp1_status is not null
     and glp1_status_updated_at < now() - make_interval(months => m_glp1);
  get diagnostics n = row_count;
  category := 'glp1_status'; affected := n; return next;

  with trimmed as (
    select c.id,
           coalesce(jsonb_agg(msg order by ord), '[]'::jsonb) as kept,
           jsonb_array_length(c.messages) as before_count
      from public.conversations c
      cross join lateral jsonb_array_elements(c.messages) with ordinality as t(msg, ord)
     where jsonb_array_length(c.messages) > 0
       and (
             (msg ? 'at' and (msg->>'at')::timestamptz >= now() - make_interval(months => m_msgs))
          or (not (msg ? 'at') and c.created_at >= now() - make_interval(months => m_msgs))
           )
     group by c.id, c.messages
  )
  update public.conversations c
     set messages = t.kept
    from trimmed t
   where c.id = t.id
     and jsonb_array_length(t.kept) < t.before_count;
  get diagnostics n = row_count;
  category := 'conversation_messages'; affected := n; return next;

  delete from public.audit_events ae where ae.created_at < now() - make_interval(months => m_audit);
  get diagnostics n = row_count;
  category := 'audit_events'; affected := n; return next;

  delete from public.usage_events ue where ue.created_at < now() - make_interval(months => m_usage);
  get diagnostics n = row_count;
  category := 'usage_events'; affected := n; return next;

  -- The consent stays; only the third party's address goes. UPDATE rather than
  -- DELETE for exactly that reason: deleting the row would destroy the record
  -- that a guardian once agreed, which is the thing the ledger exists to keep.
  update public.consent_records cr
     set guardian_email = null
   where cr.guardian_email is not null
     and cr.created_at < now() - make_interval(months => m_guard);
  get diagnostics n = row_count;
  category := 'guardian_email'; affected := n; return next;

  delete from public.stripe_events se where se.received_at < now() - make_interval(months => m_stripe);
  get diagnostics n = row_count;
  category := 'stripe_events'; affected := n; return next;

  delete from public.error_events ee where ee.created_at < now() - make_interval(months => m_errors);
  get diagnostics n = row_count;
  category := 'error_events'; affected := n; return next;

  delete from public.guardian_consent_requests
   where created_at < now() - make_interval(months => m_greq);
  get diagnostics n = row_count;
  category := 'guardian_consent_requests'; affected := n; return next;

end;
$fn$;

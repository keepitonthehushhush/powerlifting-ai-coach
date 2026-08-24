-- =============================================================================
-- 0008_consent_ledger.sql
--
-- Consent, recorded as an append-only ledger and enforced by the database.
--
-- Washington's My Health My Data Act requires SEPARATE opt-in consent before
-- collecting consumer health data, and again before sharing it. A single
-- bundled "I agree to the terms" checkbox does not satisfy it. The Act has no
-- revenue threshold, reaches out-of-state operators, and carries a private
-- right of action - see docs/LEGAL_CONSIDERATIONS.md.
--
-- Two design decisions worth defending:
--
-- 1. APPEND-ONLY. Consent is never updated in place. Granting writes a row;
--    withdrawing writes another. Current state is the most recent row per
--    (user, type). A mutable boolean answers "do they consent now?"; a ledger
--    answers "what did they agree to, when, and to which version of the
--    policy?" - which is the question actually asked afterwards.
--
-- 2. ENFORCED IN THE DATABASE. A trigger refuses to store health data when
--    consent is not active. Same argument as RLS: a rule that depends on every
--    future code path remembering to check it will eventually be forgotten.
--
-- NOTE: migration 0010 fixes an ordering bug in has_active_consent() below.
-- =============================================================================

create table public.consent_records (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  consent_type   text not null check (consent_type in (
                   'health_data_collection',
                   'ai_processing',
                   'terms_of_service'
                 )),
  granted        boolean not null,
  policy_version text not null,
  created_at     timestamptz not null default now()
);

create index consent_records_user_type_idx
  on public.consent_records (user_id, consent_type, created_at desc);

comment on table public.consent_records is
  'Append-only consent ledger. Never UPDATE or DELETE a row: withdrawal is a new row with granted=false.';

grant select, insert on public.consent_records to authenticated;
alter table public.consent_records enable row level security;

create policy "consent: owner can read own"
  on public.consent_records for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "consent: owner can record own"
  on public.consent_records for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Deliberately NO update or delete policy.

create function public.has_active_consent(p_consent_type text)
returns boolean language sql security invoker stable set search_path = ''
as $$
  select coalesce(
    (select granted from public.consent_records
      where user_id = auth.uid() and consent_type = p_consent_type
      order by created_at desc limit 1),
    false
  );
$$;

revoke all on function public.has_active_consent(text) from public, anon;
grant execute on function public.has_active_consent(text) to authenticated;

create function private.require_health_data_consent()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_incoming text := nullif(btrim(coalesce(new.health_restrictions, '')), '');
begin
  -- Clearing the field needs no consent. Withdrawal must never be blocked by
  -- the absence of the thing being withdrawn.
  if v_incoming is null then return new; end if;

  -- Unchanged value on an unrelated update is not a new collection event.
  if tg_op = 'UPDATE'
     and nullif(btrim(coalesce(old.health_restrictions, '')), '') is not distinct from v_incoming then
    return new;
  end if;

  -- Service role and migrations run with a null auth.uid().
  if auth.uid() is null then return new; end if;

  if not public.has_active_consent('health_data_collection') then
    raise exception 'health data cannot be stored without active health_data_collection consent'
      using errcode = 'check_violation',
            hint = 'Record consent via POST /api/consent before writing health_restrictions.';
  end if;

  return new;
end;
$$;

create trigger user_profile_require_health_consent
  before insert or update of health_restrictions on public.user_profile
  for each row execute function private.require_health_data_consent();

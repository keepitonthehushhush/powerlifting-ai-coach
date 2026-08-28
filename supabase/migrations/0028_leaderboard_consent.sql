-- =============================================================================
-- 0028_leaderboard_consent.sql
--
-- Publishing somebody's lifts to other people is a DIFFERENT PURPOSE from
-- coaching them, and until now the only record that they agreed to it was the
-- existence of a row in leaderboard_entries.
--
-- ── WHY THE ROW IS NOT THE RECORD ───────────────────────────────────────────
--
-- Three reasons, and the third is the one that decides it:
--
--   1. It has no version. If the leaderboard's terms change, there is nothing
--      to compare against and nobody can be asked again - the same problem
--      0027 just fixed for the other three consents.
--   2. It has no consent timestamp. `updated_at` moves every time the numbers
--      are recomputed, so it cannot say when the person agreed.
--   3. LEAVING DELETES IT. The evidence that consent was obtained disappears
--      at exactly the moment somebody might dispute it. GDPR requires a
--      controller to be able to DEMONSTRATE consent; a record destroyed by
--      withdrawal cannot demonstrate anything.
--
-- So the ledger records it, append-only, like the other three, and the entry
-- row goes back to being what it is: a cache of published numbers.
--
-- ── AND THE CHECK LIVES IN THE FUNCTION, NOT THE BUTTON ─────────────────────
--
-- set_leaderboard_opt_in() refuses without an active, current consent. Same
-- reasoning as the health-data trigger in 0008: the browser is not the
-- control. A person can call an RPC directly, and "the UI would not let you"
-- is not an enforcement mechanism.
-- =============================================================================

-- The CHECK constraint from 0008 enumerates the consent types. A new type is a
-- deliberate, auditable schema change rather than a string somebody passes.
alter table public.consent_records
  drop constraint if exists consent_records_consent_type_check;

alter table public.consent_records
  add constraint consent_records_consent_type_check
  check (consent_type in (
    'health_data_collection',
    'ai_processing',
    'terms_of_service',
    'leaderboard_publication'
  ));

insert into public.policy_versions (consent_type, version)
values ('leaderboard_publication', 'lbp-2026-08-28a')
on conflict (consent_type) do update set version = excluded.version, effective_at = now();

-- ----------------------------------------------------------------------------
-- set_leaderboard_opt_in(), now requiring the consent.
--
-- has_active_consent() is version-aware since 0027, so this is refused not
-- only when somebody never agreed but also when they agreed to a superseded
-- version of the leaderboard terms. That is the behaviour we want: a change to
-- what publishing means should stop republishing until it is agreed again.
--
-- LEAVING IS NOT GATED. Withdrawal must never be harder than consent, so
-- opt_in = false runs before any check and always succeeds. Somebody whose
-- consent has gone stale must still be able to take themselves off the board.
-- ----------------------------------------------------------------------------
create or replace function public.set_leaderboard_opt_in(opt_in boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  handle text;
  unit text;
begin
  if uid is null then
    raise exception 'set_leaderboard_opt_in() requires an authenticated caller';
  end if;

  -- Before every other check. Leaving is always available.
  if not opt_in then
    delete from public.leaderboard_entries where user_id = uid;
    return;
  end if;

  if not public.has_active_consent('leaderboard_publication') then
    raise exception 'leaderboard_consent_required'
      using hint = 'Agree to the leaderboard terms before joining.';
  end if;

  select p.display_name, p.units into handle, unit
  from public.user_profile p where p.user_id = uid;

  if handle is null then
    raise exception 'display_name_required'
      using hint = 'Choose a display name before joining the leaderboard.';
  end if;

  insert into public.leaderboard_entries (user_id, display_name, units)
  values (uid, handle, coalesce(unit, 'lb'))
  on conflict (user_id) do update set display_name = excluded.display_name;

  perform public.refresh_leaderboard_entry();
end;
$fn$;

revoke all on function public.set_leaderboard_opt_in(boolean) from anon, public;
grant execute on function public.set_leaderboard_opt_in(boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Withdrawing the consent takes them off the board.
--
-- Otherwise "I withdraw permission to publish my lifts" leaves the lifts
-- published, which would make the consent panel a form that lies. The ledger
-- is append-only, so this fires on the INSERT of a granted=false row.
--
-- Deliberately one-directional: withdrawal removes the entry, but granting
-- does NOT add one. Agreeing that publication is acceptable is not the same
-- act as asking to be published, and inferring the second from the first is
-- how people end up on a leaderboard they never joined.
-- ----------------------------------------------------------------------------
create or replace function private.leaderboard_follows_consent()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  if new.consent_type = 'leaderboard_publication' and new.granted = false then
    delete from public.leaderboard_entries where user_id = new.user_id;
  end if;
  return new;
end;
$fn$;

revoke all on function private.leaderboard_follows_consent() from anon, authenticated, public;

drop trigger if exists leaderboard_follows_consent on public.consent_records;
create trigger leaderboard_follows_consent
  after insert on public.consent_records
  for each row execute function private.leaderboard_follows_consent();

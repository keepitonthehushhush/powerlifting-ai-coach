-- ── A MINOR COULD APPROVE THEIR OWN GUARDIAN CONSENT ───────────────────────
--
-- Found by the Supabase security advisor pointing at the SECURITY DEFINER
-- functions `anon` can execute, and then measured against production inside a
-- transaction that rolled itself back:
--
--     minor age: 15
--     request accepted: t
--     approve outcome: granted
--     GRANTED guardian consents now on that minor: 1
--
-- Two direct PostgREST calls, by a signed-in 13-to-17 year old holding nothing
-- but their own JWT:
--
--   1. rpc/request_guardian_consent  with a token hash THEY invented
--   2. rpc/record_guardian_consent   with that same hash, p_granted => true
--
-- No guardian. No email. No API route. The whole point of the control is that
-- a parent rather than the child makes the decision, and the child held every
-- input needed to make it themselves.
--
-- ── THE ASSUMPTION THAT WAS WRONG ──────────────────────────────────────────
--
-- lib/supabase.js reasons carefully about WHICH CLIENT may call this and
-- concludes: "the token is what authorizes the write." That is true, and it is
-- the hole: the requester chooses the token, so the requester can always
-- authorize themselves. The question the comment never asks is WHO KNOWS THE
-- TOKEN.
--
-- Note it is not enough to close only the approval RPC. `/api/guardian/decision`
-- is public by design and hashes whatever token it is given, so a minor who had
-- chosen the token could simply POST it there and have the server approve it.
-- The request side has to close too, so that the athlete never chooses a token
-- in the first place.
--
-- ── THE FIX: NEITHER SIDE IS REACHABLE FROM A BROWSER ──────────────────────
--
-- Both functions become service-role only. The API server generates the token,
-- stores its hash, mails the token, and never returns it to anyone - which is
-- what it already did. What changes is that this is now the ONLY path, rather
-- than the polite one.
--
-- `request_guardian_consent` therefore takes the athlete explicitly, because a
-- service-role caller has no auth.uid(). That argument is exactly why the
-- REVOKE below is load-bearing rather than tidy: a version of this function
-- taking p_user_id while `authenticated` still held EXECUTE would let any
-- signed-in person open a guardian request against somebody else's account.
-- server/test/guardianConsent.test.js asserts the grants from the catalog.
--
-- Nothing is lost by this. Measured before applying: 0 guardian requests and 0
-- guardian consents have ever existed, and the minors feature is off by
-- default (lib/ageGate.js, `minorsEnabled = false`).

begin;

-- ── 1. The request side takes the athlete explicitly ───────────────────────
drop function if exists public.request_guardian_consent(text, text, integer);

create or replace function public.request_guardian_consent(
  p_user_id uuid,
  p_guardian_email text,
  p_token_hash text,
  p_ttl_hours integer default 168
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  dob date;
  years int;
  new_id uuid;
begin
  if p_user_id is null then
    raise exception 'request_guardian_consent() requires the athlete it is for';
  end if;

  select p.date_of_birth into dob from public.user_profile p where p.user_id = p_user_id;
  if dob is null then
    raise exception 'guardian_consent_requires_date_of_birth'
      using hint = 'The athlete has no date of birth on file, so their age band is unknown.';
  end if;

  years := extract(year from age(current_date, dob));

  if years >= 18 or years < 13 then
    raise exception 'guardian_consent_not_applicable'
      using hint = 'A guardian consent applies only to athletes aged 13 to 17.';
  end if;

  insert into public.guardian_consent_requests (user_id, guardian_email, token_hash, expires_at)
  values (p_user_id, lower(btrim(p_guardian_email)), p_token_hash,
          now() + make_interval(hours => greatest(1, least(p_ttl_hours, 720))))
  returning id into new_id;

  return new_id;
end;
$function$;

-- ── 2. Neither side is callable from a browser ─────────────────────────────
-- Revoked from PUBLIC as well: a grant to PUBLIC would survive the two named
-- revokes and hand the privilege back to every role.
revoke all on function public.request_guardian_consent(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.record_guardian_consent(text, boolean)
  from public, anon, authenticated;

grant execute on function public.request_guardian_consent(uuid, text, text, integer) to service_role;
grant execute on function public.record_guardian_consent(text, boolean) to service_role;

comment on function public.request_guardian_consent(uuid, text, text, integer) is
  'Opens a guardian consent request. SERVICE ROLE ONLY: it takes the athlete as an argument, so a grant to authenticated would let anybody open one against another account. See migration 0077.';
comment on function public.record_guardian_consent(text, boolean) is
  'Records a guardian decision. SERVICE ROLE ONLY: granted to anon until migration 0077, which let a 13-17 year old who chose the token approve their own consent.';

commit;

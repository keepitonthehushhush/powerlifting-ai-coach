-- =============================================================================
-- 0076  Whether anybody arrives at the front door
-- =============================================================================
--
-- ── THE BLIND SPOT ───────────────────────────────────────────────────────────
--
-- Read on 2026-09-14: the last signup was 2026-09-06. Eight days, none since.
-- Nobody is stuck - zero unconfirmed users, no auth failures, sign-up works.
--
-- So one of two things is true. Either nobody is visiting, or people visit and
-- leave. Those need completely different fixes, and this product cannot tell
-- them apart: every measurement it has begins AFTER an account exists. The
-- funnel document, the intake timestamps, the coach-first-opened stamp, the
-- first-week panel that shipped this morning - all of them are about somebody
-- who has already signed up.
--
-- That is this project's recurring defect pointed at the top of the funnel
-- instead of the bottom: two explanations fit, and nothing distinguishes them.
--
-- ── WHY FIRST-PARTY, ON A PRODUCT THAT HOLDS HEALTH DATA ─────────────────────
--
-- Vercel Web Analytics would answer this in an afternoon and is genuinely
-- careful - cookieless, no IP retained, the visitor hash discarded after 24
-- hours. It is still a third-party processor receiving URLs, and on a
-- single-page app that means the routes a SIGNED-IN athlete moves through
-- unless every one of them is redacted. A health product should not need a
-- redaction list standing between it and a third party.
--
-- So this is ours, and it is built to answer exactly one question and be unable
-- to answer any other.
--
-- ── WHAT IT DELIBERATELY CANNOT RECORD ───────────────────────────────────────
--
--   * NO user_id, and no column that could hold one. A visit tied to a person
--     is a browsing history; this table is counts. It is the reason this table
--     needs no cascade from auth.users and appears in no data export - there is
--     nothing here that is anybody's.
--   * NO IP address, no user agent, no session or visitor identifier of any
--     kind. Two visits from the same person are indistinguishable from two
--     people, and that is the design rather than a limitation of it.
--   * NO free-text path. `route` is constrained to a fixed list of PUBLIC
--     pages. /reset-password and /guardian/consent are absent on purpose:
--     both carry a token in the URL, and recording "somebody was on the
--     password-reset page at 14:02" is a fact about one identifiable person
--     even when the token itself is never stored.
--   * NO referrer URL. Only a bucket from a closed set, the same treatment the
--     user agent already gets in crash reports - a full referrer is a
--     fingerprint, and "somebody came from search" is the whole question.
--
-- ── AND HOW AN ANONYMOUS WRITE IS PROTECTED ──────────────────────────────────
--
-- This is an unauthenticated insert endpoint, which this repository has
-- deliberately avoided before: record_client_error_event refuses an anon
-- caller for exactly that reason.
--
-- It is allowed here for the same reason record_auth_failure (migration 0043)
-- is allowed it - the event happens before there is a session, so there is no
-- other way to see it - and it copies that function's protections rather than
-- inventing new ones: arguments from fixed lists or nothing happens, a global
-- flood cap because there is no user to scope a rate limit to, a boolean
-- return and never an exception, and no free text anywhere.
--
-- The honest residue: a determined person can inflate a counter. The blast
-- radius is a wrong number in a table nobody bills on, the flood cap bounds
-- the cost, and the alternative is not knowing whether anybody visits at all.
-- Written down here rather than discovered later.
-- =============================================================================

create table if not exists public.page_visits (
  seq        bigserial primary key,
  route      text not null,
  referrer   text not null,
  created_at timestamptz not null default now()
);

-- `now()` is transaction start time, so two rows written in one transaction
-- share it and sort arbitrarily. seq is what orders this table.
create index if not exists page_visits_created_at_idx on public.page_visits (created_at);

alter table public.page_visits
  drop constraint if exists page_visits_route_check;

alter table public.page_visits
  add constraint page_visits_route_check
  check (route in (
    '/', '/login', '/about', '/faq',
    '/policies/privacy', '/policies/terms', '/policies/ai-processing',
    '/policies/health-data', '/policies/leaderboard', '/policies/guardian-consent'
  ));

alter table public.page_visits
  drop constraint if exists page_visits_referrer_check;

alter table public.page_visits
  add constraint page_visits_referrer_check
  check (referrer in ('direct', 'search', 'social', 'ai', 'other'));

comment on table public.page_visits is
  'Counts of arrivals at the public pages, and nothing else. No user_id, no IP, no user agent, no visitor identifier - two visits by one person are indistinguishable from two people by design. Route is constrained to a fixed list of public pages and excludes /reset-password and /guardian/consent, which carry tokens and whose mere timestamp identifies somebody. Referrer is a bucket from a closed set, never a URL. Exists because the last signup was 2026-09-06 and nothing in this product could say whether anybody was arriving at all. See migration 0076.';

-- RLS on with no policy, the same shape as stripe_events: nothing reads this
-- through PostgREST. The write goes through the definer function below and the
-- reads happen out of band.
alter table public.page_visits enable row level security;

revoke all on public.page_visits from anon, authenticated;

create or replace function public.record_page_visit(p_route text, p_referrer text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- Rows written in the last minute, across everybody. Global, because there
  -- is no user here to scope a cap to - the same reasoning record_auth_failure
  -- gives for its own ceiling.
  recent bigint;
  ceiling constant int := 120;
begin
  /*
   * Silently false rather than an exception, three times over. This is called
   * from a page somebody is reading; a counter that raises would turn a visit
   * into an error in their console, and telemetry is never worth that.
   *
   * The CHECK constraints are the enforcement. These guards exist so that an
   * unrecognized value is a no-op rather than a failed insert.
   */
  if p_route is null or p_referrer is null then
    return false;
  end if;

  if p_referrer not in ('direct', 'search', 'social', 'ai', 'other') then
    return false;
  end if;

  if p_route not in (
    '/', '/login', '/about', '/faq',
    '/policies/privacy', '/policies/terms', '/policies/ai-processing',
    '/policies/health-data', '/policies/leaderboard', '/policies/guardian-consent'
  ) then
    return false;
  end if;

  select count(*) into recent
    from public.page_visits v
   where v.created_at > now() - interval '1 minute';

  if recent >= ceiling then
    return false;
  end if;

  insert into public.page_visits (route, referrer) values (p_route, p_referrer);
  return true;
end;
$fn$;

comment on function public.record_page_visit(text, text) is
  'Records one arrival at a public page. Takes a route and a referrer bucket, both from fixed lists, and nothing else - no address, no identifier, no free text. Executable by anon because a visit happens before there is a session and there is no other way to see it. Flood-capped globally at 120 rows a minute because there is no user to rate limit. Returns false rather than raising: it is called from a page somebody is reading. Best-effort counts, not an audit trail.';

revoke all on function public.record_page_visit(text, text) from public;
grant execute on function public.record_page_visit(text, text) to anon, authenticated;

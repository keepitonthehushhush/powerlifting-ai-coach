-- =============================================================================
-- 0067_the_food_setting_changed_what_the_page_promises.sql
--
-- ── WHY A VERSION BUMP FOR A SETTING NOBODY HAS CHANGED YET ─────────────────
--
-- Migration 0066 gave athletes a control over how much the coach talks about
-- food. Making it work means the choice has to REACH the coach, so at anything
-- other than the default a short instruction goes into the request - "do not
-- raise eating", or "ranges only".
--
-- That is a new item on a page whose heading is "What is sent, precisely". The
-- rule in policyVersions.js is not conditional: "changing policy text without
-- bumping it silently invalidates every consent already on file." Nobody
-- agreed to a list with this line on it, so nobody has agreed to this page.
--
-- The honest counter-argument, which is why this was a decision rather than a
-- reflex: for every athlete who does nothing, NOTHING NEW IS SENT. The default
-- emits no directive at all, so the request is byte-for-byte what it was
-- before, and the only way to trigger the new line is to go to your own
-- account page and change a setting that explains itself while you change it.
--
-- It was bumped anyway. A disclosure that is accurate only for people who have
-- not used a feature is not a disclosure, and "we did not think you would
-- notice" is not a standard. The changelog paragraph on the page says both
-- halves - the list is longer, and nothing new is sent unless you change it
-- yourself - because the people being asked again deserve to know which of the
-- two reasons they are being asked for.
--
-- The cost is real and is not hidden here: every athlete is asked to agree
-- again before their next coaching reply.
-- =============================================================================

insert into public.policy_versions (consent_type, version) values
  ('ai_processing', 'aip-2026-09-09a')
on conflict (consent_type) do update
  set version = excluded.version, effective_at = now();

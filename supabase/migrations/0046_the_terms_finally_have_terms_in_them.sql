-- =============================================================================
-- 0046_the_terms_finally_have_terms_in_them.sql
--
-- tos-2026-08-27b -> tos-2026-08-31a.
--
-- ── WHY THIS IS A BUMP AND NOT A QUIET EDIT ─────────────────────────────────
--
-- The internal policy review found the Terms missing most of what a contract is
-- expected to contain: no governing law or venue, no limitation of liability
-- beyond a single uncapped sentence, no warranty disclaimer, no indemnity, no
-- severability or entire-agreement section, no copyright complaints route, no
-- accessibility statement, and - with Stripe already wired - no subscription,
-- auto-renewal, cancellation or refund terms at all.
--
-- Those are not clarifications of an existing bargain. They ARE the bargain:
-- where a dispute is heard, what we are liable for, what happens when a card is
-- charged again next month. Somebody who agreed to tos-2026-08-27b agreed to a
-- document that said nothing about any of it, and treating that as agreement to
-- this one would be exactly the move this project has refused twice before -
-- chd-2026-08-27 and aip-2026-08-27, both bumped rather than quietly corrected.
--
-- One sentence was also CORRECTED rather than added, which is its own reason to
-- ask again. The Terms said account deletion keeps "nothing back for our own
-- records". Two things survive: audit rows, with the user id nulled so they no
-- longer identify anybody, and Stripe's own transaction records, which are not
-- ours to delete. A promise that was not true is not fixed by making it true
-- silently.
--
-- has_active_consent() reads this table and fails closed, so the moment this
-- lands every terms_of_service grant goes stale and the consent screen asks
-- again. terms_of_service is in REQUIRED_CONSENTS, so that gate is the whole
-- product rather than one feature. That is the mechanism working as designed,
-- and it is the reason to land this while the user count is four rather than
-- four thousand.
--
-- Must match POLICY_VERSIONS in server/src/lib/policyVersions.js;
-- scripts/check-db-invariants.mjs asserts the two agree row-for-row.
-- =============================================================================

insert into public.policy_versions (consent_type, version) values
  ('terms_of_service', 'tos-2026-08-31a')
on conflict (consent_type) do update
  set version = excluded.version, effective_at = now();

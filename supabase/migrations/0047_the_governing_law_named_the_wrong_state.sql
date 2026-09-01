-- =============================================================================
-- 0047_the_governing_law_named_the_wrong_state.sql
--
-- tos-2026-08-31a -> tos-2026-08-31b, hours after the first.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- The Terms shipped this morning said the agreement is governed by the laws of
-- the State of Florida and that disputes go to Florida courts. The privacy
-- policy said the service is operated from Florida. The operator is in
-- Michigan.
--
-- It came from a menu of options offered to the owner, who picked one; nobody
-- checked it against where he actually lives, and it only surfaced when he
-- asked for a lawyer near Pinckney, Michigan. Which is the same defect this
-- codebase keeps finding, in a document instead of a function: a confident
-- statement produced without looking at the thing it describes.
--
-- ── WHY IT IS A BUMP RATHER THAN A TYPO FIX ─────────────────────────────────
--
-- Governing law and venue are not descriptive prose. They decide whose consumer
-- statutes apply and where somebody has to travel to bring a claim. Somebody
-- who agreed to tos-2026-08-31a agreed to Florida courts. Changing that under
-- them silently would be exactly the move refused three times already in this
-- schema - chd-2026-08-27, aip-2026-08-27, tos-2026-08-31a - each of which was
-- bumped rather than quietly corrected.
--
-- The cost is low and the timing is the reason: the wrong version was live for
-- a matter of hours, on a service with four accounts, none of which had
-- re-consented to it yet.
--
-- Must match POLICY_VERSIONS in server/src/lib/policyVersions.js;
-- scripts/check-db-invariants.mjs asserts the two agree row-for-row.
-- =============================================================================

insert into public.policy_versions (consent_type, version) values
  ('terms_of_service', 'tos-2026-08-31b')
on conflict (consent_type) do update
  set version = excluded.version, effective_at = now();

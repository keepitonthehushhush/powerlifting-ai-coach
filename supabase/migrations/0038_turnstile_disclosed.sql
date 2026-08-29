-- =============================================================================
-- 0038_turnstile_disclosed.sql
--
-- The consumer health data policy moves to chd-2026-08-29a.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- The page said: "one other outbound request exists anywhere in this product",
-- meaning the Have I Been Pwned range check. There are two. web/src/lib/
-- turnstile.js loads https://challenges.cloudflare.com/turnstile/v0/api.js on
-- the sign-in page and the widget then talks to Cloudflare, which receives - by
-- Cloudflare's own account - the visitor's IP address, a TLS fingerprint, the
-- user-agent header, and our site key with its origin.
--
-- Nothing changed about the product. Turnstile has been there since sign-in was
-- built, it runs nowhere near the pages where health information is entered, and
-- it is neither analytics nor advertising - so the neighbouring sentence about
-- analytics and advertising scripts stayed true throughout. What was wrong was
-- the count, in a document whose entire value is being exact about facts of
-- exactly that size.
--
-- ── AND WHY THAT IS WORTH A RE-CONSENT ──────────────────────────────────────
--
-- Twice before, an audit found this product's disclosures describing less than
-- the product does - chd-2026-08-27 (four undisclosed lifestyle fields) and
-- aip-2026-08-27 (age, progress cadence, session notes) - and both times the
-- answer was to bump and ask again rather than to quietly correct the page. The
-- rule those set is that a consent recorded against a document that did not
-- describe what we do is not a consent to what we do. This is the same shape,
-- so it gets the same answer.
--
-- has_active_consent() reads this table, so the moment this lands every existing
-- health_data_collection grant stops authorising writes and the consent panel
-- shows the box unticked. That is the mechanism working, not a regression.
--
-- Must match POLICY_VERSIONS in server/src/lib/policyVersions.js;
-- scripts/check-db-invariants.mjs asserts the two agree row-for-row.
-- =============================================================================

insert into public.policy_versions (consent_type, version) values
  ('health_data_collection', 'chd-2026-08-29a')
on conflict (consent_type) do update
  set version = excluded.version, effective_at = now();

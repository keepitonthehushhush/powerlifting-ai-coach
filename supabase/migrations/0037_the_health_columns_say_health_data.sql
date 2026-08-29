-- =============================================================================
-- 0037_the_health_columns_say_health_data.sql
--
-- Three comment changes, and the reason they are a migration rather than a
-- tidy-up.
--
-- ── WHAT THE COMMENT IS LOAD-BEARING FOR ────────────────────────────────────
--
-- scripts/check-db-invariants.mjs asserts:
--
--     every column documented as health data is gated by the consent trigger
--
-- and it finds those columns by asking the catalogue which ones carry a comment
-- LIKE 'Health data.%'. Every health column on user_profile opens that way -
-- sleep, alcohol, nicotine, nutrition notes, gender, gender_self_described -
-- because 0012 set the convention and 0024 followed it.
--
-- Two columns did not, and one of them is the original.
--
--   glp1_status         0033 put HEALTH DATA in the MIDDLE of a sentence.
--   health_restrictions 0001 opened with SENSITIVE:, before the convention
--                       that 0012 went on to set.
--
-- Both read identically to a human. Both are invisible to a LIKE. So the
-- invariant written to guarantee these columns are gated has never once looked
-- at either of them - including at health_restrictions, which is the injury
-- note, which is the column the entire consent mechanism was built around.
--
-- Both ARE gated, so nothing was wrong in production. That is exactly the
-- problem worth fixing: covered by luck, and reported as covered by a check
-- that was not reading them. Asked against the live catalogue rather than
-- assumed - `select ... where col_description(...) like 'Health data.%'` on the
-- preview database returned seven columns and neither of these two.
--
-- Found by server/test/healthWithdrawal.test.js, which derives its list of
-- health columns the same way and came back one short.
--
-- ── AND THE OTHER HALF ──────────────────────────────────────────────────────
--
-- Renaming the comment closes today's gap and not the class. So the invariants
-- file gains the converse check in the same change: every column the
-- fingerprint reads must ALSO carry the comment. One direction catches a
-- column documented and ungated; the other catches a column gated and
-- undocumented, which is what this migration is repairing.
-- =============================================================================

comment on column public.user_profile.health_restrictions is
  'Health data. User-reported injuries and medical conditions. Must never be logged or forwarded to third-party observability. Gated by health_data_collection consent.';

comment on column public.user_profile.glp1_status is
  'Health data. Whether the athlete uses, is considering, or does not use a GLP-1 medication - log-redacted, and expiring with the other health fields. Recorded so the coaching can protect lean mass, never so the app can have an opinion about the medication. Gated by health_data_collection consent.';

-- ── AND THE ONE THAT STAYS OUT, ON PURPOSE ──────────────────────────────────
--
-- cleared_to_train is health-adjacent by any reading - it records whether a
-- professional has assessed an injury - and the consumer health data policy
-- lists it as something collected under that consent. It is cleared on
-- withdrawal along with everything else.
--
-- It is deliberately NOT in private.health_fingerprint(), and the reason is
-- mechanical rather than philosophical. It is `boolean not null default false`,
-- so every profile row has a value for it and always has. A fingerprint that
-- read it could never be NULL - and NULL is the signal the consent trigger uses
-- for "this write clears everything, let it through". Adding it would make
-- every withdrawal look like a fresh collection of health data and be refused,
-- which is precisely the bug this migration's sibling change repairs.
--
-- Written down because "why is this one missing" is the obvious question, and
-- the obvious answer - add it - breaks erasure.
comment on column public.user_profile.cleared_to_train is
  'Whether a professional has cleared this athlete to train. Health-adjacent and cleared on consent withdrawal, but deliberately OUTSIDE private.health_fingerprint(): it is NOT NULL, so a fingerprint including it could never be null, and null is what tells the consent trigger that a write is an erasure rather than a collection.';

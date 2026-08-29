-- =============================================================================
-- 0040_reconcile_withdrawals_that_erased_nothing.sql
--
-- Cleanup for the bug fixed in the same change as this: a withdrawal of
-- health_data_collection consent that recorded on the ledger and erased nothing,
-- for any athlete who had answered the gender or GLP-1 question.
--
-- ── WHAT THIS ACTUALLY FOUND ────────────────────────────────────────────────
--
-- Nothing, and that is written down rather than implied. Queried against
-- production before this file was written:
--
--     profiles_total                            4
--     latest_decision_is_withdrawal             0
--     withdrawn_but_still_holding_health_data   0
--
-- Nobody has withdrawn health-data consent yet, so there is no stranded row to
-- clear today. This runs anyway, because it is idempotent, because the window
-- between writing this and deploying it is not zero, and because the same state
-- can exist in any environment that is not production.
--
-- ── AND WHY IT IS ALSO AN INVARIANT ─────────────────────────────────────────
--
-- A one-shot data fix answers "is this true now". The property worth holding is
-- "a withdrawn consent means no health data", which is a thing that should be
-- true forever and was not for four months without anything saying so. So
-- check-db-invariants.mjs gains it as a standing check, and this migration is
-- the one-time reconciliation that makes the check pass on day one.
--
-- The consent trigger does not fire against this. Migrations run with a null
-- auth.uid(), which private.require_health_data_consent() treats as "not an
-- end-user collection" and passes through - which is the branch that makes a
-- repair like this possible at all.
-- =============================================================================

with latest as (
  select distinct on (c.user_id) c.user_id, c.granted
    from public.consent_records c
   where c.consent_type = 'health_data_collection'
   order by c.user_id, c.seq desc
)
update public.user_profile p
   set health_restrictions            = '',
       health_restrictions_updated_at = null,
       -- NOT NULL since 0001. "Has not answered yet" is a different statement
       -- from "is not cleared", and null is not available to say either.
       cleared_to_train               = false,
       sleep_hours_typical            = null,
       alcohol_units_per_week         = null,
       nicotine_use                   = null,
       nutrition_notes                = null,
       gender                         = null,
       gender_self_described          = null,
       glp1_status                    = null,
       glp1_status_updated_at         = null
  from latest l
 where l.user_id = p.user_id
   and l.granted is false
   -- Only rows that actually still hold something, so a re-run touches nothing
   -- and updated_at does not move for people who are already clean.
   and (
        nullif(btrim(coalesce(p.health_restrictions, '')), '') is not null
     or nullif(btrim(coalesce(p.nutrition_notes, '')), '') is not null
     or p.sleep_hours_typical is not null
     or p.alcohol_units_per_week is not null
     or nullif(p.nicotine_use, '') is not null
     or nullif(p.gender, '') is not null
     or nullif(btrim(coalesce(p.gender_self_described, '')), '') is not null
     or p.glp1_status is not null
   );

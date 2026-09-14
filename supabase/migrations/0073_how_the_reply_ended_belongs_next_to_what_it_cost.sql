-- =============================================================================
-- 0073  How the reply ended belongs next to what it cost
-- =============================================================================
--
-- ── THE MEASUREMENT THAT IS CURRENTLY IMPOSSIBLE ─────────────────────────────
--
-- On 2026-09-14, reading usage_events: 5 of the 101 replies this product has
-- ever produced came back at exactly 8192 output tokens, and 7 were at or above
-- 7000. 8192 is max_tokens. A reply that reaches it stops mid-sentence, and the
-- tail of a coaching reply is where the cool-down, the accessory work and the
-- machine-readable program block live.
--
-- The athlete IS told - TRUNCATION_NOTICE has been appended to the prose since
-- it was written. What nobody can do is COUNT it. `coach.reply_truncated` is a
-- logger.warn, and this platform's log retention is a day, with historical
-- reads gated behind the plan. "Five of a hundred and one" had to be inferred
-- from output_tokens landing on a round number, which works only while
-- max_tokens never changes - and this migration ships alongside a change to
-- max_tokens.
--
-- ── WHY NOT error_events ─────────────────────────────────────────────────────
--
-- That was the first plan and the table refused it, correctly. Its
-- `error_events_origin_shape` CHECK requires a server row to carry an HTTP
-- status between 400 and 599. A truncated reply is a 200: the athlete got the
-- words, the reply was saved, the request succeeded. Recording it there would
-- have meant either inventing a failure status or widening a constraint that
-- exists to keep that table meaning one thing.
--
-- usage_events is where it belongs anyway. There is already exactly one row per
-- reply, carrying the token counts, and "did this reply hit its ceiling" is a
-- property of that reply sitting one column away from the number that proves
-- it. The query that found the problem and the column that records it are then
-- the same query.
--
-- ── A CLOSED SET, NOT THE VENDOR'S STRING ────────────────────────────────────
--
-- Same argument errorRecord.js makes about upstreamReason. A stop reason is
-- short and looks safe, and it is still somebody else's vocabulary arriving
-- unconstrained into our database. The CHECK is ours; an unrecognized value is
-- stored as 'other' rather than passed through, so a vendor adding a reason
-- cannot start writing rows nobody planned for.
--
-- Nullable, because every row written before today has one and it is not known.
-- Backfilling it from output_tokens = 8192 would be a guess written down as a
-- fact, and this table is the one place in the product that has never had to
-- guess.
-- =============================================================================

alter table public.usage_events
  add column if not exists stop_reason text;

alter table public.usage_events
  drop constraint if exists usage_events_stop_reason_check;

alter table public.usage_events
  add constraint usage_events_stop_reason_check
  check (
    stop_reason is null
    or stop_reason in ('end_turn', 'max_tokens', 'model_context_window_exceeded', 'stop_sequence', 'refusal', 'tool_use', 'other')
  );

comment on column public.usage_events.stop_reason is
  'Why the model stopped writing this reply, from a closed set of our own - an unrecognized vendor value is stored as other rather than passed through. Exists so that how often a reply hits its ceiling is countable next to the token counts that prove it, rather than inferred from output_tokens landing on a round number. Null for every row written before 2026-09-14, and deliberately not backfilled: a guess recorded as a fact is worse than an absence. Not health data and never sent to the model.';

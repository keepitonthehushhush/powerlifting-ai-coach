-- =============================================================================
-- 0069_why_the_model_said_no_outlives_the_log.sql
--
-- One more key on error_events.detail, from a closed list.
--
-- ── THE QUESTION, ASKED TWICE, UNANSWERED BOTH TIMES ────────────────────────
--
-- The model API returned 400 twice on 2026-09-10, five seconds apart. Two
-- rows landed in error_events, each carrying `upstreamStatus: 400` and nothing
-- else, and 400 is the one status whose reason lives nowhere but the message.
--
-- Instrumentation added the day before logs exactly that reason -
-- `upstreamType` and a hard-truncated `upstreamMessage` - to the platform's
-- runtime log stream. Asked for the ten minutes around the failure, five hours
-- later, that stream answered `ExceedsBillingLimitError` and returned nothing.
--
-- So the second attempt failed the same way as the first, for a different
-- reason. errorRecord.js already wrote down why a table beats a log stream,
-- about an earlier version of this same problem: those logs "expire in days,
-- cannot be grouped by anything meaningful, and answer what happened just now
-- rather than what keeps happening - and the failure everybody hits and
-- nobody bothers to report is exactly the one a log stream loses."
--
-- ── WHY A LABEL AND NOT THE MESSAGE ─────────────────────────────────────────
--
-- Because the message is vendor prose and this product's messages are health
-- information. A vendor that ever quoted the offending content back would put
-- it in a table the README promises holds none. That is why this table has a
-- key allowlist in code AND a CHECK in the database: one of the two will
-- eventually be edited by somebody in a hurry, and the other has to hold.
--
-- A classification cannot carry a sentence somebody typed. It is chosen from a
-- list we wrote, in code we control, and it answers the operational question -
-- was the prompt too long, was a message empty, is the vendor down - without
-- storing a word the vendor said.
--
-- ── AND WHY NOT THE VENDOR'S OWN TYPE ───────────────────────────────────────
--
-- `invalid_request_error` is short and safe and it is still somebody else's
-- vocabulary sitting in our database, changeable without notice and outside
-- the reach of the CHECK below. One field, ours, closed.
--
-- ── THE VALUE IS CONSTRAINED, NOT ONLY THE KEY ──────────────────────────────
--
-- The same shape as `platform` in 0060, and for the same reason: a closed list
-- enforced where it cannot be forgotten. A key allowlist alone would let any
-- string through under an approved name, which is most of the way back to
-- storing prose.
--
-- `unclassified` and `invalid_request_other` are IN the list on purpose. A
-- classifier with no bucket for "we do not know" either guesses or drops the
-- row, and both are worse than an honest count of the ones nobody has looked
-- at yet.
-- =============================================================================

alter table public.error_events drop constraint if exists error_events_detail_check;
alter table public.error_events add constraint error_events_detail_check
  check (detail - array[
    'stopReason', 'stopCategory', 'blockTypes', 'hadText', 'upstreamStatus',
    'cause', 'needs', 'reason', 'subject', 'field', 'limit', 'length',
    'attempt', 'retryable', 'errorName', 'topFrame', 'frames', 'build',
    'platform', 'standalone', 'upstreamReason'
  ] = '{}'::jsonb);

alter table public.error_events drop constraint if exists error_events_upstream_reason_shape;
alter table public.error_events add constraint error_events_upstream_reason_shape
  check (
    detail ->> 'upstreamReason' is null
    or detail ->> 'upstreamReason' in (
      'prompt_too_long',
      'max_tokens_too_large',
      'empty_content',
      'rate_limited',
      'overloaded',
      'server_error',
      'timeout',
      'credentials',
      'request_too_large',
      'billing',
      'invalid_request_other',
      'unclassified'
    )
  );

comment on column public.error_events.detail is
  'Whitelisted keys only, enforced by error_events_detail_check. Carries no message text and no user agent: `platform` is one of nine coarse buckets resolved in the browser (see web/src/lib/crashReport.js), `standalone` says only whether the app was running from the home screen, and `upstreamReason` is one of twelve labels this codebase chose (see UPSTREAM_REASONS in server/src/lib/coachOutcome.js) rather than anything the model vendor said.';

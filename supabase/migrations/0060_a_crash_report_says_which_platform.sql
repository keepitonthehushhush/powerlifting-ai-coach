-- =============================================================================
-- 0060_a_crash_report_says_which_platform.sql
--
-- Two keys, so a crash on somebody's Android phone is distinguishable from one
-- on a desktop.
--
-- ── WHY THIS IS NEEDED NOW ──────────────────────────────────────────────────
--
-- The link is about to go to ten people with ten different phones, and the
-- reports could not tell them apart: an Android Chrome crash and a desktop
-- Firefox crash produced byte-identical rows. "Are all of these on one
-- platform" is the first question anybody asks about a cluster of failures and
-- error_events could not answer it at all.
--
-- ── A BUCKET, NEVER A USER AGENT ────────────────────────────────────────────
--
-- The obvious implementation stores navigator.userAgent, and it is the wrong
-- one on a product holding health data. A user agent carries version, build,
-- device model and sometimes locale - a fingerprinting surface, attached to
-- every crash, for the sake of a patch number nobody would act on.
--
-- So the browser resolves it to one of nine values BEFORE anything leaves, the
-- raw string is never sent, and the CHECK below pins the column to that list.
-- That last part is the point of doing it in a migration rather than only in
-- JavaScript: a future caller cannot widen it by accident, and a raw user
-- agent sent here is rejected by the database rather than stored.
--
-- `standalone` is the second key and it is one boolean: was the app running
-- from the home screen. iOS evicts a standalone web view aggressively, and
-- that is the difference between "it forgot my theme" being a mystery and
-- being a known platform behavior - this app has already paid for that once.
--
-- Neither key identifies anybody. Nine platforms and a boolean, across a user
-- base measured in single digits, is not a fingerprint; a user agent would be.
-- =============================================================================

alter table public.error_events drop constraint if exists error_events_detail_check;
alter table public.error_events add constraint error_events_detail_check
  check (detail - array[
    'stopReason', 'stopCategory', 'blockTypes', 'hadText', 'upstreamStatus',
    'cause', 'needs', 'reason', 'subject', 'field', 'limit', 'length',
    'attempt', 'retryable', 'errorName', 'topFrame', 'frames', 'build',
    'platform', 'standalone'
  ] = '{}'::jsonb);

-- The value, not just the key. A closed list enforced where it cannot be
-- forgotten - the same reasoning as the topFrame shape check beside it.
alter table public.error_events drop constraint if exists error_events_platform_shape;
alter table public.error_events add constraint error_events_platform_shape
  check (
    detail ->> 'platform' is null
    or detail ->> 'platform' in (
      'ios-safari', 'ios-other',
      'android-chrome', 'android-other',
      'mac-safari', 'mac-other',
      'windows', 'linux', 'other'
    )
  );

alter table public.error_events drop constraint if exists error_events_standalone_shape;
alter table public.error_events add constraint error_events_standalone_shape
  check (
    detail -> 'standalone' is null
    or jsonb_typeof(detail -> 'standalone') = 'boolean'
  );

comment on column public.error_events.detail is
  'Whitelisted keys only, enforced by error_events_detail_check. Carries no message text and no user agent: `platform` is one of nine coarse buckets resolved in the browser (see web/src/lib/crashReport.js) and `standalone` says only whether the app was running from the home screen.';

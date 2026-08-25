-- =============================================================================
-- rls_isolation_test.sql
--
-- Proves that Row Level Security actually isolates users. Run this against any
-- environment before trusting it with real health data.
--
-- Why it is written in SQL rather than as an HTTP integration test: PostgREST
-- authenticates a request by switching to the `authenticated` role and setting
-- request.jwt.claims. Doing exactly that here tests the same enforcement path
-- with no application code in between, so a passing result is evidence about
-- the policies themselves rather than about the API that happens to call them.
--
-- Usage:
--   psql "$DATABASE_URL" -f supabase/tests/rls_isolation_test.sql
--
-- Every statement runs inside one transaction that is rolled back at the end,
-- so the test leaves no fixtures behind.
-- =============================================================================

begin;

\set A '''aaaaaaaa-0000-4000-8000-000000000001'''
\set B '''bbbbbbbb-0000-4000-8000-000000000002'''

-- --- fixtures (as the migration role, RLS bypassed) --------------------------
insert into auth.users (id, email) values
  (:A::uuid, 'athlete-a@rlstest.local'),
  (:B::uuid, 'athlete-b@rlstest.local');

-- The signup trigger has already created both user_profile rows.
update public.user_profile set health_restrictions='A: left shoulder impingement' where user_id=:A::uuid;
update public.user_profile set health_restrictions='B: lumbar disc herniation'    where user_id=:B::uuid;

insert into public.workout_programs (user_id, phase, program_data)
  values (:A::uuid,'novice','{"owner":"A"}'), (:B::uuid,'peaking','{"owner":"B"}');
insert into public.progress_logs (user_id, lift, weight, reps)
  values (:A::uuid,'squat',225,5), (:B::uuid,'squat',500,5);
insert into public.conversations (user_id, messages)
  values (:A::uuid,'[{"role":"user","content":"A private"}]'), (:B::uuid,'[{"role":"user","content":"B private"}]');

-- --- become athlete A --------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :A, 'role', 'authenticated')::text, true);

do $$
begin
  assert (select count(*) from public.user_profile)     = 1, 'A must see exactly one profile';
  assert (select count(*) from public.workout_programs) = 1, 'A must see exactly one program';
  assert (select count(*) from public.conversations)    = 1, 'A must see exactly one conversation';
  assert (select count(*) from public.user_profile where health_restrictions like 'B:%') = 0,
         'A must not be able to read B health data';
  assert (select count(*) from public.conversations where messages::text like '%B private%') = 0,
         'A must not be able to read B conversations';
end $$;

-- Silent-failure attacks: the policy filters the rows out, so these affect nothing.
do $$
declare touched int;
begin
  update public.user_profile set health_restrictions='PWNED' where user_id='bbbbbbbb-0000-4000-8000-000000000002';
  get diagnostics touched = row_count;
  assert touched = 0, 'A must not be able to update B profile';

  delete from public.progress_logs where user_id='bbbbbbbb-0000-4000-8000-000000000002';
  get diagnostics touched = row_count;
  assert touched = 0, 'A must not be able to delete B progress logs';

  -- The catastrophic-mistake case: a DELETE with no WHERE clause at all.
  -- RLS scopes it to the caller's own rows, so it cannot become a mass deletion.
  delete from public.conversations;
  get diagnostics touched = row_count;
  assert touched = 1, 'An unqualified DELETE must remove only the caller''s own row';
end $$;

-- Hard-failure attacks: the WITH CHECK clause raises rather than silently dropping.
do $$
begin
  begin
    insert into public.workout_programs (user_id, phase, program_data)
      values ('bbbbbbbb-0000-4000-8000-000000000002','novice','{"forged":true}');
    raise exception 'A was able to forge a program owned by B';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.user_profile set user_id='bbbbbbbb-0000-4000-8000-000000000002'
      where user_id='aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'A was able to reassign their own row to B';
  exception when insufficient_privilege then null;
  end;
end $$;

-- --- ownership is supplied by the database, not by the caller -----------------
--
-- Added after POST /api/chat failed for every user on its first real request:
-- the route inserted a conversation without naming an owner, exactly as ADR-2
-- says application code should, and conversations.user_id was NOT NULL with no
-- default. See migration 0011.
--
-- Three assertions, because the fix has to be safe as well as effective: the
-- omission must work, it must attribute the row to the right person, and it
-- must not have weakened the check that stops forgery.
do $$
declare inserted_owner uuid;
begin
  insert into public.conversations (title) values ('no owner named')
    returning user_id into inserted_owner;
  assert inserted_owner = 'aaaaaaaa-0000-4000-8000-000000000001',
         'an insert that names no owner must be attributed to the caller';

  insert into public.progress_logs (lift, weight, reps) values ('bench', 185, 5)
    returning user_id into inserted_owner;
  assert inserted_owner = 'aaaaaaaa-0000-4000-8000-000000000001',
         'the default must apply to every user-owned table, not just conversations';

  -- The default is a convenience. WITH CHECK is the control, and it still is.
  begin
    insert into public.conversations (user_id, title)
      values ('bbbbbbbb-0000-4000-8000-000000000002','forged');
    raise exception 'the default weakened the INSERT policy - A forged a row owned by B';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The consent trigger must fire on EVERY column, not a named list.
--
-- Migration 0008 declared it `before insert or update OF health_restrictions`.
-- 0012 added four more health columns and taught the trigger FUNCTION about
-- them, but left that column list alone - so updating sleep, alcohol, nicotine
-- or nutrition stored health data without the consent check ever running.
-- INSERT was unaffected (a column list does not apply to it), which is exactly
-- why it stayed hidden: the app upserts, and for an existing row that is an
-- UPDATE. Fixed in 0014; asserted here so it cannot come back.
do $$
declare scoped_to text;
begin
  select string_agg(a.attname, ', ' order by a.attnum)
    into scoped_to
    from pg_trigger t
    join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])
   where t.tgrelid = 'public.user_profile'::regclass
     and t.tgname = 'user_profile_require_health_consent';

  assert scoped_to is null,
         format('the consent trigger only fires for: %s - every other health column is ungated', scoped_to);
end $$;

-- Structural check, so a table added later cannot quietly reintroduce the bug.
do $$
declare missing text;
begin
  select string_agg(c.table_name, ', ')
    into missing
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.column_name  = 'user_id'
     and coalesce(c.column_default, '') <> 'auth.uid()';
  assert missing is null,
         format('user-owned tables without a user_id default: %s', missing);
end $$;

-- Undo this section's rows so the counts below still mean what they say.
delete from public.conversations where title = 'no owner named';
delete from public.progress_logs where lift = 'bench';

-- --- consent gates lifestyle data, not only the original health column -------
--
-- Migration 0012 added sleep, alcohol, nicotine and nutrition notes. All four
-- are consumer health data under MHMDA, so all four must sit behind the same
-- gate. Adding a health column and forgetting to list it in the fingerprint
-- would collect health data with no consent check at all, and nothing else in
-- the system would notice.
--
-- UUIDs are written out rather than using :A because psql does not interpolate
-- variables inside a dollar-quoted body.
do $$
begin
  -- A has recorded no consent at this point in the test.
  begin
    update public.user_profile set alcohol_units_per_week = 20
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'alcohol was stored with no health_data_collection consent';
  exception when check_violation then null;
  end;

  begin
    update public.user_profile set sleep_hours_typical = 5
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'sleep was stored with no health_data_collection consent';
  exception when check_violation then null;
  end;

  begin
    update public.user_profile set nicotine_use = 'daily'
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'nicotine use was stored with no health_data_collection consent';
  exception when check_violation then null;
  end;

  begin
    update public.user_profile set nutrition_notes = 'cutting hard'
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'nutrition notes were stored with no health_data_collection consent';
  exception when check_violation then null;
  end;

  -- A gate that blocks unrelated updates is a bug, not extra safety.
  update public.user_profile set bodyweight = 185
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  assert (select bodyweight from public.user_profile) = 185,
         'a non-health field must stay writable without health consent';
end $$;

-- With consent on file, the same writes succeed.
insert into public.consent_records (consent_type, granted, policy_version)
  values ('health_data_collection', true, 'chd-2026-08-24');

do $$
begin
  update public.user_profile
     set alcohol_units_per_week = 20, sleep_hours_typical = 6, nicotine_use = 'none'
   where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  assert (select alcohol_units_per_week from public.user_profile) = 20,
         'consented lifestyle data must actually be stored';
end $$;

-- Put A back as B's section expects to find them.
do $$
begin
  update public.user_profile
     set alcohol_units_per_week = null, sleep_hours_typical = null, nicotine_use = null
   where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
end $$;

-- --- become athlete B: confirm nothing A did touched them ---------------------
select set_config('request.jwt.claims',
  json_build_object('sub', :B, 'role', 'authenticated')::text, true);

do $$
begin
  assert (select health_restrictions from public.user_profile) = 'B: lumbar disc herniation',
         'B profile must be unchanged by A''s attacks';
  assert (select count(*) from public.conversations) = 1,
         'B conversation must survive A''s unqualified DELETE';
  assert (select count(*) from public.progress_logs) = 1,
         'B progress logs must survive A''s DELETE';
end $$;

-- --- the unauthenticated role ------------------------------------------------
-- anon holds no table grants at all, so it is refused before RLS is consulted.
set local role anon;
do $$
begin
  begin
    perform count(*) from public.user_profile;
    raise exception 'anon was able to read user_profile';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- --- structural: every documented health column is actually gated -------------
--
-- Run as the migration role, because reading a function definition out of the
-- `private` schema needs privileges the `authenticated` role deliberately does
-- not have.
--
-- The column comments are the schema's own statement about what counts as
-- health data. This asserts the trigger's fingerprint agrees with them, so a
-- column added later cannot be documented as health data and silently left
-- ungated.
do $$
declare ungated text;
begin
  select string_agg(c.column_name, ', ')
    into ungated
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'user_profile'
     and col_description('public.user_profile'::regclass, c.ordinal_position) like 'Health data.%'
     and position(c.column_name in pg_get_functiondef(
           'private.health_fingerprint(public.user_profile)'::regprocedure)) = 0;

  assert ungated is null,
         format('columns documented as health data but not gated by the consent trigger: %s', ungated);
end $$;

rollback;

\echo 'PASS - RLS isolation test: all assertions held.'

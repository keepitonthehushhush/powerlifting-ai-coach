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
rollback;

\echo 'PASS - RLS isolation test: all assertions held.'

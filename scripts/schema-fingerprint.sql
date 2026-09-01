-- =============================================================================
-- One hash for a whole schema, so two databases can be compared by eye.
--
-- ── WHY ───────────────────────────────────────────────────────────────────
--
-- The migration files are supposed to describe the database. Whether they do
-- is a question nobody had asked until a second Supabase project existed to
-- build from them - and the answer, the first time, was "almost". One function
-- had been moved into another schema by hand, outside the files, and account
-- deletion had been broken in production ever since. Nothing in the repository
-- could have found it, because the repository was right.
--
-- ── HOW TO USE IT ─────────────────────────────────────────────────────────
--
-- Paste this into the SQL editor of BOTH projects and compare the two hashes.
-- Equal means the live schema is exactly what these files build. Unequal means
-- drift, and the per-object query at the bottom names what drifted.
--
-- Run it after any change to supabase/migrations/, and after anything applied
-- through a dashboard - which is where drift comes from.
--
-- ── WHY COMMENTS ARE STRIPPED ─────────────────────────────────────────────
--
-- pg_get_functiondef returns the body as stored, comments included, and three
-- functions in production are missing theirs: they were applied through a path
-- that dropped them. Behaviorally identical, textually different. A drift
-- check that reports those three every time is a drift check somebody stops
-- reading, so the comparison is on the logic. The cost is stated plainly: this
-- cannot see a change made only inside a comment.
--
-- ── AND WHY WHITESPACE IS SQUEEZED AGAINST PUNCTUATION ────────────────────
--
-- Stripping the comments was not enough, which nobody knew because this had
-- never actually been run against both projects. On 2026-09-01 it was, and it
-- reported private.recordable_auth_codes as drifted between them. The two
-- definitions were the same array of the same six strings.
--
-- What differed was the hole the comments left. Production writes one element
-- per line with a trailing comment; strip the comments, collapse \s+ to a
-- single space, and you still have `array[ 'a', 'b' ]`. Preview's copy had
-- arrived through a path that dropped the comments already, and reads
-- `array['a','b']`. Same tokens, different spaces, different hash.
--
-- So a false positive on the one object a reader would have to chase by hand -
-- in the tool whose entire value is that a reader does not have to. Whitespace
-- next to , [ ] ( ) is removed as well, which makes the comparison about the
-- tokens rather than about how somebody laid them out. With that in, the two
-- databases hashed identically for the first time.
-- =============================================================================

with norm as (
  select oid,
         regexp_replace(
           lower(regexp_replace(
             regexp_replace(
               regexp_replace(pg_get_functiondef(oid), '/\*.*?\*/', '', 'gs'),  -- block comments
               '--[^\n]*', '', 'g'),                                            -- line comments
             '\s+', ' ', 'g')),                                                 -- and layout
           '\s*([,\[\]\(\)])\s*', '\1', 'g') as d                            -- and the gaps comments left
    from pg_proc
),
objects as (
  select 'C ' || table_name || '.' || column_name || '|' || data_type || '|' || is_nullable
         || '|' || coalesce(column_default, '-') as sig
    from information_schema.columns where table_schema = 'public'

  union all
  select 'P ' || tablename || '|' || policyname || '|' || cmd
         || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-')
    from pg_policies where schemaname = 'public'

  -- Only the roles the browser can hold. postgres and service_role differ
  -- between projects for reasons that are not drift.
  union all
  select 'G ' || table_name || '|' || grantee || '|' || privilege_type
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('authenticated', 'anon')

  union all
  select 'K ' || cl.relname || '|' || co.conname || '|' || pg_get_constraintdef(co.oid)
    from pg_constraint co
    join pg_class cl on cl.oid = co.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
   where n.nspname = 'public'

  union all
  select 'I ' || indexdef from pg_indexes where schemaname = 'public'

  -- prosecdef and proconfig explicitly: `create or replace function` silently
  -- drops both, and that has cost this project a day of unlimited rate
  -- limiting and two days of an ungated consent trigger.
  union all
  select 'F ' || n.nspname || '.' || p.proname || '|' || p.prosecdef
         || '|' || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || md5(norm.d)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join norm on norm.oid = p.oid
   where n.nspname in ('public', 'private') and p.prokind = 'f'

  union all
  select 'T ' || c.relname || '|' || pg_get_triggerdef(t.oid)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
)
select md5(string_agg(sig, E'\n' order by sig)) as schema_hash, count(*) as objects
  from objects;

-- If the hashes differ, run this on both and diff the two result sets. Each row
-- is one object; the row that appears on one side and not the other is the
-- drift.
--
--   with norm as (...same as above...), objects as (...same as above...)
--   select sig from objects order by sig;

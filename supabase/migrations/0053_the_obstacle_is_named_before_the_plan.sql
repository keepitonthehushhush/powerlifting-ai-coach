-- =============================================================================
-- 0053_the_obstacle_is_named_before_the_plan.sql
--
-- Two columns for the one thing on the roadmap that only works because there is
-- a language model behind it.
--
-- ── WHY THIS IS NOT MOTIVATIONAL DECORATION ─────────────────────────────────
--
-- There is a substantial literature showing that fantasising about an idealised
-- future REDUCES the energy to pursue it: positive thinking fools the mind into
-- perceiving the goal as already attained. So an app that shows somebody a
-- glossy picture of the total they want is not neutral - it is working against
-- them. That finding is the reason this product will not be shipping an
-- inspirational arena illustration.
--
-- What works instead is mental contrasting with implementation intentions:
-- name the wish, name the best thing about reaching it, name the OBSTACLE
-- INSIDE YOURSELF that gets in the way, and form an if-then plan against that
-- specific obstacle. Meta-analysis across 21 studies and 15,907 participants
-- gives g = 0.336; g = 0.379 in health contexts; g = 0.48 in a physical-activity
-- trial. It is a bigger effect than most things this codebase does.
--
-- The first two steps are conversation and are not stored. The last two are
-- what has to survive the conversation, because their whole value is being
-- quoted back at the moment the obstacle actually shows up.
--
-- ── WHY THIS IS HEALTH DATA, AND NOT A CLOSE CALL ───────────────────────────
--
-- "What gets in the way" is a free-text box, and the honest answers people give
-- to it are things like "my back seizes up on squat day", "I drink on Fridays
-- and write off Saturday", "the meds make me too tired to train". Asking
-- somebody to name their own obstacle is asking a question whose good answers
-- are frequently medical.
--
-- We could bound the field to stop that. We are not going to, because a
-- constrained obstacle is a useless one - the specificity IS the mechanism, and
-- a dropdown of six generic obstacles would have none of the evidence above
-- behind it. So the field stays free text and takes the full health-data
-- treatment: inside private.health_fingerprint(), cleared on withdrawal,
-- redacted from every log line, expired on its own clock, disclosed by name on
-- the policy pages, and carried in the data export.
--
-- The consequence is accepted deliberately: an athlete who declines health-data
-- consent cannot use this feature. That is the correct trade. It is not
-- required to use the product, and the alternative - collecting free text that
-- will contain medical information without asking - is not a trade at all.
-- =============================================================================

alter table public.user_profile
  add column if not exists training_obstacle text,
  add column if not exists training_if_then text,
  add column if not exists training_intention_updated_at timestamptz;

comment on column public.user_profile.training_obstacle is
  'HEALTH DATA. The obstacle the athlete named as the thing that actually stops them, in their own words. Free text on purpose: the specificity is the mechanism, and a dropdown of generic obstacles would carry none of the evidence behind mental contrasting. Frequently medical in practice, which is why it is inside private.health_fingerprint().';

comment on column public.user_profile.training_if_then is
  'HEALTH DATA. The implementation intention formed against training_obstacle, in the form "if X, then I will Y". Stored because its entire value is being quoted back at the moment the obstacle shows up, which is after the conversation that produced it has scrolled away. Health data because it names the obstacle it answers.';

comment on column public.user_profile.training_intention_updated_at is
  'When either intention column last CHANGED. Its own clock rather than user_profile.updated_at, for the reason 0031 gives: a timestamp that moves on any edit resets the retention clock every time somebody changes their bodyweight.';

-- ── The clock ───────────────────────────────────────────────────────────────
--
-- Same shape as private.stamp_health_restrictions() from 0031, and separate
-- from it deliberately: an athlete who updates their injury note has not
-- renewed their if-then plan, and one clock covering both would silently keep
-- whichever was stale alive on the strength of the other being fresh.
create or replace function private.stamp_training_intention()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.training_obstacle is not null or new.training_if_then is not null then
      new.training_intention_updated_at := now();
    end if;
  elsif new.training_obstacle is distinct from old.training_obstacle
     or new.training_if_then is distinct from old.training_if_then then
    -- Null when both are cleared, so an erasure does not leave a timestamp
    -- behind saying an intention once existed. Same reasoning as 0031: a
    -- column recording that somebody once named a health obstacle is itself
    -- an inference about health.
    new.training_intention_updated_at :=
      case
        when new.training_obstacle is null and new.training_if_then is null then null
        else now()
      end;
  end if;
  return new;
end;
$fn$;

revoke all on function private.stamp_training_intention() from anon, authenticated, public;

drop trigger if exists stamp_training_intention on public.user_profile;
create trigger stamp_training_intention
  before insert or update on public.user_profile
  for each row execute function private.stamp_training_intention();

-- ── The fingerprint ─────────────────────────────────────────────────────────
--
-- Restated in full rather than patched, because this function is the single
-- definition of "what counts as health data" and a reader needs to see the
-- whole list. Every entry below is unchanged from 0035 except the two new ones.
create or replace function private.health_fingerprint(p public.user_profile)
returns text
language sql
immutable
set search_path to ''
as $$
  select nullif(concat_ws('|',
    nullif(btrim(coalesce(p.health_restrictions, '')), ''),
    nullif(btrim(coalesce(p.nutrition_notes, '')), ''),
    p.sleep_hours_typical::text,
    p.alcohol_units_per_week::text,
    nullif(p.nicotine_use, ''),
    nullif(p.gender, ''),
    nullif(btrim(coalesce(p.gender_self_described, '')), ''),
    -- Declining to answer is not a disclosure. See 0033.
    nullif(p.glp1_status, 'declined_to_say'),
    nullif(btrim(coalesce(p.training_obstacle, '')), ''),
    nullif(btrim(coalesce(p.training_if_then, '')), '')
  ), '');
$$;

-- ── Retention ───────────────────────────────────────────────────────────────
--
-- Twelve months, matching health_restrictions. An if-then plan against an
-- obstacle from two years ago is not a plan, it is a reminder of somebody the
-- athlete no longer is - and it is health data sitting in a table for no
-- current purpose, which is what a retention period exists to stop.
insert into public.retention_periods (category, months, note) values
  ('training_intention', 12,
   'The named obstacle and the if-then plan formed against it are cleared 12 months after they were last changed, so the coach asks again rather than quoting something the athlete has outgrown.')
on conflict (category) do update
  set months = excluded.months, note = excluded.note;

-- The sweep itself lives inside private.apply_retention(), where every other
-- retention rule lives, rather than in a function of its own. One scheduled
-- call, one transaction, one place to read what is expired and when. A separate
-- expire_training_intention() was written first and thrown away: it would have
-- needed its own schedule entry, and a retention rule that is not on the
-- schedule is a retention rule that does not run.
--
-- Restated in full because `create or replace` requires the whole body. Only
-- the m_intent declaration and the block after the GLP-1 sweep are new.
create or replace function private.apply_retention()
returns table (category text, affected bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  m_health int := (select rp.months from public.retention_periods rp where rp.category = 'health_restrictions');
  m_glp1   int := (select rp.months from public.retention_periods rp where rp.category = 'glp1_status');
  m_msgs   int := (select rp.months from public.retention_periods rp where rp.category = 'conversation_messages');
  m_audit  int := (select rp.months from public.retention_periods rp where rp.category = 'audit_events');
  m_usage  int := (select rp.months from public.retention_periods rp where rp.category = 'usage_events');
  m_stripe int := (select rp.months from public.retention_periods rp where rp.category = 'stripe_events');
  m_errors int := (select rp.months from public.retention_periods rp where rp.category = 'error_events');
  m_intent int := (select rp.months from public.retention_periods rp where rp.category = 'training_intention');
  n bigint;
begin
  update public.user_profile
     set health_restrictions = null,
         health_restrictions_updated_at = null,
         -- Not null: the column forbids it, and "has not answered yet" is false.
         cleared_to_train = false
   where health_restrictions is not null
     and health_restrictions_updated_at < now() - make_interval(months => m_health);
  get diagnostics n = row_count;
  category := 'health_restrictions'; affected := n; return next;

  update public.user_profile
     set glp1_status = null,
         glp1_status_updated_at = null
   where glp1_status is not null
     and glp1_status_updated_at < now() - make_interval(months => m_glp1);
  get diagnostics n = row_count;
  category := 'glp1_status'; affected := n; return next;

  -- Added by 0053. Both columns and their shared timestamp go together: a
  -- plan without the obstacle it answers is a sentence with the subject
  -- removed, and a timestamp left behind would record that somebody once
  -- named a health obstacle, which is itself an inference about health.
  update public.user_profile
     set training_obstacle = null,
         training_if_then = null,
         training_intention_updated_at = null
   where training_intention_updated_at is not null
     and training_intention_updated_at < now() - make_interval(months => m_intent);
  get diagnostics n = row_count;
  category := 'training_intention'; affected := n; return next;

  with trimmed as (
    select c.id,
           coalesce(jsonb_agg(msg order by ord), '[]'::jsonb) as kept,
           jsonb_array_length(c.messages) as before_count
      from public.conversations c
      cross join lateral jsonb_array_elements(c.messages) with ordinality as t(msg, ord)
     where jsonb_array_length(c.messages) > 0
       and (
             (msg ? 'at' and (msg->>'at')::timestamptz >= now() - make_interval(months => m_msgs))
          or (not (msg ? 'at') and c.created_at >= now() - make_interval(months => m_msgs))
           )
     group by c.id, c.messages
  )
  update public.conversations c
     set messages = t.kept
    from trimmed t
   where c.id = t.id
     and jsonb_array_length(t.kept) < t.before_count;
  get diagnostics n = row_count;
  category := 'conversation_messages'; affected := n; return next;

  delete from public.audit_events ae where ae.created_at < now() - make_interval(months => m_audit);
  get diagnostics n = row_count;
  category := 'audit_events'; affected := n; return next;

  delete from public.usage_events ue where ue.created_at < now() - make_interval(months => m_usage);
  get diagnostics n = row_count;
  category := 'usage_events'; affected := n; return next;

  delete from public.stripe_events se where se.received_at < now() - make_interval(months => m_stripe);
  get diagnostics n = row_count;
  category := 'stripe_events'; affected := n; return next;

  delete from public.error_events ee where ee.created_at < now() - make_interval(months => m_errors);
  get diagnostics n = row_count;
  category := 'error_events'; affected := n; return next;
end;
$fn$;

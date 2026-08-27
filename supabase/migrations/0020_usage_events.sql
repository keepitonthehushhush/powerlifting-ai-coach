-- What each coaching reply cost, so pricing can come from a number.
--
-- ── WHY A TABLE AND NOT A LOG LINE ────────────────────────────────────────
--
-- chat.completed already logs input and output token counts, which is enough
-- to debug one request and useless for the question that actually matters:
-- what does an active athlete cost per month. Answering that needs the numbers
-- to still be there in thirty days, and log retention on the hosting free tier
-- is measured in hours. So they go in the database, where they can be summed.
--
-- ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
--
-- Not analytics, and deliberately not shaped like it. There is no page view
-- here, no session, no funnel, no event name. One row per model call, with the
-- token counts the API itself returned and what they cost. Anything beyond
-- that is a different feature with a different consent story, and on a product
-- holding health data the temptation to quietly widen a table like this is
-- exactly the thing to write down and refuse in advance.
--
-- No message content, no prompt, no reply, not a single field that could carry
-- one. The row says how much was spent, never on what.
--
-- ── COST IS AN INTEGER ────────────────────────────────────────────────────
--
-- Microdollars - millionths of a dollar - as a bigint. A reply costs a
-- fraction of a cent, and summing thousands of floating point values to answer
-- a monthly cost question accumulates error precisely in the digits being
-- asked about. Postgres sums bigints exactly.
--
-- Nullable on purpose. An unpriced model records its tokens with a null cost
-- rather than a zero, so a stale price table shows up as "unknown" in a
-- rollup instead of silently understating the bill.
--
-- ── THE HONEST LIMITATION ─────────────────────────────────────────────────
--
-- This is written through the caller's own RLS-scoped connection, because this
-- project deliberately holds no service role key - the whole security model is
-- that the server can only ever do what the signed-in user could do. The
-- consequence is that a determined user could insert junk rows attributing
-- costs to themselves that never happened.
--
-- That is accepted rather than overlooked. The stakes are a skewed internal
-- cost estimate, not a data breach or another user's information, and the
-- alternative - introducing a service role key to protect a metrics table -
-- would trade a real security property for a reporting one. The CHECK
-- constraints below stop the obvious nonsense; the rest is a known limit and
-- is documented in docs/SECURITY.md rather than left for someone to discover.

create table public.usage_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,

  model           text not null,

  input_tokens        integer not null default 0 check (input_tokens >= 0),
  output_tokens       integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens   integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens  integer not null default 0 check (cache_write_tokens >= 0),

  -- Null means "this model was not in the price table", not "it was free".
  cost_microdollars bigint check (cost_microdollars is null or cost_microdollars >= 0),

  created_at timestamptz not null default now()
);

comment on table public.usage_events is
  'One row per model call: tokens and cost only. Contains no message content and must never be extended to. Exists to answer what an active athlete costs per month, which is the input to every pricing decision.';

comment on column public.usage_events.cost_microdollars is
  'Millionths of a US dollar, as an exact integer. Null when the model was absent from the price table - an unpriced call must read as unknown, never as free.';

-- The rollup query is always "this user, over this period", so the index
-- matches it rather than being a reflex index on user_id alone.
create index usage_events_user_created_idx
  on public.usage_events (user_id, created_at desc);

alter table public.usage_events enable row level security;

-- Same shape as every other table here: you reach your own rows and nobody
-- else's. A user seeing their own token counts is harmless and arguably owed
-- to them; a user seeing anybody else's is the thing this whole schema exists
-- to prevent.
create policy "usage: owner can read own"
  on public.usage_events for select to authenticated
  using (user_id = (select auth.uid()));

create policy "usage: owner can insert own"
  on public.usage_events for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Deliberately no update and no delete policy. A cost record that can be
-- edited after the fact is not a cost record. Deletion happens through the
-- user_id foreign key when an account is erased, which is what the account
-- deletion path already relies on for every other table.

-- =============================================================================
-- 0025 — subscription state, mirrored from Stripe
--
-- ── STRIPE IS THE SOURCE OF TRUTH, THIS IS A CACHE ───────────────────────────
--
-- Every row here is a copy of something Stripe already knows, written by the
-- webhook handler and read on every request that needs to know whether
-- somebody has paid. It exists because asking Stripe on every request would
-- put a third-party API call in front of the product's main feature, and
-- because Stripe being briefly unreachable must not log everybody out of the
-- thing they are paying for.
--
-- The consequence of it being a cache: NOTHING IN THE APPLICATION MAY WRITE
-- HERE except the webhook handler. A subscription that says active because our
-- own code set it, rather than because Stripe said so, is a subscription
-- somebody is not paying for. Hence no client-writable grants below.
--
-- ── WHY status IS TEXT AND NOT AN ENUM ───────────────────────────────────────
--
-- Stripe's subscription lifecycle has seven statuses today - incomplete,
-- incomplete_expired, trialing, active, past_due, canceled, unpaid - and it is
-- their vocabulary, not ours. A Postgres enum would turn Stripe adding an
-- eighth into a failed webhook and a user silently stuck on stale state. Text
-- with a comment naming the known values takes the new one and lets the
-- entitlement rule, which is in code and tested, decide what it means.
--
-- ── AND WHY THE PRODUCT ID IS STORED ─────────────────────────────────────────
--
-- Stripe's own guidance: check the PRODUCT rather than the price when granting
-- access, because it leaves room to change pricing or billing period without
-- touching the entitlement logic. Storing the price too, for support questions
-- that start "what am I actually paying".
-- =============================================================================

create table public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,

  -- Stripe's identifiers. The customer is created once and reused; a person
  -- who cancels and resubscribes keeps the same customer and gets a new
  -- subscription, which is why these are separate columns.
  stripe_customer_id     text not null unique,
  stripe_subscription_id text unique,

  stripe_product_id      text,
  stripe_price_id        text,

  -- Stripe's vocabulary, deliberately not constrained. See the note above.
  status                 text,

  -- When the paid-for period ends. Someone who cancels keeps access until
  -- this passes, which is what the FAQ promises, so it is not decoration.
  current_period_end     timestamptz,

  -- True between "they pressed cancel" and "the period actually ended". The
  -- UI needs to distinguish that from a live subscription, or somebody who
  -- has cancelled sees no acknowledgement and cancels again.
  cancel_at_period_end   boolean not null default false,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.subscriptions is
  'Mirror of Stripe subscription state, written ONLY by the webhook handler. Stripe is the source of truth; this exists so a request does not have to call Stripe, and so Stripe being unreachable does not lock paying users out.';
comment on column public.subscriptions.status is
  'Stripe subscription status verbatim: incomplete | incomplete_expired | trialing | active | past_due | canceled | unpaid. Deliberately unconstrained - Stripe owns this vocabulary and a new value must not break the webhook.';
comment on column public.subscriptions.current_period_end is
  'End of the paid-for period. Access continues to this point after cancellation, which is a promise made on the FAQ.';

create index subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

alter table public.subscriptions enable row level security;

-- Readable by the owner, and by nobody else. A person is entitled to see what
-- they are paying for.
grant select on public.subscriptions to authenticated;

create policy "subscriptions: owner can read own"
  on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- NO insert, update or delete policy, and no grants for them. The webhook
-- handler writes with the service role, which bypasses RLS. This is the whole
-- integrity property: a client that could write here could grant itself a
-- subscription, and no amount of care in the application would matter.

-- ── THE WEBHOOK LEDGER ───────────────────────────────────────────────────────
--
-- Stripe delivers at least once, not exactly once, and will retry for days on
-- a non-2xx. A retried event must not be processed twice, and the honest way
-- to guarantee that is a uniqueness constraint rather than a code path that
-- remembers.
create table public.stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);

comment on table public.stripe_events is
  'Processed Stripe event ids, for idempotency. Stripe guarantees at-least-once delivery and retries for days, so the primary key is what makes replay safe.';

alter table public.stripe_events enable row level security;
-- No grants and no policies at all: this is the webhook handler's private
-- bookkeeping and no client has any business reading it.

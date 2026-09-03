# Coach — AI Powerlifting Programming

An AI strength coach that takes beginners and develops them, over time, into
competent, injury-free competitive lifters. Users complete an intake, receive a
personalised program, log what they actually lift, and the coach adjusts the
next block based on real reported performance rather than a static template.

> **Coach is not a medical professional.** Users who report an injury, pain, or
> a medical condition are told to get clearance from a doctor or physical
> therapist, and the system will not write them a program until they confirm it.
> That gate is enforced in code, not left to the model's judgment.

**Status:** Deployed and running at
[coachdiaz.app](https://coachdiaz.app).

Phase 1 (signup → consent → intake → coaching conversation) and **Phase 2**
(session logging UI, automatic progression, progress charts, exercise library)
are both complete. Since Phase 2 closed, the work has been about making the
product defensible rather than larger: computed warm-up ramps, a researched
nutrition boundary, an accessibility and contrast pass validated by
measurement, breached-password checking, password recovery, a clinician-facing
page, per-conversation cost instrumentation, prompt caching, and an adversarial
safety suite that now runs three times per CI job because one run turned out
not to be a proof.

Programs are now stored records rather than chat messages — the coach emits a
machine-readable copy alongside its prose, which is what makes `/program`
printable and what will let logged sessions be measured against the plan.

Phase 3 (payments) has not been started.

[`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) is the honest version: what was built,
what broke, how each fault was diagnosed, and what is still outstanding. It
includes the bugs that reached production and why the tests in place at the
time could not have caught them.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Security](#security)
- [Running it locally](#running-it-locally)
- [Testing](#testing)
- [Deployment](#deployment)
- [Project layout](#project-layout)
- [Documentation](#documentation)

---

## What it does

1. **Intake.** Experience, current squat/bench/deadlift, bodyweight, units,
   equipment, schedule, goal, and any injuries or medical conditions.
2. **Programming.** Novice linear progression, intermediate periodisation, or a
   peaking cycle toward a competition date — selected from the athlete's actual
   state, not chosen by them.
3. **Logging.** Sessions are recorded as performed: sets, reps, load, RPE, and
   whether the work was completed.
4. **Adjustment.** The next block is written from what was logged. The coach
   asks how the last session went before advancing load.
5. **Form guidance.** Verbal cues, instructions to film from the side or use a
   mirror, advice to have a partner watch injury-risk points, and a link to a
   third-party demonstration video. No video is hosted, reproduced *or
   embedded* — links point at the rights holder's own channel. The copyright
   argument would permit an official embed; the privacy one does not, on a
   product holding health data.
6. **A program you can hold.** The coach's program is stored as a record and
   rendered at `/program` as a table built to be printed. A phone in a chalky
   gym is a worse reference than paper.
7. **Fueling.** Published population ranges — protein, carbohydrate, fat, rate
   of weight loss — applied to bodyweight as arithmetic, each with its source.
   Never a calorie target, a meal plan, or a macro split prescribed as an
   intervention: that line is the one the profession draws between general
   nutrition information and medical nutrition therapy.
8. **Your actual gym.** Naming a commercial chain — Planet Fitness, Anytime,
   Gold's, LA Fitness, Crunch, Snap, a YMCA, a university gym — pre-fills the
   equipment answer so it can be corrected rather than written from scratch.
   These are starting points, never an equipment database: no chain publishes
   what an individual club holds. The one that changes programming is Planet
   Fitness, which has no Olympic barbell and no squat rack, and the coach is
   told to say so rather than quietly prescribing a squat to somebody with
   nowhere to rack a bar.
9. **Something to hand your doctor.** [`/about`](https://coachdiaz.app/about)
   explains to a clinician what this is, what it refuses to do, and how they
   can set restrictions through their patient. Public, printable, and held to
   the system prompt by tests so it cannot quietly stop being true.

---

## Architecture

```
Browser (React + Vite)
  │
  ├── Supabase Auth ───────────────► Supabase (GoTrue)      [auth only]
  │     issues a JWT
  │
  └── fetch /api/*  ──────────────► Express on Vercel Functions
        Authorization: Bearer JWT     │
                                      ├── verifies the JWT
                                      ├── builds a Supabase client that
                                      │   CARRIES THAT JWT  ──────────────► Postgres
                                      │                                     RLS enforced here
                                      ├── assembles the system prompt from
                                      │   live profile + recent history
                                      └── calls the Anthropic API ────────► api.anthropic.com
                                          (key never leaves the server)
```

**Three decisions define this system.** Full reasoning in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### 1. The backend authenticates *as the user*, not as an admin

The obvious way to give a Node backend database access is the Supabase service
role key, which bypasses RLS entirely. Isolation between users would then
depend on every query in the codebase, forever, remembering
`.eq('user_id', currentUser.id)`. One omission is a health-data breach that
returns rows and therefore passes tests.

Instead the backend uses the publishable key plus the caller's own JWT.
PostgREST runs each query as the `authenticated` role with `auth.uid()` bound
to that user, and the policies in migration `0002` filter rows inside Postgres.

The consequence: **a route here can run `select * from user_profile` with no
`WHERE` clause and get back exactly one row.** That is why `routes/chat.js`
contains no `user_id` filters — it does not need them, and could not be made
unsafe by removing them.

### 2. Safety gates are computed in code, not delegated to the model

If a profile records a health restriction and `cleared_to_train` is false, the
system prompt receives an explicit directive forbidding any program, including
a "modified" one offered as a workaround. Re-deriving a safety condition from
scattered profile fields on every turn is strictly less reliable than computing
it once, deterministically, and telling the model the answer.

The same applies to demonstration videos: the library is enumerated in the
prompt and named as the only permitted source, because a model asked to recall
a "reputable demo URL" will produce a plausible dead link.

### 3. The Express app knows nothing about its host

`server/src/app.js` exports a plain Express application with no `listen()` and
no platform code. `api/index.js` adapts it to Vercel's serverless runtime;
`server/dev.js` binds it to a port. Moving to a container on Railway or Fly is
an entrypoint change, not a rewrite — deploying on serverless was a hosting
decision and is reversible.

### 4. The coach has no tools, so structured output goes through text

Getting a machine-readable program out of the model is textbook tool use, and
tool use was rejected. *The coach can call nothing* is a property this product
has, with a test pinning it, and excessive agency is the failure mode where a
prompt injection stops being a rude reply and becomes an action. Today the
blast radius of a successful injection is that one athlete's coach says
something wrong to them.

So the coach appends a delimited block, the route parses and validates it, and
it is stripped before the athlete sees the reply. The model still only produces
text; we read some of it more carefully. Every field is bounded, unknown keys
are refused, and a malformed block is dropped without the athlete ever knowing
— bookkeeping must never cost somebody the coaching they already received.

### 5. Anything that matters is enforced twice

The clearance gate is computed in code *and* stated in the prompt. When the
coach emits a program, the route re-checks the gate before storing it, because
a stored program differs in kind from a bad sentence: it is a document the
athlete can open tomorrow and follow, long after the message around it has
scrolled away. There is deliberately no endpoint that accepts a program from
the browser — the guard that cannot be got wrong is the one that does not need
to exist.

### 6. The system prompt is two blocks, and only the first is cached

`COACH_ROLE` is a module constant assembled from no inputs; everything after it
varies per athlete and per request. The cache breakpoint sits between them,
which is the only placement that produces cache reads rather than a fresh write
every message. Measured: 4,065 tokens read from cache, 43% off a reply.

The consequence that matters here is that **the cached block contains no
athlete data by construction**. The entry is shared across every user — that is
what keeps it warm — which would be an uncomfortable thing to reason about if
it held anything personal.

---

## Security

Full detail in [`docs/SECURITY.md`](docs/SECURITY.md). In summary:

| Concern | How it is handled |
|---|---|
| Anthropic API key | Server-side only. Never a `VITE_` variable, so it is not in the browser build. `config.js` refuses to boot if a secret carries a browser-visible prefix, and `npm run verify:bundle` greps the actual compiled output before deploy. |
| Cross-user access | RLS on all seven tables, 21 per-command policies, every one scoped `to authenticated`. Verified by `supabase/tests/rls_isolation_test.sql` against 22 distinct attacks — run it with `npm run test:db`. |
| Health data | Injuries, medical conditions and lifestyle factors — sleep, alcohol, nicotine, notes on eating — are sensitive, and Washington's MHMDA treats all of them as consumer health data. Sent to the Anthropic API because that is the product; never written to application logs or error trackers. Redaction is centralized in `server/src/lib/logger.js` and keyed on field name, so it cannot be skipped by forgetting at a call site. Storing any of it requires an active MHMDA consent, enforced by a database trigger rather than by application code. |
| Two-step sign-in | Optional TOTP, free on Supabase. Turning it on is the athlete's choice; once on, it is enforced in three places and only the last one holds if the code is wrong: the browser renders a code screen (`ProtectedRoute`), the API refuses an `aal1` token from an account with a verified factor (`server/src/lib/assuranceLevel.js`), and a **restrictive** RLS policy on every table holding personal or health data requires `aal2` (migration `0050`). The policy is opt-in by design — it demands `aal2` only from accounts that have verified a factor, so applying it could not lock out anybody who had not enrolled. Losing an authenticator means losing access: Supabase requires an `aal2` session to unenroll and there are no built-in recovery codes, so the way back in is `scripts/mfa-recovery.mjs`, which needs the service-role key, refuses to act without `--confirm`, and writes an `audit_events` row with `actor = 'operator'`. |
| Browser crash reports | When the app crashes in someone's browser — or when a request never reaches the server, which is the failure people actually hit and which no crash listener can see, because a rejected fetch inside a `try/catch` is not an unhandled rejection — it reports the failure to `error_events`, and reports a coordinate rather than a description: the error's constructor name, the top stack frame as `bundle.js:line:column`, how deep the stack was, and which build. The error MESSAGE is deliberately never sent — a thrown message is whatever the throwing code interpolated, and this app holds `health_restrictions`. Paths are normalized before they are sent, so an id in a URL becomes `/_id`, and query strings are dropped entirely. This is enforced in three places and only the first is a promise: the browser builds four keys (`web/src/lib/crashReport.js`), the route refuses anything else by schema (`server/src/routes/clientErrors.js`), and the database refuses anything else by CHECK constraint, including a `topFrame` that is not a coordinate (migration `0048`). A modified client cannot put a sentence in the error table. The cost is that diagnosis needs a source map instead of a sentence, which is the trade this project makes every time. |
| Saying so accurately | The three consent documents are held to the code by `server/test/policyDisclosure.test.js`, not by proofreading: a profile column that reaches the model without a mapped disclosure fails the build and the failure names the column. Written after an audit found four places where the code had moved and a paragraph had not — see ADR-11. |
| Account deletion | `ON DELETE CASCADE` from `auth.users` throughout. Deleting an account purges every associated row — verified, not assumed. |
| The model as an attack surface | Mapped against the OWASP LLM Top 10 (2026) in [`docs/SECURITY.md`](docs/SECURITY.md) §4b. Athlete text is escaped before it enters the prompt's data region, the coach holds no tools, the context contains no secrets, and replies are rendered as text rather than markup. The organizing question is not whether the model can be fooled but what a fooled model can reach — which RLS bounds to the caller's own rows. |
| Unauthenticated access | The `anon` role holds no table grants and matches no policy — refused before RLS is even consulted. |
| When it breaks | `web/public/maintenance.html` is a standalone page with no imports, no build step and no external requests, so it survives a broken bundle, a failed deploy or a database refusing connections. It polls `/api/health` and says when the site is back. `ErrorBoundary.jsx` catches a render crash and links to it. Switching it on is one rewrite in `vercel.json` — see [`docs/RUNBOOK.md`](docs/RUNBOOK.md). |
| Copyright | No video is hosted, embedded or mirrored. `exercise_library.video_url` links out to the rights holder. |

---

## Running it locally

**Prerequisites:** Node 20+, a Supabase project, an Anthropic API key.

```bash
git clone <your-repo-url>
cd powerlifting-ai-coach
npm install

cp .env.example .env
# Fill in ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
# VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY

npm run dev        # API on :3001, web on :5173
```

Apply the migrations in `supabase/migrations/` in numeric order, either through
the Supabase SQL editor or with the Supabase CLI.

### Environment variables

| Variable | Scope | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | **server only** | Anthropic API credential |
| `ANTHROPIC_MODEL` | server | Model ID. Default `claude-sonnet-5` |
| `ANTHROPIC_MAX_TOKENS` | server | Response cap. Default 4096 |
| `SUPABASE_URL` | server | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | server | Publishable key — grants nothing without a user JWT |
| `CHAT_HISTORY_WINDOW` | server | Messages replayed per request. Default 30 |
| `VITE_SUPABASE_URL` | **public** | Compiled into the bundle |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | **public** | Compiled into the bundle |

Anything prefixed `VITE_` is public by definition. Nothing secret may carry
that prefix, and `config.js` will refuse to start if something does.

---

## Testing

```bash
npm run check
```

That runs, in order: the unit tests, the frontend-dependency guard, the
production build, and the bundle secret scan. Individually:

```bash
npm test
npm run verify:deps
npm run build
npm run verify:bundle
psql "$DATABASE_URL" -f supabase/tests/rls_isolation_test.sql
```

`npm test` takes no environment variables. That is the assertion: nothing under
test should need a credential in order to be constructed.

The unit tests deliberately cover the parts of coaching behavior that are
deterministic — the clearance gate, intake completeness, prompt fencing, the
video guard — because those are where a silent regression does real harm.

Model behavior itself is adversarial, non-deterministic, and tested
separately:

```bash
npm run safety:eval                                  # all scenarios, once
npm run safety:eval -- --repeat 3                    # what CI runs
npm run safety:eval -- --only "Active injury" --repeat 5
```

**A single green run is a sample, not a proof.** One scenario passed a run and
failed the next two with the product unchanged, and because the summary was a
boolean all three answers looked equally authoritative. The cause turned out to
be the system prompt contradicting itself — its "you may" list permitting
exactly what its "you may not" list forbade — which the suite had been catching
all along without being able to name. The summary now reports *n/3* per
scenario, lists each distinct failure reason with how many runs produced it,
and names anything that disagreed with itself.

CI (`.github/workflows/ci.yml`) runs the tests, builds the frontend, and fails
the job if the bundle scan finds a secret.
`.github/workflows/safety-eval.yml` runs the adversarial suite with
`--repeat 3` on prompt changes and weekly. A scenario that passes 2 of 3 fails
the build, deliberately: on these scenarios, *sometimes* is not a passing
grade.

---

## Deployment

Vercel serves the built frontend and the Express API as a serverless function
from one origin, so there is no CORS layer in production and one place to
configure secrets.

1. Import the repo into Vercel.
2. Set the environment variables above in project settings — `ANTHROPIC_API_KEY`
   as a plain (not preview-exposed) variable.
3. Deploy. `vercel.json` routes `/api/*` to the function and everything else to
   the SPA.

---

## Project layout

```
├── api/index.js              Vercel serverless entrypoint (adapter only)
├── server/
│   ├── dev.js                Local entrypoint
│   ├── src/
│   │   ├── app.js            Express app — no platform code
│   │   ├── config.js         Validated config + secret-leak guard
│   │   ├── lib/              Anthropic client, RLS-scoped Supabase client, redacting logger,
│   │   │                     and the pure engines: progression, warm-up, nutrition ranges,
│   │   │                     max plausibility, token pricing, program-block parsing
│   │   ├── middleware/       Auth, error handling
│   │   ├── prompts/          System prompt assembly + sanitising fence
│   │   └── routes/           chat, profile, sessions, program, library, consent, account
│   └── test/                 Unit tests (584, no credentials required)
├── web/                      React + Vite frontend
├── supabase/
│   ├── migrations/           0001–0023, applied in order
│   └── tests/                RLS isolation test
├── scripts/                  Secret scanners, safety eval, deploy tooling
└── docs/                     Architecture, security, deployment, legal, build log
```

---

## Documentation

- [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) — what was built, why, how it was
  verified, and what is outstanding
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — schema, request flow, and the
  reasoning behind each significant decision
- [`docs/SECURITY.md`](docs/SECURITY.md) — key handling, RLS model, health-data
  treatment
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — environment variables and the
  build-versus-runtime distinction that governs them, plus how a deployment is
  verified against what the public actually downloads
- [`docs/LEGAL_CONSIDERATIONS.md`](docs/LEGAL_CONSIDERATIONS.md) — health-data
  law, the wellness/medicine line, and what still needs an attorney

## Licence

Not yet chosen.

# Coach — AI Powerlifting Programming

An AI strength coach that takes beginners and develops them, over time, into
competent, injury-free competitive lifters. Users complete an intake, receive a
personalised program, log what they actually lift, and the coach adjusts the
next block based on real reported performance rather than a static template.

> **Coach is not a medical professional.** Users who report an injury, pain, or
> a medical condition are told to get clearance from a doctor or physical
> therapist, and the system will not write them a program until they confirm it.
> That gate is enforced in code, not left to the model's judgement.

**Status:** Phase 1 complete. Database, backend, frontend and safety gates
built; RLS isolation tested against the live database. Not yet deployed — see
[`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) for exactly what is verified and what
is outstanding.

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
   third-party demonstration video. No video is hosted or reproduced — links
   point at the rights holder's own channel.

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

---

## Security

Full detail in [`docs/SECURITY.md`](docs/SECURITY.md). In summary:

| Concern | How it is handled |
|---|---|
| Anthropic API key | Server-side only. Never a `VITE_` variable, so it is not in the browser build. `config.js` refuses to boot if a secret carries a browser-visible prefix, and `npm run verify:bundle` greps the actual compiled output before deploy. |
| Cross-user access | RLS on all six tables, 21 per-command policies, every one scoped `to authenticated`. Verified by `supabase/tests/rls_isolation_test.sql` against 11 distinct attacks. |
| Health data | Injuries and medical conditions are sensitive. Sent to the Anthropic API because that is the product; never written to application logs or error trackers. Redaction is centralised in `server/src/lib/logger.js` so it cannot be skipped by forgetting. |
| Account deletion | `ON DELETE CASCADE` from `auth.users` throughout. Deleting an account purges every associated row — verified, not assumed. |
| Prompt injection | User-controlled free text is fenced in `<user_data>` and labelled as data rather than instruction. |
| Unauthenticated access | The `anon` role holds no table grants and matches no policy — refused before RLS is even consulted. |
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

The unit tests deliberately cover the parts of coaching behaviour that are
deterministic — the clearance gate, intake completeness, prompt fencing, the
video guard — because those are where a silent regression does real harm.
Model behaviour itself is tested against the live API; see the build log.

CI (`.github/workflows/ci.yml`) runs the tests, builds the frontend, and fails
the job if the bundle scan finds a secret.

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
│   │   ├── lib/              Anthropic client, RLS-scoped Supabase client, redacting logger
│   │   ├── middleware/       Auth, error handling
│   │   ├── prompts/          System prompt assembly
│   │   └── routes/           chat, profile, sessions, library
│   └── test/                 Unit tests
├── web/                      React + Vite frontend
├── supabase/
│   ├── migrations/           0001–0010, applied in order
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

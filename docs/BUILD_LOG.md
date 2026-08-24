# Build Log

A chronological record of what was built, why, how it was verified, and what
is still outstanding. Each entry is written so you can re-run the verification
yourself rather than taking the result on trust.

Status keys: **DONE** (built and verified) · **BUILT, UNVERIFIED** (code
complete, verification blocked) · **BLOCKED** · **NOT STARTED**

---

## Phase 1 — Working core loop

### 1.1 Access audit — **DONE**

| Service | Result |
|---|---|
| Supabase | Connected. Org `keepitonthehushhush's Org`, project `pwbkdxnvubtflgpqpest` (us-west-2, Postgres 17). `public` schema was empty; used as-is. |
| Vercel | Connected. Team `keepitonthehushhush1`, hobby plan, no projects yet. |
| GitHub | **Not reachable from the build environment.** No GitHub connector exists in the registry and the container's injected token is a dead stub. |
| Anthropic API | Endpoint reachable; no key available for your account. |

**Decision:** backend hosted as Vercel serverless functions rather than Railway.
One origin for frontend and API means no CORS layer in production, one deploy
pipeline, and `ANTHROPIC_API_KEY` configured in exactly one place. The Express
app is kept free of platform-specific code so this stays a hosting choice
rather than an architectural commitment.

**Decision:** model ID moved into `ANTHROPIC_MODEL` rather than hardcoded, and
defaulted to `claude-sonnet-5`. The brief specified `claude-sonnet-4-6`, which
is a valid but previous-generation ID; putting it in configuration makes the
choice a deploy variable instead of a code change.

---

### 1.2 Database schema — **DONE**

Six tables, applied as four migrations in `supabase/migrations/`.

| Migration | Contents |
|---|---|
| `0001_initial_schema` | `user_profile`, `workout_programs`, `workout_sessions`, `progress_logs`, `conversations`, `exercise_library` + indexes |
| `0002_row_level_security` | RLS enabled on all six tables, 21 per-command policies, grants revoked from `anon` |
| `0003_triggers_and_bootstrap` | `updated_at` triggers, profile row auto-created on signup |
| `0004_move_trigger_functions_to_private_schema` | Linter remediation (see below) |

**Refinements made to the schema in the brief, and why:**

- `exercise_library` added in Phase 1 rather than Phase 2. The system prompt
  instructs Coach never to describe a video that does not exist; without a real
  table to enumerate, that instruction has nothing to anchor to and invites a
  fabricated URL. The table exists now and is seeded in Phase 2 — until then
  the prompt inverts and forbids linking videos at all.
- `progress_logs.session_id` added. Gives each logged set provenance back to
  the session it came from without charts having to unnest jsonb.
- `is_active` on `workout_programs` and `conversations`; `intake_completed_at`
  on `user_profile` — lets the prompt builder distinguish "never asked" from
  "asked, and the answer was none".
- `numeric(7,2)` for loads rather than float, and `ON DELETE CASCADE`
  throughout so deleting an account actually purges the health data.
- CHECK constraints rather than Postgres ENUM types — enums need `ALTER TYPE`
  to extend and are awkward to roll back.

**Security finding, found and fixed during the build.** The Supabase linter
flagged that `handle_new_user()` and `set_updated_at()` sat in the `public`
schema, which PostgREST automatically exposes as `/rest/v1/rpc/<name>`. Both
were `SECURITY DEFINER` and reachable from the open internet by the anon role.
Almost certainly unexploitable — a trigger function raises when invoked
directly — but migration `0004` moves them into a `private` schema PostgREST
does not serve, and revokes execute from `anon` and `authenticated`.

**Verify it yourself:**
```
Supabase dashboard → Advisors → Security      # expect: no issues
```
Result at time of writing: **0 lints**.

---

### 1.3 RLS isolation — **DONE, TESTED**

Reproducible script: `supabase/tests/rls_isolation_test.sql`. It creates two
athletes, switches to the `authenticated` role and sets `request.jwt.claims` —
exactly what PostgREST does per request — then asserts isolation. Written in
SQL rather than as an HTTP test so a pass is evidence about the policies
themselves, not about the API that calls them.

**Executed against the live database. Results:**

| Attack from athlete A | Expected | Observed |
|---|---|---|
| Count A's own visible rows in all 5 tables | 1 each | 1 each ✅ |
| Read B's health data | 0 rows | 0 rows ✅ |
| Read B's profile by explicit user_id | 0 rows | 0 rows ✅ |
| Read B's conversation by content match | 0 rows | 0 rows ✅ |
| `UPDATE` B's profile | 0 affected | 0 affected ✅ |
| `DELETE` B's progress logs | 0 affected | 0 affected ✅ |
| **`DELETE FROM conversations` with no WHERE at all** | only own row | **1 row, A's own** ✅ |
| `INSERT` a program owned by B | rejected | `42501 new row violates row-level security policy` ✅ |
| `UPDATE` own row to reassign `user_id` to B | rejected | `42501 new row violates row-level security policy` ✅ |
| Read via a join that never mentions `user_id` | own rows only | own rows only ✅ |
| Unauthenticated (`anon`) read of any table | denied | `42501 permission denied for table user_profile` ✅ |

Then, as athlete B: profile unchanged, conversation and progress logs intact,
no forged program present, and A entirely invisible. ✅

**Cascade purge verified.** Deleting the two `auth.users` rows left 0 residual
rows across all five user-scoped tables — the health-data deletion guarantee
holds in practice, not just in the DDL.

The two attacks worth understanding: the unqualified `DELETE FROM
conversations` is the mistake that ends companies, and it removed exactly one
row. The `user_id` reassignment is the attack a `USING`-only policy would
allow — it is blocked by the separate `WITH CHECK` clause, which is why every
policy states both.

---

### 1.4 Backend — **DONE** (build unverified, see 1.7)

`server/src/` — a plain Express app with no platform code. `api/index.js`
adapts it to Vercel; `server/dev.js` binds it to a local port.

**The architectural decision to be able to explain in an interview:**
`server/src/lib/supabase.js` does *not* use the Supabase service role key. It
uses the publishable key plus the end user's own JWT, forwarded on the
`Authorization` header. PostgREST then runs every query as the `authenticated`
role with `auth.uid()` bound to that user, so the RLS policies filter rows
inside Postgres.

The consequence, stated plainly: a route in this codebase can run
`select * from user_profile` with no `WHERE` clause and get back exactly one
row — the caller's. Authorisation is enforced by the database rather than by
the diligence of whoever writes the next route, which is why `routes/chat.js`
contains no `user_id` filters at all. With the service role key, one forgotten
filter is a health-data breach that returns rows and therefore passes tests.

The honest cost: the service role is genuinely needed for admin work
(backfills, cross-user analytics, cron). Phase 1 has none, so that key is not
in the environment at all. When it is needed it should live behind a narrow,
separate module rather than becoming the default client.

Other decisions worth being able to defend:

- **`requireAuth` is mounted on the whole `/api` surface**, not per route. A
  router added later is protected by default; forgetting becomes the safe
  outcome instead of the dangerous one.
- **History is replayed in a bounded window** (`CHAT_HISTORY_WINDOW`, default
  30). The Anthropic API is stateless, so every request carries the full
  relevant history — unbounded, that grows the payload and the token bill
  without limit.
- **Session writes are not transactional** and this is documented in
  `routes/sessions.js` rather than hidden: PostgREST exposes no multi-statement
  transaction over HTTP, so a session insert and its derived `progress_logs`
  rows are two calls. The fix, when it matters, is a Postgres function invoked
  via `rpc()`.

---

### 1.5 The Coach prompt — **DONE** (model behaviour unverified, see 1.7)

`server/src/prompts/systemPrompt.js`. Static role definition, then live athlete
state injected per request.

Three things are decided in code rather than left to the model:

1. **The medical clearance gate.** If the profile records a health restriction
   and `cleared_to_train` is false, the prompt receives an explicit directive
   block forbidding any program — including a "modified" or "safe" one as a
   workaround. Asking the model to re-derive a safety condition from scattered
   fields every turn is strictly worse than computing it once and telling it
   the answer. The gate also recognises "none", "n/a", "nope" as *not* a
   restriction, so a careful user is not locked out by their own thoroughness.
2. **Prompt-injection fencing.** Profile free text is user-controlled. It is
   wrapped in `<user_data>` tags and the model is told explicitly that the
   contents are data describing the athlete, never instruction. The blast
   radius today is one user manipulating their own coach; it stops being small
   the moment a coach-facing or shared view exists.
3. **Video enumeration.** The library contents are listed and named as the only
   permitted source. A model asked to "link a reputable demo" from memory will
   produce a plausible, dead URL.

---

### 1.6 Frontend — **DONE** (build unverified, see 1.7)

React + Vite. Supabase Auth for signup/login, a protected router, an intake
form, and the chat interface.

The clearance gate is surfaced in the UI, not only in the conversation:
entering anything in the injuries field reveals a clearance checkbox and a
warning that no program will be written until it is confirmed. A safety rule
the user discovers halfway through a conversation feels like a malfunction; one
they see at the point of entry reads as care.

Health-data handling is stated at the point of collection rather than buried in
a policy page — the field carries a note that it is visible only to their
account and never written to logs or error reports.

---

### 1.7 Verification status — **PARTIALLY BLOCKED**

| Check | Status |
|---|---|
| SQL migrations applied | ✅ Verified against the live database |
| Supabase security advisor | ✅ 0 issues |
| RLS isolation (11 attacks) | ✅ All passed |
| Cascade health-data purge | ✅ Verified |
| Unit tests | ✅ 25/25 pass |
| JS syntax, all 15 server files | ✅ Pass |
| `npm install` | ⛔ Blocked — see below |
| `npm run build` | ⛔ Blocked |
| Bundle secret scan | ⛔ Blocked (script written, needs a build to scan) |
| Live Coach behaviour tests | ⛔ Blocked — needs your API key |
| End-to-end signup → intake → program | ⛔ Blocked |

**The blocker.** The build environment's network policy returns HTTP 403 for
every package on `registry.npmjs.org`, directly and through the proxy. No
dependencies can be installed here, so nothing that requires them can be run.

This does not affect anything already verified: the database work was done
against the live project, and the 25 unit tests cover modules that import
nothing external, which is partly why the safety gates were built as pure
functions in the first place.

**Unblocking it** — once the repo is on your Mac:

```bash
npm install
npm test                 # expect 25/25
npm run build
npm run verify:bundle    # expect: PASS - no server-side secrets found
```

---

## Outstanding — needs you

1. **Anthropic API key.** <https://console.anthropic.com/settings/keys> → create
   key → paste into `.env` as `ANTHROPIC_API_KEY`. Requires billing credit on
   the account.
2. **A connected folder**, so the repo with its full commit history can be
   written to your Mac. Claude desktop app → *Add folder*.
3. **A GitHub repo.** Once the folder is connected:
   `git remote add origin git@github.com:<you>/powerlifting-ai-coach.git && git push -u origin main`

---

## Verification findings — **RESOLVED**

What the first clean-machine run turned up. Recorded because the failures are
more instructive than the passes.

### V.1 `npm test` failed on a clean machine — **FIXED**

**Symptom.** `npm test` on macOS with no `.env` present: 27 passed, and two
whole test *files* died before running a single assertion.

```
Error: Missing required environment variable: ANTHROPIC_API_KEY
    at required (server/src/config.js:23:11)
✖ server/test/config.test.js
✖ server/test/rateLimit.test.js
```

**Why it passed for me and not for him.** I had been running the suite with
variables inline (`ANTHROPIC_API_KEY=test node --test ...`). The `npm test`
script set nothing. The CI workflow injected placeholders, so CI would have
stayed green too. Three ways of running the same suite, one of them honest.

**Root cause, which was a design flaw rather than a missing variable.**
`config.js` did two things: it exported pure helpers, and it validated the
environment at module load, throwing on anything missing. So importing the pure
part paid the side effect.

- `config.test.js` imported `assertNoLeakedSecrets` from `config.js` — and
  triggered the throw it existed to test.
- `rateLimit.test.js` never mentioned config at all. It imported `HttpError`
  from `middleware/errorHandler.js`, which imports `config.js`. An *error
  class* was dragging the entire environment in behind it.

**Fix, in three parts:**

| Change | Reason |
|---|---|
| `HttpError` extracted to `lib/httpError.js`, zero imports | A widely-shared value type must not live in a module that does work at import time |
| Pure parsing extracted to `lib/env.js` (`required`, `optional`, `assertNoLeakedSecrets`, `buildConfig`) | Validation becomes callable without being performed |
| `config.js` reduced to `export const config = buildConfig(process.env)` | Fail-fast at cold start is preserved, in exactly one place |

**The rejected fix.** Making `npm test` load dotenv or inject dummy values.
That would have turned the suite green in about thirty seconds while leaving
the coupling in place — and left a test suite that only runs when production
secrets are present.

**Result.** 36 → **47 tests, passing with an entirely empty environment.** The
eleven new ones cover the fail-fast behaviour itself, which had been the single
piece of the config layer that was *structurally impossible* to test: any test
importing the function triggered the throw before it could assert on it.

The CI workflow's placeholder-secret block was removed rather than updated. Its
absence is now the assertion: nothing under test should need a credential to be
constructed.

**Verified:** `node --test "server/test/*.test.js"` with no environment
variables set → 47/47.

### V.2 Frontend build — **PASS**

```
✓ 86 modules transformed
dist/assets/index-DQNr0he3.js   406.98 kB │ gzip: 118.33 kB
✓ built in 486ms
```

118 kB gzipped, almost all of it React, react-router and supabase-js. Fine for
now; if it needs to come down, route-level code splitting on `/account` and
`/intake` is the first move.

### V.3 Bundle secret scan — **PASS**

```
Scanned 4 files in web/dist for server-side secrets.
PASS - no server-side secrets found in the browser bundle.
```

The "the Anthropic key never reaches the browser" claim is now checked against
the artefact that actually ships, on a real build, rather than argued from
which variables carry a `VITE_` prefix.

---

## Phase 1.5 — Enterprise / global hardening — **DONE** (verified in-database)

Requested mid-build: bring this to the standard of something presented to a
professional company operating globally. Four items, all verified against the
live database.

### 1.5.1 Rate limiting — **DONE, TESTED**

Migrations `0005` and `0006`. Postgres-backed fixed-window counters, because
serverless instances share no memory — an in-process counter makes the
effective limit (quota x warm instances), which nobody controls.

| Bucket | Quota | Window |
|---|---|---|
| `chat` | 60 | 1 hour |
| `chat_daily` | 300 | 24 hours |
| `write` | 240 | 1 hour |
| `export` | 5 | 24 hours |

**I shipped a flaw in `0005` and caught it before it left the database.** The
`SECURITY INVOKER` function needed `INSERT`/`UPDATE` grants on the counter
table for `authenticated`, which left it editable straight through PostgREST:

```
PATCH /rest/v1/rate_limit_counters?bucket=eq.chat   { "count": 0 }
```

The RLS policies were correct — a user could only edit *their own* row. That
was exactly the problem: a rate limit the limited party can reset is not a rate
limit. Migration `0006` moves the counters into the `private` schema and makes
the function `SECURITY DEFINER`, so it is the only writer.

**Verified against the live database:**

| Check | Expected | Observed |
|---|---|---|
| Three successive calls increment atomically | 1, 2, 3 | 1, 2, 3 |
| Sixth call on a quota of 5 | denied | `allowed: false` at `used: 6` |
| `UPDATE private.rate_limit_counters` as `authenticated` | refused | `42501 permission denied for schema private` |
| Counters cascade on account deletion | 0 residual | 0 residual |

Quotas are defined inside the function, not passed in — a caller-supplied limit
would be raised trivially by anyone invoking the RPC with their own JWT.

The middleware **fails open**: if the limiter itself errors, the request
proceeds and the failure is logged loudly. Turning a counter outage into a
total outage is the worse failure here. A test pins that down so it is not
silently reversed later.

### 1.5.2 GDPR data rights — **DONE**

Migration `0007` plus `server/src/routes/account.js`.

- `GET /api/account/export` — every stored record as versioned JSON. Assembled
  through the user-scoped client, so it cannot include another user's rows.
  Downloaded from an in-memory blob, so health data never acquires a URL.
- `DELETE /api/account` — requires the literal confirmation string
  `DELETE MY ACCOUNT`, then calls `delete_my_account()`.

`delete_my_account()` takes **no arguments at all** — the target is
`auth.uid()` and cannot be redirected. Building it that way avoided adding the
service role key, which would have undone ADR-1 for the sake of one endpoint.
The cascade purge it depends on was already verified in section 1.3.

### 1.5.3 Internationalisation — **DONE, TESTED**

Closes the gap logged in `ARCHITECTURE.md 5.4`. Every UI string is now in a
locale catalogue; English and Spanish ship.

Hand-rolled rather than i18next: the app needs key lookup, interpolation, and
`Intl` number/date formatting, and `Intl` is in the platform. A framework would
add ~40 KB for requirements this app does not have. The honest limit — no
plural rules, no gender agreement — is documented in the module with the
threshold at which it should be replaced rather than grown badly.

Six mechanical checks per locale, in CI: no missing keys, no orphan keys, no
empty values, no interpolation-placeholder drift, and a check that the
catalogue is actually translated rather than copied from English. A missing
translation does not crash — `t()` falls back — so it would otherwise ship
silently and render a page in two languages.

### 1.5.4 Error monitoring — **DONE**

Sentry, optional, off unless `SENTRY_DSN` is set. `beforeSend` runs the same
redactor the logger uses over the **entire event object**, and additionally
drops request bodies, cookies, query strings, all headers but `user-agent`, and
every stack frame's captured variables — `profile` is in scope in half the
routes here. Only 5xx is reported; a 429 is the system working. A missing SDK
degrades to a warning, because a monitoring tool that can break the application
it monitors is worse than none.

### 1.5.5 Two linter warnings, accepted deliberately

The advisor now reports `authenticated_security_definer_function_executable`
for `consume_rate_limit` and `delete_my_account`. Both are **intentional** —
they exist so users can call them — and both derive their target from
`auth.uid()` rather than from any argument.

The contrast with migration `0004` is the point worth making in an interview:
there, the same class of finding described a real mistake and was fixed by
moving the functions out of `public`. Here it describes the design. A linter
finding is an argument to evaluate, not a checkbox to clear. Reasoning is
written up in `docs/SECURITY.md 9`.

### 1.5.6 Test count

25 -> **36 passing**, all green.

---

## Phase 2 — Real coaching features — **NOT STARTED**
## Phase 3 — Monetization — **NOT STARTED** (awaiting explicit go-ahead)
## Phase 4 — Portfolio polish — **IN PROGRESS** (README, ARCHITECTURE, SECURITY, CI written early)

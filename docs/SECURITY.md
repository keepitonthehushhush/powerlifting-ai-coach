# Security

This application stores user-reported injuries and medical conditions. That
single fact drives most of what follows: a missing access-control policy here
is not a bug, it is a health-data breach.

Nothing in this document is aspirational. Where something is verified, the
verification is named; where something is a known gap, it is listed in
[Known gaps](#known-gaps) rather than omitted.

---

## 1. Secret handling

### The Anthropic API key

The key is server-side only and reaches the browser through no path.

- It is read exclusively by `server/src/lib/anthropic.js`, which nothing under
  `web/` imports or can import.
- It is not prefixed `VITE_`, so Vite never compiles it into the bundle. This
  is the mechanism that actually keeps it out — everything below is defence in
  depth against someone renaming it.
- `server/src/config.js` calls `assertNoLeakedSecrets()` at module load and
  **refuses to boot** if any `VITE_`-prefixed variable matches
  `ANTHROPIC|SERVICE_ROLE|SECRET|PRIVATE_KEY`. A natural mistake becomes a
  startup failure instead of a silent breach.
- `scripts/scan-bundle-for-secrets.mjs` greps the built output — minified
  JavaScript, CSS, HTML and sourcemaps — for key-shaped patterns *and* for the
  literal value in the environment. It exits non-zero on a finding.
- CI runs that scan after every build and fails the job on a hit, so a leak
  cannot reach a deploy through a merge.

Sourcemaps are deliberately emitted so the scanner can inspect them: a secret
can survive minification unrecognisably but sit in plain text in a `.map` file.

### No browser-to-Anthropic calls

The frontend has no Anthropic client and no code path to `api.anthropic.com`.
All model calls originate in `server/src/lib/anthropic.js`.

### The Supabase service role key is not used at all

It is absent from the environment. See §2 for why that is a design choice
rather than an oversight.

### Repository hygiene

`.gitignore` excluded `.env` in commit #1, before any application code existed,
so no credential has ever been in the history. `.env.example` documents the
public/secret split explicitly.

---

## 2. Access control

### The model

Every table in `public` has RLS enabled and 21 per-command policies scoped to
`auth.uid()`. Policies are written per command — `select`, `insert`, `update`,
`delete` — rather than as a single `for all`, so `USING` (which rows may be
read or targeted) and `WITH CHECK` (which rows may be written) are stated
separately and cannot be conflated. Every policy is scoped `to authenticated`;
the `anon` role matches none of them and additionally holds no table grants.

### Why the backend does not hold admin credentials

The backend authenticates to Postgres as the end user, by forwarding their JWT,
rather than as an admin with the service role key.

With the service role key, RLS is bypassed and user isolation depends on every
query in the codebase — present and future — carrying the right `user_id`
filter. A forgotten filter still returns rows, so it passes tests, ships, and
is discovered by a user seeing someone else's injury history.

With a user-scoped client, Postgres enforces isolation. `routes/chat.js`
contains no `user_id` filters anywhere and is nonetheless incapable of
returning another user's data.

The tradeoff is stated honestly: legitimate admin work — backfills, aggregate
analytics, scheduled jobs — will eventually need the service role. When it
does, it belongs behind a narrow, separately-audited module, not as the default
client.

### Verification

`supabase/tests/rls_isolation_test.sql` runs against the real database. It
switches to the `authenticated` role and sets `request.jwt.claims` — precisely
what PostgREST does per request — so a pass is evidence about the policies, not
about the API that calls them.

Executed against the live project, all of the following held:

| Attack | Result |
|---|---|
| Read another user's profile, programs, sessions, logs, conversations | 0 rows |
| Read another user's row by explicit `user_id` | 0 rows |
| Read another user's conversation by content match | 0 rows |
| Read through a join that never mentions `user_id` | own rows only |
| `UPDATE` another user's profile | 0 rows affected |
| `DELETE` another user's progress logs | 0 rows affected |
| `DELETE FROM conversations` with no `WHERE` clause | 1 row — the caller's own |
| `INSERT` a row owned by another user | `42501` RLS violation |
| `UPDATE` own row to reassign `user_id` to another user | `42501` RLS violation |
| Any read as the unauthenticated `anon` role | `42501` permission denied |

The last two are the ones worth understanding. The `user_id` reassignment is
the attack a `USING`-only policy permits, and is blocked by the separate
`WITH CHECK` clause. The unqualified `DELETE` is the catastrophic-mistake case:
RLS scoped it to one row instead of the whole table.

### Session verification

`requireAuth` verifies each token against the Supabase auth server rather than
validating the signature locally. Local verification is faster but cannot see
that a session was revoked; asking the auth server can. `requireAuth` is
mounted on the entire `/api` surface rather than per route, so a router added
later is authenticated by default.

---

## 2b. Account credentials

Passwords are hashed by Supabase Auth with bcrypt and a per-password salt. This
application never sees, stores, or transmits a password: sign-up and sign-in go
from the browser to Supabase directly, and the API server is not in that path.

### Where the rule is enforced, and where it is only shown

| Layer | What it does | Is it a control? |
|---|---|---|
| Supabase Auth project settings | Rejects a weak password on every request | **Yes** |
| `web/src/lib/passwordPolicy.js` | Shows the requirements as the person types | No |

This distinction is the whole of it. Sign-up is a direct call to Supabase using
the publishable key, which is public by design and printed in the browser
bundle. Anyone can call `/auth/v1/signup` without ever loading the form, so a
check that lives only in React is a courtesy, not a defence. It is worth having
for the same reason a good error message is worth having — it just must not be
mistaken for the thing doing the work.

The client rules mirror the server settings exactly, including the accepted
symbol set: a form that accepts a character the server rejects hands somebody a
password they believe is valid and cannot use. `server/test/passwordPolicy.test.js`
pins that correspondence.

### Required settings (Authentication → Providers → Email)

| Setting | Value | Why |
|---|---|---|
| Minimum password length | **12** | Length buys more resistance than character variety. Supabase's guidance is that under 8 is not worth having; 12 is the smallest value that still resists offline cracking of a bcrypt hash for any meaningful time. |
| Required characters | **Lowercase, uppercase, digits, symbols** | Not because variety is powerful on its own, but because without it a 12-character minimum becomes twelve lowercase letters. |
| Prevent use of leaked passwords | **On, when the plan allows it** | Checks against HaveIBeenPwned. A credential-stuffing list beats any composition rule: `Password1!` satisfies every requirement above and appears in every breach corpus. Pro plan and above. |

Existing accounts are unaffected by a change to these settings — a password
already set continues to work. Supabase reports it as a `WeakPasswordError` at
sign-in, which is the right moment to ask for a change and the wrong moment to
refuse entry.

### Not done yet

- **MFA.** Supabase Auth supports TOTP. For an application holding injury
  history it is the obvious next control, and it is a bigger change than a
  settings toggle — enrolment UI, a challenge step at sign-in, and recovery.
- **Leaked-password protection**, which requires a paid plan.

---

## 3. Health data

`user_profile.health_restrictions` holds user-reported injuries and medical
conditions.

**Where it goes:** to the Anthropic API, as part of the system prompt. That is
the product — a coach that programs around a shoulder injury has to know about
the shoulder.

**Where it does not go:**

- **Application logs.** All logging passes through
  `server/src/lib/logger.js`, which recursively redacts keys matching
  `health_restrictions`, `injury`, `medical`, `diagnosis`, `medication`,
  `condition`, plus credentials. The list matches on substrings, so
  `past_injuries` and `medicalHistory` are covered without anyone updating it.
- **Error trackers.** `errorHandler` routes everything it reports through the
  same redactor, and drops error stacks, which routinely embed the request body
  that failed.
- **Route handlers' log lines.** `chat.js` logs token counts and ids; message
  bodies are never logged. `profile.js` logs which fields changed, never their
  values.

Redaction is centralised rather than applied per call site, because a rule that
depends on every future contributor remembering which fields are sensitive
fails the first time someone is in a hurry. Here, leaking would require
bypassing the logger entirely.

**Deletion.** Every user-scoped table cascades from `auth.users`. Deleting an
account purges the profile, programs, sessions, progress logs and
conversations. Verified: after deleting two test accounts, all five tables held
0 residual rows.

**At the point of collection**, the intake form states plainly that the field is
visible only to the user's account and is never written to logs or error
reports.

---

## 4. Input handling

- **Prompt injection.** Profile free text is user-controlled and is injected
  into the system prompt. It is fenced in `<user_data>` tags, and the model is
  instructed that the contents describe the athlete and are never instruction
  to it. The blast radius today is one user steering their own coach; that
  changes the moment a shared or coach-facing view exists, which is why the
  mitigation is in place now.
- **Schema validation.** Every request body is validated with `zod` before it
  reaches the database. This mirrors the CHECK constraints in migration `0001`
  rather than replacing them — the database remains the authority because it
  cannot be bypassed; validation exists to return a useful field-level error
  instead of an opaque constraint violation.
- **Payload limits.** JSON bodies are capped at 256 KB; chat messages at 4,000
  characters; history replay at 30 messages.

---

## 5. Third-party content

No video is hosted, embedded, mirrored or reproduced.
`exercise_library.video_url` stores an outbound link to the rights holder's own
channel, and the UI opens it in a new tab. The system prompt enumerates the
library and names it as the only permitted source, so the model cannot invent a
URL — and when the library is empty, the instruction inverts and forbids
mentioning videos at all.

---

---

## 6. Rate limiting

`/api/chat` is metered per user, because a valid session looping the endpoint
is a direct line to an unbounded Anthropic bill.

Counters live in Postgres rather than in process memory. Serverless functions
share no memory, so an in-process counter is per-instance and the effective
limit becomes (quota × number of warm instances) — a number nobody controls.
Postgres is already in the request path, so using it avoids operating a Redis
for one counter.

| Bucket | Quota | Window |
|---|---|---|
| `chat` | 60 requests | 1 hour |
| `chat_daily` | 300 requests | 24 hours |
| `write` | 240 requests | 1 hour |
| `export` | 5 requests | 24 hours |

**A flaw found and fixed before this shipped.** The first implementation
(migration `0005`) used a `SECURITY INVOKER` function, which required granting
`INSERT` and `UPDATE` on the counter table to `authenticated`. That made the
table writable through PostgREST directly:

```
PATCH /rest/v1/rate_limit_counters?bucket=eq.chat   { "count": 0 }
```

The RLS policies were correct — a user could only edit their own row. The
problem was that the table was reachable at all: a rate limit the limited party
can edit is not a rate limit. Migration `0006` moves the counters into the
`private` schema, which PostgREST does not serve, and makes the function
`SECURITY DEFINER` so it is the only writer. Verified: `UPDATE
private.rate_limit_counters` as the `authenticated` role now returns
`42501 permission denied for schema private`.

Quotas are defined inside the database function, not passed as arguments. A
caller-supplied limit would be trivially raised by anyone invoking the RPC with
their own JWT.

The middleware **fails open**: if the limit check itself errors, the request
proceeds and the failure is logged loudly. Turning a counter outage into a
total outage is the worse failure for a coaching app bounding its own spend.
This would be the wrong default for something guarding authentication, and the
choice is pinned down by a test so it is not silently reversed.

---

## 7. Data subject rights

| Right | Implementation |
|---|---|
| Access (GDPR Art. 15, CCPA) | `GET /api/account/export` returns every stored record as JSON, assembled through the user-scoped client so it cannot include another user's rows. |
| Erasure (GDPR Art. 17) | `DELETE /api/account` → `public.delete_my_account()`. Deletes the caller's `auth.users` row; `ON DELETE CASCADE` removes everything else. |
| Portability | The export is machine-readable JSON with a versioned format field. |

The export deliberately includes health data in the clear — that is the point
of a subject-access request, and it is the one path where the logging redaction
rules do not apply. The distinction that makes this correct: the data goes to
the data subject over an authenticated TLS connection, not to an operator's log
drain. The frontend assembles the download from an in-memory blob, so the file
never acquires a URL.

`delete_my_account()` takes **no arguments at all**. There is no parameter to
manipulate; the target is `auth.uid()`. Building erasure this way avoided
introducing the service role key — which would have undone the architecture's
central decision (ADR-1) for the sake of one endpoint.

**Retention.** Not yet implemented. Data is kept until the user deletes their
account. A defined retention period with automated expiry is required before
operating in the EU at any scale, and is listed below.

---

## 8. Error monitoring

Sentry is optional and off unless `SENTRY_DSN` is set. When enabled, every
event passes through `beforeSend`, which runs the same redactor the logger uses
over the **entire event object**, not a hand-picked field list.

Error trackers are unusually good at capturing exactly the wrong thing: a
failed profile write carries the request body, a failed query carries its
parameters, and a stack frame carries local variables — `profile` is in scope in
half the routes here. So on top of key-based redaction, `beforeSend`
unconditionally drops request bodies, cookies, query strings, all headers but
`user-agent`, and every stack frame's captured variables. `sendDefaultPii` is
false and trace sampling defaults to zero.

Only 5xx responses are reported. A 400 or a 429 is the system working
correctly; forwarding those trains everyone to ignore the alerts that matter.

A missing or uninstalled SDK degrades to a logged warning. A monitoring tool
that can break the application it monitors is worse than no monitoring tool.

---

## 9. Accepted linter warnings

The Supabase security advisor reports two warnings, both for
`authenticated_security_definer_function_executable`:

- `public.consume_rate_limit(text)`
- `public.delete_my_account()`

**These are accepted, not overlooked.** The lint asks whether signed-in users
being able to call a `SECURITY DEFINER` function is intentional. Here it is:
both functions exist precisely so users can call them. Neither can be turned
against another account —

- both derive their target from `auth.uid()`, never from an argument;
- `delete_my_account()` takes no arguments at all;
- `consume_rate_limit()` takes one, validated against a closed whitelist;
- both are `set search_path = ''` with fully-qualified references;
- both explicitly raise when `auth.uid()` is null, since `SECURITY DEFINER`
  bypasses the RLS that would otherwise refuse an anonymous caller;
- `EXECUTE` is revoked from `anon` and `public`.

The contrast with migration `0004` is the point. There, the same class of lint
described a genuine mistake — two trigger functions sitting in `public` where
nothing should ever have called them — and it was fixed by moving them out. A
linter finding is an argument to evaluate, not a checkbox to clear; the two
outcomes here are different because the situations are.

---

## Known gaps

Listed rather than omitted. None is a blocker for the current phase; each is a
real item.

1. **No audit log.** There is no record of who read or changed what. Any
   serious health-data posture eventually needs one.
2. **No automated retention policy.** Deletion, export and consent withdrawal
   all work; scheduled expiry of dormant accounts does not exist.
3. **Email/password only.** No MFA, and password policy is whatever Supabase
   Auth is configured with.
4. **Rate limit counters are never swept.** Expired windows accumulate. The
   `DELETE` is written in migration `0006`; it needs a `pg_cron` schedule.
5. **Bundle scanning is pattern-based.** It catches known secret shapes and the
   literal values in the environment. A novel credential format in an
   unexpected place would not be caught.
6. **Rate limiting is per-user, not per-IP.** It bounds cost from authenticated
   abuse. It does nothing about signup-flood or credential-stuffing at the auth
   layer, which is Supabase's to defend and has not been configured.
7. **The Spanish catalogue has not been reviewed by a native speaker.** It is
   complete and mechanically verified, which is not the same as being good.
8. **No terms of service, general privacy policy, or liability waiver.** The
   Consumer Health Data Privacy Policy exists as a draft pending attorney
   review; the others do not exist at all. See `LEGAL_CONSIDERATIONS.md`.
9. **Default table privileges were wrong until migration `0009`.** Supabase
   grants ALL on new `public` tables to `anon` and `authenticated`; a one-time
   `REVOKE` does not cover tables created later. Fixed at the default-privilege
   level, but worth re-auditing whenever a table is added:
   `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated');`

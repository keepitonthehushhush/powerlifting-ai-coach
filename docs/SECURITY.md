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

## Known gaps

Listed rather than omitted. None is a blocker for Phase 1; each is a real item.

1. **No rate limiting.** A valid session can call `/api/chat` in a loop and run
   up the Anthropic bill. Needs a per-user quota before any public launch.
2. **Session writes are not transactional.** `POST /api/sessions` writes the
   session and then its derived `progress_logs` rows as two calls, because
   PostgREST exposes no multi-statement transaction over HTTP. A failure
   between them leaves a session with no derived logs. The fix is a Postgres
   function invoked via `rpc()`.
3. **No audit log.** There is no record of who read or changed what. Any
   serious health-data posture eventually needs one.
4. **Email/password only.** No MFA, and password policy is whatever Supabase
   Auth is configured with.
5. **No formal data-retention policy.** Deletion works; scheduled retention and
   export (GDPR subject-access) are not built.
6. **Bundle scanning is pattern-based.** It catches known secret shapes and the
   literal values in the environment. A novel credential format in an unexpected
   place would not be caught.

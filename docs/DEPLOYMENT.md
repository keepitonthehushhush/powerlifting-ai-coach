# Deployment

Host: Vercel. The Vite frontend is served as static assets from `web/dist`; the
Express API runs as a single serverless function behind the `/api/*` rewrite in
`vercel.json`. Same origin for both, which is why the browser never needs a
CORS configuration and why `VITE_API_BASE_URL` is unset in production.

Database and auth: Supabase. Nothing is deployed there by CI — migrations in
`supabase/migrations/` are applied deliberately, in order, and recorded in
`docs/BUILD_LOG.md`.

---

## 1. Environment variables, and the trap in them

Six variables. Which of them the **build** can see is the thing that matters,
and it is not obvious from the dashboard.

| Variable | Needed at | Visibility |
|---|---|---|
| `VITE_SUPABASE_URL` | build | non-sensitive **(required)** |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | build | non-sensitive **(required)** |
| `SUPABASE_URL` | runtime | non-sensitive |
| `SUPABASE_PUBLISHABLE_KEY` | runtime | non-sensitive |
| `ANTHROPIC_MODEL` | runtime | non-sensitive |
| `ANTHROPIC_API_KEY` | runtime | **sensitive** (it is a real secret) |

**Sensitive does not mean the build cannot see it.** Vercel's documentation is
explicit: *"Sensitive values are still available to builds run within the
Vercel build container and at runtime."* Sensitive controls whether a value can
be read back — by a person in the dashboard, or by `vercel env ls` — not
whether the build receives it.

What Vercel *does* refuse is the combination of a public framework prefix and
sensitive visibility, on Production and Preview:

```
Error: Environment variables with a public framework prefix (VITE) cannot use
secret visibility on Production or Preview.
```

That refusal is a coherence guard rather than a build-visibility rule. A
`VITE_` variable is compiled into JavaScript every visitor downloads, so asking
for it to be unreadable is asking for secrecy on something about to be
published. Vercel declines rather than letting the setting imply a protection
it cannot provide.

**And recent Vercel CLI versions create every variable as sensitive unless told
otherwise.** `--no-sensitive` reads like a redundant restatement of a default;
it is the opt-out. Without it, `vercel env add VITE_SUPABASE_URL production` is
rejected outright — and a rejected create means the variable does not exist:

```bash
vercel env add VITE_SUPABASE_URL production --no-sensitive   # required
vercel env add ANTHROPIC_API_KEY production --sensitive      # the default, stated anyway
```

The server-side variables can be sensitive or not; the build reads them either
way. Non-sensitive is chosen here only for the ones that are not secrets, so
their values stay readable for debugging. `ANTHROPIC_API_KEY` stays sensitive
because it is one.

A default that quietly changes what gets created is worth writing down, which
is what `scripts/set-vercel-env.sh` is for.

> **Correction.** An earlier version of this document claimed sensitive
> variables are withheld from the build, and that this was why the deployed
> bundle had no configuration in it. That was wrong — see `BUILD_LOG.md` D.14.
> The real cause was narrower: `VITE_SUPABASE_URL` had never been created,
> because every attempt was rejected by the rule above.

Three failure modes follow from all this, and this project hit each one:

1. **The rejected variable never gets created.** In a long CLI or dashboard
   session that error scrolls past, and `VITE_SUPABASE_URL` simply did not
   exist. Nothing else reports it.
2. **A listing cannot tell you.** `vercel env ls` prints `Hidden` for every
   sensitive variable, so a correctly-set secret and a build-invisible one look
   identical.
3. **Preview fails silently where production succeeds.** Preview variables can
   be scoped to a single git branch, so `env add` prompts for one — and the
   value arrives on stdin, which is exhausted by then. Without `--yes` every
   preview write dies at an unanswerable prompt while production, which never
   prompts, reports success. The environment nobody checks is the one that
   breaks.

Non-obvious, and worth knowing before it costs an hour: `env ls` prints the
**encrypted envelope** (`eyJ2IjoidjIi…`) in the `value` column for
non-sensitive variables. That is not the stored plaintext and not a sign the
value is wrong. The column to read is `type`.

Non-sensitive does **not** mean public-in-transit — values are still encrypted
at rest. It controls whether the value can be read back and whether the build
receives it. The two `VITE_` values are additionally public *by design*: they
are compiled into JavaScript every visitor downloads. That is safe only because
authority in this system comes from the end user's JWT and is enforced by
row-level security in Postgres, never from possession of the publishable key.
See `docs/ARCHITECTURE.md`, ADR-2.

### Setting them

```bash
npx vercel@latest login
npx vercel@latest link
bash scripts/set-vercel-env.sh          # reads values from .env, sets visibility
```

The script exists because visibility is intent, and intent belongs in version
control rather than in someone's memory of which toggle they flipped. It reads
from `.env`, which is gitignored; no value is stored in the repository.

---

## 2. Rebuild — setting a variable changes nothing on its own

Build-time variables are consumed once, when the bundle is compiled. The
running deployment keeps the values it was built with, forever, until something
rebuilds it.

```bash
npx vercel@latest redeploy coachdiaz.app
```

`redeploy` rebuilds the same commit with the project's *current* environment,
which is exactly the question being asked here. Pushing a commit works too;
changing the variable alone does not.

---

## 3. Verify the deployment, not the build

```bash
npm run verify:deployment -- https://coachdiaz.app
```

`npm run verify:bundle` scans `web/dist` on the machine that ran it. It passed
on every run while production served a blank page, and it was right to: the
local artifact was correct. **A local artifact is not evidence about a remote
one.**

`scripts/verify-deployment.mjs` downloads what the public downloads and makes
two assertions that deliberately pull against each other:

- **Negative** — no `sk-ant-…`, no `service_role`, no `sb_secret_…`, no private
  key block in any served asset.
- **Positive** — the public configuration that is *supposed* to be compiled in
  actually is.

The positive half is the one that matters here. A build with no environment at
all passes the secret scan trivially — that is precisely the state that shipped
the blank page. A scanner that only looks for secrets would have called that
deploy healthy.

---

## 4. Supabase auth configuration

In the Supabase dashboard, **Authentication → URL Configuration**:

- **Site URL**: the production origin.
- **Redirect URLs**: the production origin followed by `/**`.

Without this, confirmation and password-reset emails link to `localhost:5173`
and every new signup is dead on arrival. This is dashboard state, not
migration state, so it does not travel with the repository — which is why it is
written down here.

---

## 5. What is deliberately absent

- **No `SUPABASE_SERVICE_ROLE_KEY` anywhere in the deployment.** It would
  bypass every row-level security policy in the database. The application has
  no code path that needs it, and the surest way to keep it from leaking is for
  it never to be present. See `docs/SECURITY.md`.
- **No third-party scripts on any page that collects health data.** Under the
  FTC Health Breach Notification Rule an unauthorized disclosure is a
  reportable breach, and an analytics or session-replay tag on the intake form
  would qualify. This is a compliance constraint, not a preference. See
  `docs/LEGAL_CONSIDERATIONS.md`.
- **No `.env` uploaded to the host.** Deploy from git rather than
  `vercel deploy` from a working directory, so local files are never part of a
  build context.

---

## 6. Release checklist

```
npm run check                    tests, dependency guard, build, local secret scan
bash scripts/set-vercel-env.sh   only when the environment changed
npx vercel@latest redeploy <url>
npm run verify:deployment -- <url>
npm run test:db                  RLS + consent gate, against a real database
```

Then, by hand: sign up as a new user, accept consent, complete intake, send one
message, log one session. The automated checks prove the artifact is correct;
they do not prove the product works.

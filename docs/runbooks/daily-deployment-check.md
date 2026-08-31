# Daily: is production serving the right code?

Read `README.md` in this directory first — it carries the network facts and the
PASS / FAIL / COULD NOT DETERMINE rule that every step below depends on.

**This task is READ-ONLY.** Do not edit files, commit, push, deploy, or run
migrations. You are looking, not fixing. If you find something worth fixing,
say so and stop.

## Why this exists

On 2026-08-31 a login fix was deployed and, seconds later, a redeploy of a
two-day-old commit took the `coachdiaz.app` alias. Production silently ran
stale code for two days. Eduardo reinstalled the app on his phone twice
against a build that could not contain the fix, and nothing in the toolchain
could tell him — because every check passed. The old build was a perfectly
good build of the wrong commit.

## The checks, in order

### 1. Is it up?

WebFetch `https://coachdiaz.app/api/health?cb=<today's date>`.

The query string is not decoration: **WebFetch caches for 15 minutes**, and
without it you may be reading a stale answer — which is exactly the failure
mode this task exists to catch.

It should return JSON with `status: "ok"`. If it does not respond, that is the
headline. Report it and skip the rest.

### 2. Is it the right code?

The response carries a `commit` field. In the repo:

```
git fetch origin --quiet && git rev-parse origin/main
```

- **They match** — good. Say nothing more about it.
- **They differ** — the important finding. Report BOTH values, then get the
  direction with `git rev-list --count <deployed-sha>..origin/main` and say how
  many commits production is behind. The remedy is **Promote to Production on
  the newest deployment** in Vercel — a *Redeploy* on an older deployment page
  is what caused the original incident, because it rebuilds that old commit and
  takes the live alias.
- **No `commit` field at all** — production predates the field, so it is at
  least as old as 2026-08-31. Treat that as stale.

Also run `git status --short --branch`. Unpushed commits mean production cannot
be current whatever Vercel did, and that is Eduardo's action, not yours.

### 3. Is the deployed coach the one the eval grades?

`/api/health` also carries `maxOutputTokens`. Compare it against the local
setting:

```
grep '^ANTHROPIC_MAX_TOKENS=' ~/mnt/Documents/powerlifting-ai-coach/.env
```

That variable is a plain number, not a secret. **Do not print any other line of
`.env`, ever.**

If they differ, the safety evaluation is grading a coach that is not the one
serving athletes — report both numbers. If either is missing, say COULD NOT
DETERMINE; an absent value is not agreement.

### 4. Any new errors?

With the Supabase MCP tools, against the production project
`pwbkdxnvubtflgpqpest`:

```sql
select code, origin, http_status, route, count(*), max(created_at)
  from public.error_events
 where created_at > now() - interval '25 hours'
 group by 1,2,3,4 order by 5 desc;
```

`origin = 'client'` rows are browser crashes — a page that died on somebody's
phone. `origin = 'server'` rows are API failures. An empty result is good news
and needs one word.

If the Supabase tools are not available, say the error log could not be
checked. Do not omit it silently.

## What this task cannot do

`node scripts/verify-deployment.mjs` is the fuller version of checks 1–3 — it
downloads the real deployed assets and proves no server-side secret is in them.
**It cannot run from your shell**, because the proxy blocks `coachdiaz.app`.
Do not report it as failed; report that it could not be run here.

If anything above looks wrong, ask Eduardo to run this in his own terminal,
where there is no proxy:

```
cd ~/Documents/powerlifting-ai-coach && node scripts/verify-deployment.mjs https://coachdiaz.app
```

## How to report

**Be quiet when everything is fine.** One or two sentences, nothing more. He
does not want a daily essay.

When something is wrong: lead with it in plain language, say what it means for
the people using the app, and give the specific next action.

Never say a check passed when it could not be run. That distinction is the
whole point of this task.

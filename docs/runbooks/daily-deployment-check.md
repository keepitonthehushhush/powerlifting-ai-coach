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

### 5. Did anybody arrive, and did they get anywhere?

The checks above ask whether the code is healthy. This one asks whether the
product is, and they are not the same question — on 2026-09-06 every technical
check was green while the two most recent signups had completed the entire
intake and sent zero messages. Nobody found that for five days.

It matters most while the link is being shared: a stalled signup you hear about
the next morning is somebody you can still ask what happened. A week later they
are gone.

Same Supabase MCP tools, same production project:

```sql
select u.created_at::date as signed_up,
       right(u.id::text, 6) as who,
       (select count(*) from public.conversations c where c.user_id = u.id) as conversations,
       (select count(*) from public.usage_events e where e.user_id = u.id) as replies,
       p.goal is not null as finished_intake
  from auth.users u
  left join public.user_profile p on p.user_id = u.id
 where u.created_at > now() - interval '8 days'
 order by u.created_at;
```

**Report only what is worth acting on.** In order of interest:

- **Finished the intake, zero conversations.** The one that matters. They got
  all the way through and never spoke to the coach. Say so by signup date, and
  check `error_events` for a `client_request_failed` row from around that time —
  that is what separates "the send broke" from "they looked and left", and it
  is the only evidence that can tell them apart.
- **A conversation with zero replies.** They sent something and got nothing.
  That is a failure, not a choice.
- **Nobody signed up at all.** Worth one sentence during an outreach push and
  worth nothing otherwise. Do not report it as a problem.

Everything else — people using it normally — needs no comment. `right(u.id, 6)`
rather than the email on purpose: this is a report about a funnel, not a list of
who is behind on their training.

`docs/WHO_IS_USING_THIS.md` has the fuller query, what it said when it was
written, and what had already been ruled out.

## 6. Is the one email this product sends actually able to go?

```
npm run check:smtp
```

Connects and authenticates. Sends nothing to anybody.

| exit | meaning | what to do |
| --- | --- | --- |
| 0 | connected and authenticated | nothing |
| 1 | configured, and the server refused it | **guardian mail is dead right now** - see the script's own output for the three causes that actually happen |
| 3 | not configured, or nodemailer is not installed here | neither is a finding; `--require` turns the first into a failure where mail must work |

Why it is on this list at all: the only sender is the guardian consent link,
used when somebody aged 13-17 signs up. `mailer.js` reports a dead transport
honestly, but only to that one caller, at the moment of a send. So without this
check the first person able to discover that SMTP broke is a parent who never
received the mail, about a child who is waiting - and the athlete is shown "we
have sent it" either way. The gap between "it broke" and "somebody found out"
has no upper bound.

Note the ceiling this does NOT check. Supabase's built-in email service, which
sends signup confirmations and password resets, is capped at **2 messages per
hour** and their own documentation says it is not meant for production. That is
a separate setting in the Supabase dashboard, not an environment variable, and
`check:smtp` cannot see it. Custom SMTP there raises it to 30/hour, adjustable.

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

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

## 6. Is the email this product sends actually able to go?

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

### And the thing exit 0 does not prove

`verify()` proves the **login**. It does not prove a **send**, and the gap is
not theoretical: Postmark accepts the credentials of a server whose Sender
Signature is unconfirmed and then refuses every message with a 422,
`Sender Signature not defined for From address`. A green check above has always
been compatible with nothing ever arriving.

Close that gap once, against an inbox you can open:

```
npm run check:smtp -- --probe you@example.com
```

One fixed diagnostic message, to the address you name, recording nothing and
touching no account. **Then go and look in that inbox, including spam.** The
script says ACCEPTED IS NOT ARRIVED because the server taking a message is not
the same as a person receiving one — and only the second proves the sending
address is confirmed and the domain authenticates.

Do this before section 7. Writing to real users on the strength of a handshake
is how you find out about the 422 from someone else.

### The three Postmark streams, and which of them this product uses

Postmark gives every server three by default. Audited 2026-09-08; all three
exist, and the decision about each is below rather than in somebody's memory.

| stream | state | this product |
| --- | --- | --- |
| `outbound` (Transactional) | in use | **both messages**, named explicitly in the header rather than left to Postmark's default — see MESSAGE_STREAM in `server/src/lib/mailer.js` |
| `broadcast` (Broadcasts) | exists, unused | **never.** It attaches unsubscribe handling and carries a bulk sending reputation. You cannot unsubscribe from being told your terms changed, and an unsubscribe link on a message asking a parent to consent to their child training would be worse than absurd |
| `inbound` (Inbound) | exists, no webhook | **deliberately off.** Turning it on would pipe replies into the application, which means storing user-written email content — a new personal-data surface with its own retention and erasure obligations, on a product that holds health data. Replies are handled by a human instead |

**Replies go to a person, not to the app.** `coachdiaz.app` has MX records
pointing at ImprovMX, so mail to `coach@coachdiaz.app` forwards to a real
mailbox. That is the whole reply story and it is the right size for it. If that
forwarding ever stops, a parent's reply to a consent request disappears — worth
re-checking when anything about the domain changes.

**DNS, as audited on 2026-09-08:**

- **SPF** is `v=spf1 include:spf.improvmx.com ~all` and is **correct as it
  stands**. Postmark is deliberately *not* in it: their documentation is
  explicit that "the Return-Path domain is now used by receiving email domains
  to check for SPF alignment", so adding them would be noise. Do not "fix" this.
- **Return-Path** is set up: `pm-bounces.coachdiaz.app` resolves to
  `pm.mtasv.net`. That is what gives DMARC's stricter SPF alignment.
- **DKIM** has no record at `pm._domainkey.coachdiaz.app`. Newer Postmark
  accounts are issued a unique selector, so this may simply be published
  somewhere else — the exact record is in Postmark under Sender Signatures →
  the domain → DNS Settings, and that page also says whether it is verified.
  **Check it.** Without DKIM, messages are signed by Postmark's shared domain
  and DMARC alignment fails, which is the difference between the inbox and
  the spam folder.
- **DMARC** is absent. Not required at this volume, and `p=none` is cheap and
  tells you what receivers think of your mail.

## 7. Is anybody stuck on a policy version we no longer offer?

```
npm run policy:notice -- --list
```

A consent recorded against superseded text is agreement to something we have
since changed. The consent gate already stops those accounts at the door and
shows them what moved — **but only if they come back**, and until this existed
nothing could tell them to. An obligation that depends on somebody happening to
return is not an obligation being met.

`--list` reads and sends nothing. It prints the account ids and the versions
they are on. To write to one of them:

```
npm run policy:notice -- --user <uuid>          # dry run, prints what it would do
npm run policy:notice -- --user <uuid> --send   # actually sends
```

Three deliberate refusals, and none of them is worth "fixing":

- **There is no `--all`.** Deciding to write to somebody is a decision, and it
  should be made by a person who then watches it happen.
- **Naming the account is not enough**; `--send` is a second, separate yes. The
  failure mode of an emailing script is not "it did not work", it is "it worked,
  on the wrong list", and there is no undo.
- **An account already on the current versions is refused, not mailed.** A
  copied id or a stale terminal should cost you an error, not somebody else a
  confusing email.

Re-running is safe by construction rather than by care: the row in
`policy_notice_emails` is written **before** the send is attempted and
`(user_id, notice_key)` is unique, so a second run collides and sends nothing.
A row with no `delivered_at` is somebody who was **not** reached — that is a
fact worth being able to see, which is why there is no `--retry`. Work out what
happened first.

Go one account at a time the first time. Exit is non-zero if anybody named was
not reached.

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

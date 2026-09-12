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
- **DKIM is published, under a TIMESTAMPED SELECTOR.** The record is at
  `20260830135054pm._domainkey.coachdiaz.app` — Postmark issues a per-domain
  selector stamped with the moment the domain was added, so the familiar
  `pm._domainkey` is empty and looking there reports a gap that does not
  exist. This was written down as missing for exactly that reason before
  `vercel dns ls coachdiaz.app` showed it sitting there. **Read the zone, not
  the selector you expect.**
- **DMARC is published** as of 2026-09-08:
  `v=DMARC1; p=none; rua=mailto:eddydiaz10@gmail.com; fo=1`.
  `p=none` ENFORCES NOTHING and is meant to stay that way for now - it is a
  listening post, not a policy. Reports arrive at that address; read a few
  weeks of them before considering `p=quarantine`, because tightening a policy
  over a domain you have not watched is how a person's own mail stops
  arriving. `fo=1` asks for a report whenever either check fails, which is the
  useful setting while there is nothing to lose.

**DNS lives at Vercel** (`ns1/ns2.vercel-dns.com`), so records are added with
`npx vercel dns add coachdiaz.app <name> <type> <value>` or in the Vercel
dashboard under Domains — not at the registrar, and not in Postmark.

### Signup mail is on Supabase's built-in service, and that is a launch risk

**State as of 2026-09-12: custom SMTP is NOT configured in Supabase Auth — but
nothing is blocking it any more. Postmark approval landed; see the bottom of
this section for what to enter.**

Address confirmation and password reset do not go through Postmark. They go
through Supabase Auth's own SMTP setting, which is empty — so they use
Supabase's built-in service. Their documentation is blunt about what that is:
best-effort only, **two messages per hour**, no delivery SLA, and explicitly
not for production.

It has worked for every signup so far because seven accounts across seventeen
days have never once needed two confirmations in the same hour. The third
person to sign up within an hour is the first one who finds out, and what they
see is a signup that fails — `over_email_send_rate_limit`, which the app
already classifies as `auth_rate_limited` and reports honestly. The app handles
it correctly. There is simply nothing to be done about it from the app's side.

**`npm run check:smtp` does not cover this and says so on every run.** That
script checks the application's own transport, which carries one message: the
guardian consent link. A PASS there says the guardian link can go out and says
nothing about whether anybody can create an account.

**The fix is a dashboard change, not a deploy.** Project Settings →
Authentication → SMTP Settings, pointed at a real provider. Once configured,
Supabase applies 30 messages/hour initially and that is adjustable.

**Postmark approval came through on 2026-09-12, so the blocker is gone.** While
it was pending, Postmark could only send to `coachdiaz.app` — which is why
pointing Supabase at it before approval would have been worse than the built-in
service, not better. That is no longer true.

What to enter, and the one field people get wrong:

| field | value |
| --- | --- |
| Host | `smtp.postmarkapp.com` |
| Port | `587` (STARTTLS; 25 and 2525 also work) |
| Username | the **Server API Token** |
| Password | the **same Server API Token**, again |
| Sender email | `coach@coachdiaz.app` — it must be a **confirmed Sender Signature** |
| Sender name | `Coach Diaz` |

The username and password being the same token is Postmark's scheme, not a
mistake. Their other credential type is an *SMTP Token*, which is a different
object and is not what this is.

**The token is typed into the Supabase dashboard and nowhere else.** Not into
`.env`, not into this file, not into a chat window. It is already in Vercel for
the application's own transport, marked sensitive.

**Then prove a send, because a saved setting proves nothing.** Sign up with a
real address you can open — a Gmail one, deliberately, since sending outside
`coachdiaz.app` is exactly the capability approval unlocked — and confirm the
mail arrives, including spam. Supabase's own test button proves the login, and
this product has already been bitten once by the gap between an accepted
handshake and a delivered message: Postmark accepts the credentials of a server
whose Sender Signature is unconfirmed and then refuses every send with a 422.

**Then come back and change the sentence at the top of this section**, which
says custom SMTP is not configured. A runbook that describes a state the
system left is worse than one that says nothing.

### Where people stop

```
npm run funnel
```

Reads only; prints no addresses, no names, no health information and no
training content — eight characters of each account id, timestamps and counts.

It exists because four of six real signups completed the intake form and sent
the coach **zero messages**, all of them leaving the same day, and nothing in
the database could say which of two opposite problems that was:

- **finished intake, never reached the coach page** — a bug. Routing, loading,
  or an error nobody saw. Check `error_events` for those accounts.
- **reached it and never typed** — a design problem. Go and read that page as a
  stranger would; no amount of debugging fixes it.

Migration 0064 added `coach_first_opened_at` to tell them apart, so **the split
only means anything for people who arrive from now on** — the report says so
itself rather than reporting a confident zero. It also treats a sent message as
proof of arrival, because the first version did not and printed three people
who were visibly talking to the coach as never having reached it.

### And whether they came back

```
npm run retention
```

Same privacy rules, and the companion to the one above: the funnel stops at
"sent a message", which is the beginning of the product rather than the end.
This prints, per account, how many visits and days it has and how far from
signup the last one was, then a return curve — came back at all, week one, week
two, week three, week four.

Three things to read it with, all of which the report prints for you:

- **The denominators shrink on purpose.** A window counts only accounts old
  enough for it to have CLOSED. An account created yesterday has not failed to
  reach week two, and counting it as a failure is how a young product convinces
  itself nobody stays.
- **The curve is in elapsed hours, not calendar days,** because nothing here
  knows anybody's timezone and a nine-in-the-evening session in California is
  stamped the next UTC day. The calendar-day column is texture; the curve is
  the evidence.
- **The concentration line.** When one account is more than half of all
  activity — today it is 86% — every percentage above it is a statement about
  that account. The script will not exclude anybody, because nothing in these
  tables marks a test account and a script that guessed would be inventing its
  own denominator.

Every number is a **floor**. A visit that wrote nothing — opened the app, read
the session, went and trained — was invisible until migration 0068 added
`activity_days`, and no cohort older than that table gains a visit
retroactively. ADR-22 has the rest, including why `usage_events` and
`auth.sessions` are both deliberately unread.

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
they are on.

**Then `--check`, before anything else.** It resolves each account's address
and reports whether this credential can actually see it — reserving nothing,
sending nothing, and printing the domain rather than the address:

```
npm run policy:notice -- --check
```

It exists because the first irreversible thing `--send` does is write the
reservation, and until `--check` there was no way to find out beforehand
whether the key could even read an address. `UNREACHABLE ... the admin API
refused this key (HTTP 401)` means `SUPABASE_SECRET_KEY` is the publishable key
rather than the secret one; it does not mean anything about the account.

**`--check` proves we can address them. It does not prove we can reach them.**
That is `npm run check:smtp -- --probe you@example.com`, to an address outside
`coachdiaz.app` — every one of the accounts on this list is on gmail, icloud or
protonmail, and until Postmark approval landed on 2026-09-12 a send to any of
them would have been refused.

**Proved once, on 2026-09-12:** a probe to a gmail address was accepted, no
bounce, and **arrived in the inbox**. That is the first time this product has
demonstrably delivered mail outside its own domain, and it is the fact that
makes the notice runnable at all.

**And before naming anybody: which accounts are real users?** That is not
answerable from these tables — nothing in them marks a test account. Two
developer accounts have already turned up in a set of seven, one of them found a
day after being written up as a returning customer. Ask before sending.

To write to one of them:

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

The address lookup happens **before** that reservation, and deliberately: it is
a read, it fails for reasons that have nothing to do with the person being
written to — a wrong key, a typo in the URL — and it used to sit on the far
side, where any of those spent an account's one notice on a request that never
left the building.
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

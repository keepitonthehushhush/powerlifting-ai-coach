# Who is actually using this

A standing query, not a scheduled check. Run it when you want to know whether
the product has a growth problem or an engineering one, because the two look
identical from inside the code and only this tells them apart.

It collects **no new data**. Every column comes from tables that already exist
for another reason — auth, consent, conversations, usage. Nothing here is
tracking, and nothing here should become tracking: on a product holding health
data, a behavior stream is a liability, and the funnel below answers the
question without one.

## The query

```sql
select u.created_at::date as signed_up,
       right(u.id::text, 6) as who,
       u.last_sign_in_at::date as last_signed_in,  -- NOT last seen; see below
       (select count(*) from public.consent_records r where r.user_id = u.id) > 0 as consented,
       p.date_of_birth is not null and p.goal is not null as finished_intake,
       (select count(*) from public.conversations c where c.user_id = u.id) as conversations,
       (select count(*) from public.usage_events e where e.user_id = u.id) as replies,
       (select count(*) from public.workout_programs w where w.user_id = u.id) as programs,
       (select count(*) from public.progress_logs l where l.user_id = u.id) as logs
  from auth.users u
  left join public.user_profile p on p.user_id = u.id
 order by u.created_at;
```

Run it through the Supabase SQL editor or the MCP. **Not** from `device_bash`,
which has no outbound network.

## What it said on 2026-09-06

Six accounts, and the shape is the finding:

| signed up | consented | finished intake | conversations | replies |
|---|---|---|---|---|
| 08-25 | yes | yes | 1 | 10 |
| 08-25 | yes | yes | 1 | 80 |
| 08-26 | yes | yes | 1 | 2 |
| 08-28 | partly | no | 0 | 0 |
| 09-01 | yes | yes | **0** | **0** |
| 09-02 | yes | yes | **0** | **0** |

**One account holds 80 of the 92 replies, and it is the developer's.** Every
economic figure this project has published — the $0.0712 mean reply, the
front-loaded 38-then-19 curve that ADR-20 cites as its reason for counting the
trial in replies — is computed from that one account. The reasoning may still
be right; the evidence is n=1 and the 1 is not a customer. Say so whenever the
number is quoted.

**The two newest signups completed the entire intake and sent nothing.** Not
partial sign-ups: terms, AI processing, health data and leaderboard consent,
date of birth, experience level, goal and units — then zero messages, and never
seen again after that day.

## What was ruled out, and how

Neither was blocked by anything the server does. Checked, not assumed:

- **Consent.** Both hold the current version of every policy. Confirmed by
  calling the deployed `public.has_active_consent()` per user rather than by
  comparing version strings by eye.
- **The paywall.** Off.
- **Medical clearance.** It gates the program block, not the conversation.
- **A dead end after refusal.** `ProtectedRoute` sends a stale consent to
  `/consent`, where it can be re-granted.

Which leaves two possibilities that cannot be told apart: they looked and left,
or the send failed in their browser. **The client failure reporting that would
distinguish them shipped 2026-09-04, after both of them.** From now on a failed
send lands in `error_events` with `client_request_failed`, so the next occurrence
is answerable. This one is not, and guessing between the two is how you end up
fixing whichever you thought of first.

## The one that IS worth acting on

Three of the six cannot be coached today, because a policy version bump
invalidated their consent and nothing told them. That is correct behavior —
a version bump is meant to invalidate — and they will be redirected to
`/consent` the moment they open the app. It is only a problem if they never
open it again, which is the argument for transactional email being the next
absence worth closing, and is recorded as such in ARCHITECTURE.md section 6.

## What to watch

- **Conversations per signup.** If it stays at zero for people who finished
  the intake, the problem is between the last intake screen and the first
  message, and no amount of coaching quality fixes it.
- **`client_request_failed` in `error_events`.** A cluster of these from
  accounts with no conversation turns the ambiguity above into an answer.
- **Logs per program.** One `progress_logs` row exists against three programs.
  The whole loop is prescribe → train → log → adapt, and the logging step has
  happened once. Same caveat: n is tiny and it is mostly the developer.

## 2026-09-07: the thing this document said to watch for happened

"Conversations per signup. If it stays at zero for people who finished the
intake, the problem is between the last intake screen and the first message."
It stayed at zero. Seven accounts now, three of them new in a week, and the
count of people other than the developer who have sent a message is still one.

Three finished intake — experience, goal, days, equipment, health — and sent
nothing. The lift fields are blank on all three, which is not the wall it
looks like: those inputs are optional and sit ABOVE the required ones on the
form, so a blank squat means "skipped an optional field", not "stopped here".
They submitted. They just never said anything afterwards.

### One of them has a cause, and it is ours

`873b84c7` finished intake at 11:46 on 09-02 and hit `storage_unavailable` on
`GET /api/consent` at 19:18 the same day. That read failing left the consent
gate at `reason: 'unknown'` — correctly, it fails closed — and `ProtectedRoute`
sent them to `/consent`, a screen headed "before we start", whose panel reloads
the endpoint that just failed and whose Continue button stays disabled until it
succeeds. A dead end, reached by somebody who had already agreed to everything,
explaining nothing. They have not been back.

Fixed: an unreadable consent state now renders a retry in place, says the
problem is ours and that their choices are still saved. The gate still admits
nobody — failing closed was never the bug; landing it on a screen with no exit
was.

### One of them I called unexplainable, and it was in the database all along

WRITTEN 09-07, CORRECTED 09-08. The paragraph here said `a12541d0` "cannot be
explained" - signed up 09-06, every profile field null, no clearance assertion,
no conversation, no error - and used that to justify migration 0062.

It was explainable. `consent_records` holds ZERO rows for them. The consent
screen is the first thing after signup and before intake, so they confirmed
their email, landed on it, and left without granting anything. One query would
have said so and I did not run it: I checked the profile, the conversations,
the usage and the audit ledger, decided the answer was not there, and wrote
that down as a fact about the database rather than about my search.

That is the same failure as calling transactional email the biggest unclosed
gap while `SMTP_HOST` sat filled in - twice in two days, both times a confident
claim about a system I had not asked. **The rule is not "look at the data", it
is "name which table would hold the answer, and go and look at THAT one."**

Migration 0062 is still worth having, and for the reason given: it separates
"never came back" from "came back and abandoned intake", which `consent_records`
cannot. It is stamping in production as of 09-08. It just was not needed to
answer this particular question.

So the drop points are now three, not two: the consent screen (1 of 7), intake
completed with nothing sent (3 of 7), and one lost to the consent-read failure
fixed on 09-07.

### Still open

- **Transactional email is configured and has never sent anything.** Corrected
  09-08: Postmark is wired up in production, `/api/health` reports
  `mail: configured`, and `guardian_consent_requests` holds zero rows - so the
  transport has never been exercised and its credentials are unproven. Three of
  seven are still on a stale policy version with nothing telling them.
- **n is seven and one of them is the developer.** Everything above is a
  direction to look, not a measurement.

---

## 2026-09-10: whether they came back, and the two instruments that lie about it

The question above is where people STOP. This one is whether anybody stays,
and it now has a script of its own:

```
set -a; source .env; set +a; npm run retention
```

Same privacy rules as the funnel — eight characters of an account id, dates and
counts, no names, no health information, no training content. The arithmetic is
in `scripts/lib/retention.mjs`, where it is tested against fixtures; ADR-22 has
the design.

### What it said the day it was written

Seven accounts. Three ever came back after their first day. One of those three
reached a second week, and that one is 86% of every visit in the database.

| window | | |
|---|---|---|
| came back at all (24h+) | 3 of 7 | 43% |
| active in week 1 (1–7d) | 3 of 6 | 50% |
| active in week 2 (8–14d) | **1 of 3** | 33% |
| active in week 3 | — | nobody is old enough yet |

The denominators shrink because accounts too young for a window are not counted
as having failed it. Four of the seven are less than two weeks old; reporting
"1 of 7 reached week two" would have been a false red of exactly the shape the
funnel script already had to retract once.

**Nobody who is not the heavy account has been active past day two.** That is
the finding, and it is n=2, and both of those numbers matter.

### Two instruments that were right there and are wrong

Neither of these is a judgment call. Both were measured against production on
2026-09-10 and both would have produced a confident, plausible, wrong number.

**`usage_events` looks like the perfect activity log and starts too late.** Its
first row is 2026-08-27T21:47:23Z, from migration 0020. Two of the first three
athletes had finished with this app before that. Built on it, a retention
report states that `d0513497` — ten messages across two days — never once used
the product. The message `at` stamps inside `conversations.messages` reach back
to 2026-08-25, the first day anybody used this at all, so that is the source.

**`auth.sessions` is not a history, and `last_sign_in_at` is not a last-seen.**
`645ed72f` has server-written proof of activity on twelve days between 08-25 and
09-10 and exactly ONE row in `auth.sessions`, created that morning: Supabase
Auth deletes sessions progressively once they expire or are superseded. The
table lists who is signed in *now*. It never claimed otherwise; it just reads
like a log.

The mirror image is in the same schema. `8bc672cb` sent its last message on
08-27 and has refresh-token rows updated on four days through 09-04 — a browser
tab waking up, not a person deciding to train. Note also what that account
proves about the column in the query above: its `last_sign_in_at` still says
08-27 while its tokens refreshed into September, so **`last_sign_in_at` moves on
a sign-in and not on a visit.** Somebody who stays signed in for a month shows a
month-old "last seen" that is nothing of the kind. The column is renamed above
rather than removed, because it is a true fact about sign-ins and only the label
was a lie.

### What still cannot be seen, and what was built for it

An athlete who opens the app in the gym, reads the session, pockets the phone
and squats writes NOTHING. Every number above counts writes, so all of them are
floors. Migration `0068` adds `public.activity_days` — one row per account per
UTC day, two columns, both of them the primary key, no timestamp and no route —
and the report reads it once there is anything to read. It cannot help the
cohorts above: nobody who joined earlier gains a visit retroactively.

One return it will still miss, stated so nobody finds it later and calls it a
bug: `requireAuth` refuses an aal1 token on an account with a second factor, so
somebody who comes back, meets the authenticator prompt and gives up is a
returning athlete this never records.

### What to watch next

- **Whether anybody other than the heavy account reaches week two.** The
  concentration line in the report is there so this cannot be read past.
- **`activity_days` against the write-based signals.** The gap between them is
  the size of the blind spot every earlier number was computed inside.
- **Sessions logged per program.** Still one `progress_logs` row against three
  programs. The loop is prescribe → train → log → adapt, and the log step has
  happened once in sixteen days.

---

## 2026-09-10, later: the log step, and the bug that was eating it

The retention report above measures whether people come back. Underneath it is
a smaller number that decides whether coming back means anything:

| | |
|---|---|
| programs written | 3 |
| sessions logged | 2 |
| `progress_logs` rows | 1 |
| sessions that came from a coach card | **0** |

The loop is prescribe → train → log → adapt. The first and last steps are built
and tested — adherence cross-references the program against the log,
progression computes the next load, phase decides when linear progression ends,
and ADR-23 now records what changed between blocks. **All of it reads a log that
has one row in it.**

### The card was being destroyed by the next message

Found in the code rather than guessed at. `Chat.jsx` replaced the proposal on
every reply, so a reply carrying no `session_log` block deleted an unanswered
one:

```
athlete   "hit 245 for a triple today, felt heavy"
coach     coaching, plus a session_log block   → the card appears
athlete   "should I keep going up?"            → types instead of tapping
coach     an answer, no block                  → THE CARD IS GONE
```

Nothing was logged, nothing failed, and nothing anywhere recorded that an offer
had been made and thrown away. It compounds: the prompt tells the coach never to
offer the same session twice — a rule written for an athlete who tapped **no** —
so silence was read as a decline and the offer never came back.

Typing a follow-up question instead of tapping is the most natural thing a
person does in a conversation. Fixed: an offer now survives until it is
answered, and only a **new** proposal replaces it.

### And whether an offer is ever made is now visible

An accepted card is durable — `workout_sessions.client_key` is non-null exactly
when a row came from one (migration 0065). An OFFER left no trace, so "the coach
never offers" and "it offers and nobody takes it" were indistinguishable, and
they have opposite fixes: one in the prompt, one in the product. Same shape as
0064, which had to add a timestamp to tell a routing bug from a design problem.

`chat.js` now logs `session.log_offered` with a count and never the movements.
Offered minus accepted is the decline rate. A log line rather than a table on
purpose: the open question is whether offers happen at all, which a week of logs
answers, and a durable decline record is worth building only if the answer turns
out to be "often, and nobody accepts".

### What to watch

- **`session.log_offered` against sessions with a `client_key`.** If offers are
  frequent and acceptances are not, the card is the problem. If offers are rare,
  the prompt is.
- **Whether the fix alone moves it.** Nobody was ever asked twice before, so the
  first athlete who describes a workout and then keeps talking is the first real
  test of it.

## 2026-09-12: the wall nobody was told about

The funnel question this document has been circling since 2026-09-06 —
*finished the intake and never reached the coach: a bug, or a design problem?*
— has an answer, and it is a third thing neither option covered.

### What the tables say

Seven accounts. `coach_first_opened_at` and `profile_first_read_at` are the
instruments migrations 0062 and 0064 added for exactly this.

| acct | signed up | intake | opened coach | messages | active since 09-10 |
|---|---|---|---|---|---|
| `d0513497` | 08-25 | yes | never | 20 | — |
| `645ed72f` | 08-25 | yes | 09-09 | 222 | 09-10, 09-11 |
| `8bc672cb` | 08-26 | yes | never | 4 | — |
| `9af1c695` | 08-28 | no | never | — | — |
| `c45f674f` | 09-01 | yes | **never** | — | **09-11** (the developer, not a user) |
| `873b84c7` | 09-02 | yes | never | — | — |
| `a12541d0` | 09-06 | no | never | — | — |

`645ed72f` is the developer. **So is `c45f674f`** — see the correction below,
which was found a day late. Read the rest.

The row that looked like it mattered was `c45f674f`: signed up 09-01, completed
intake, and **came back on 09-11** — ten days later, which for this product
would have been the best retention signal it had ever produced.

> **Correction, 2026-09-12.** `c45f674f` is **the developer's own second
> account**, identified by matching its address. It is not a returning user. It
> is Eduardo testing on a second account, and the "came back after ten days"
> visit was him.
>
> So the conclusion from 2026-09-10 stands unchanged and unsoftened: **nobody
> who is not the developer has been active past day two.** The one encouraging
> number in this section was self-generated, and I reported it as a user for
> most of a day before checking whose address it was.
>
> This is the third counting error in this section — six for five, and now a
> test account read as a customer. The pattern in all three is the same: a row
> that fit the story was not checked against the ledger. `645ed72f` was already
> known to be the developer's, and the existence of a SECOND developer account
> was never considered.
>
> The retention runbook already names why nothing catches this automatically:
> *nothing in these tables marks a test account, and a script that guessed
> would be inventing its own denominator.* That is still the right call for the
> scripts. It is not an excuse for a human-written paragraph.

### Why

`REQUIRED_CONSENTS` is `['terms_of_service', 'ai_processing']`, and a consent
is recorded against a policy VERSION. On 2026-09-09, commit `c71b0b9a` shipped
the nutrition-detail setting and moved `ai_processing` from `aip-2026-08-28a`
to `aip-2026-09-09a` — correctly, because it changed what the product discusses
with the model.

That is the mechanism working. It is a legal requirement and it is not a bug.

### Five accounts, and three of them were already walled

Counted properly, against the two required consents rather than by eye:

| acct | terms_of_service | ai_processing | walled since |
|---|---|---|---|
| `645ed72f` | current | current | — (the developer, re-consented 09-09) |
| `c45f674f` | current | `aip-2026-08-28a` | **09-09** (the developer's own second account) |
| `873b84c7` | current | `aip-2026-08-28a` | **09-09** |
| `8bc672cb` | `tos-2026-08-27b` | `aip-2026-08-27c` | **late August** |
| `9af1c695` | `tos-2026-08-27b` | `aip-2026-08-27c` | **late August** |
| `d0513497` | `tos-2026-08-24` | `aip-2026-08-24` | **late August** |

`a12541d0` holds no consent rows at all — never agreed to anything, never
finished intake. Not stale; incomplete. The notice does not apply to them.

**Five, not six** — the first draft of this section said six by counting
`a12541d0` among the stale, which is the same mistake this document exists to
stop: a number written from a glance rather than from the ledger.

And the correction that matters more than the count: the 09-09 bump did not
create this group, it **added two people to a group that already had three in
it**. `8bc672cb`, `9af1c695` and `d0513497` have been behind this gate since
late August, across two earlier policy changes. The oldest of them has 20
messages in their conversation — somebody who used the product, and has been
unable to get past the front door for two weeks without knowing it.

### The bug is what happened next

`ProtectedRoute` redirected to `/consent` **without recording where the person
had been going**, and `/consent` called `navigate('/intake')` afterwards,
hardcoded, under a button reading "Continue to intake".

So the path for a returning athlete was: open the app to talk to your coach →
be stopped by a screen you did not expect → agree → **be handed the intake form
you filled in weeks ago.**

There is no way to read that except "it lost my account". Fixed the same day:
the destination now travels with the redirect, the button says "Continue where
you left off", and `web/src/lib/afterConsent.js` refuses a destination that is
not same-origin, because a stored string turned into a navigation target is an
open redirect until it refuses to be.

### What this does not fix, and is a decision rather than a defect

**Five accounts are still holding a superseded consent and still do not know**
— though one of the five is the developer's own second account, so the real
number of PEOPLE to reach is four. They find out by opening the app. Most will
not open the app.

**Which of the four are real users is not answerable from these tables.** Two
developer accounts have already been found in a set of seven, one of them a day
late. Before writing to anybody, the accounts have to be identified by the one
person who knows — and that is a question to ask, not a thing to infer from a
signup date.

**The tool to tell them already exists** — `npm run policy:notice`, section 7 of
the daily runbook, with `--list`, a per-account `--user`, a separate `--send`,
and a reservation row written before the send so a re-run cannot double-mail.
It has never been used: `policy_notice_emails` is empty.

It could not have been used until today. Postmark was restricted to sending
within `coachdiaz.app` while approval was pending, so a notice run last week
would have been refused for every recipient on a public mail host. Approval
landed 2026-09-12, which is what turns a built tool into a usable one.

**And the instrument that found this only works going forward.** `activity_days`
began on 09-10, so "came back on 09-11" is visible and "came back on 09-03" is
not. The four accounts that went quiet in late August left no trace of whether
they ever returned.

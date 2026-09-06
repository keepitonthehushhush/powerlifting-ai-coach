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
       u.last_sign_in_at::date as last_seen,
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

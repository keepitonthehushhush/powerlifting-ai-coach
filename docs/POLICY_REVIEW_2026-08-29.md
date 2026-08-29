# Policy documents: pre-attorney engineering review

**Date:** August 29, 2026
**Reviewer:** engineering (not a lawyer — see the note immediately below)
**Documents reviewed:** Terms of Service `tos-2026-08-27b`, Consumer Health Data Privacy
Policy `chd-2026-08-28b`, AI Processing disclosure `aip-2026-08-28a`, Leaderboard
`lbp-2026-08-28a`
**Code reviewed at:** `feat/guardian-consent` @ `4a5f8e10`, plus this branch's two commits
**Database checked:** `coach-diaz-preview` (`jmoskrujmyepxukqzhrf`), migrations 0001–0037

---

## What this document is, and what it is not

**Nothing here is legal advice, and I am not a lawyer.** This review does not replace an
attorney's and is not meant to. It exists to make an attorney's hours cheaper by doing the
part that is engineering rather than judgment:

- **checking every factual claim these four documents make against the code and the live
  database**, and
- **listing what is absent**, so counsel spends time drafting rather than discovering.

Section D is the opposite: questions I am not qualified to answer, with the facts already
assembled so counsel does not have to go looking for them.

Where a finding says "verified," it means a query was run or a test was executed, and the
output is quoted. Where it says "believed," it is reasoning and should be treated as such.

---

## Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| A1 | Withdrawing health-data consent erased **nothing** for anybody who answered the gender or GLP-1 question | Critical | **Fixed** in `91af2e15`, needs deploy |
| A2 | "One other outbound request exists anywhere in this product" — there are two; Cloudflare Turnstile is the other | High | **Fixed** in `110a08b3`; version bumped to `chd-2026-08-29a` |
| A3 | "Health information is never written to application logs" — `gender` was not in the redaction list | Medium | **Fixed** in `91af2e15` |
| A4 | Leaderboard publishes seven columns to signed-in users, not the four the document lists | Medium | **Fixed** in `7ed6136b` (migration 0039, column grant) |
| A5 | Retention section discloses four expiring categories; the database has eight | Low | Document edit |
| A6 | HIBP "around a thousand candidates" — the implementation says roughly 800 | Low | Document edit |
| A7 | "Nothing is kept back for our own records" — anonymized audit rows survive deletion | Low | Document edit |
| C1 | **There is no general privacy policy at all** | High | Counsel to draft |
| C2 | **No payment, subscription, auto-renewal, or cancellation terms**, and Stripe is wired | High | Counsel to draft before the paywall flips |
| C3–C11 | No governing law, liability cap, warranty disclaimer, severability, indemnity, DMCA agent, CCPA notice, breach commitment, accessibility statement | High/Medium | Counsel to draft |
| C12 | Guardian consent has a version string and **no document** | Blocker for the minors feature | Counsel to draft |
| C13 | Three documents assert adults-only; the minors gate contradicts all three the day it is enabled | Blocker for the minors feature | Rewrite + re-consent |

---

# A. The documents say X; the code does Y

## A1 — Critical. Withdrawal did not erase health data. It erased nothing.

**The document says** (Consumer Health Data Privacy Policy, "Your rights"):

> **Withdraw consent.** At any time, from the same screen where you gave it. Withdrawing
> consent for health data collection also erases the health information already stored.

**What happened instead.** The database trigger `private.require_health_data_consent()`
permits a profile write when the new row's health fingerprint is `NULL` — meaning
"everything cleared" — or unchanged from the old one, meaning "nothing about health was
touched." The withdrawal path in `server/src/routes/consent.js` cleared six columns and left
three: `gender`, `gender_self_described`, `glp1_status`. So the new fingerprint was neither
null nor unchanged. The trigger correctly classified it as *storing* health data, correctly
found no active consent — it had just been withdrawn — and **refused the statement.**

It is one `UPDATE`, so the rejection rolled the other six columns back with it. The consent
record had already been written, in a separate request. The result:

- the ledger records the consent as **withdrawn**;
- the profile still holds the injury note, the sleep hours, the alcohol figure, the
  nicotine answer, the nutrition notes, the gender and the GLP-1 answer;
- the athlete gets an error telling them to contact support.

**Verified**, reproduced against the preview database in a rolled-back transaction:

```
1. withdrawal recorded on the ledger   OK - consent now reads WITHDRAWN
2. erasure of stored health data       FAILED: health data cannot be stored
                                       without active health_data_collection consent
3. what is still stored afterwards     gender=nonbinary, glp1_status=using,
                                       health_restrictions=left shoulder impingement,
                                       sleep=6.0
```

A control user with no gender and no GLP-1 answer erased cleanly, which is why this was
never noticed: it worked for everybody who skipped both optional questions.

**Cause.** Migration 0024 added `gender`, migration 0033 added `glp1_status`. Both were added
to the fingerprint. Neither was added to the withdrawal path. The comment sitting above that
list claimed `supabase/tests/rls_isolation_test.sql` asserted the two agree — it does not,
and never did.

**Fixed** in commit `91af2e15`. The clear now covers all eleven columns; verified against the
preview database that both the control user and a user with gender and GLP-1 set now erase
with nothing left behind. The new test derives its expectation from the schema's own column
comments and from the live fingerprint definition rather than restating a list, because a
test naming the six that were cleared would have agreed with the code for four months.
Confirmed to fail correctly by removing the gender lines again and watching it name them.

**Nobody was affected.** Queried against production before writing the cleanup:

```
profiles_total                            4
latest_decision_is_withdrawal             0
withdrawn_but_still_holding_health_data   0
```

No user has ever withdrawn health-data consent, so no data was stranded. Migration 0040
reconciles the state anyway — it is idempotent, the gap between writing and deploying is not
zero, and the same state can exist outside production — and the property becomes a standing
invariant asked of the rows rather than of the code: *a withdrawn health consent means no
health data is still stored*. Verified end to end on preview by manufacturing the stranded
state first, watching the invariant fail naming one profile, running the migration body, and
watching it pass.

**For counsel.** The document text was correct; the code was wrong, so **no version bump and
no re-consent is needed** for this one, and there is no notification question because there is
no affected user. Worth knowing anyway that Washington's MHMDA carries a private right of
action, and that this would have been a live exposure had anyone exercised the right.

## A2 — High. "One other outbound request" is two.

**The document says** (Consumer Health Data Privacy Policy, "Who we share it with"):

> For completeness, **one other outbound request exists anywhere in this product**, and it
> carries nothing about you. When you choose a password we check it against Have I Been
> Pwned's list...

**The code does** load a second third party. `web/src/lib/turnstile.js` injects
`https://challenges.cloudflare.com/turnstile/v0/api.js` on the sign-in and sign-up page, and
the widget then communicates with Cloudflare to run the bot check.

The neighboring sentence — "No third-party analytics or advertising scripts run on the pages
where this information is entered — or on any other page of this site" — **survives**, because
Turnstile is neither analytics nor advertising, and `web/index.html` was checked: the only
script it loads is the application's own bundle. It is the "one other outbound request"
sentence that is false.

**Recommended:** disclose Turnstile in the same paragraph, in the same style as the HIBP
paragraph — what it is for, what it receives, that it is not analytics and not advertising,
and that it runs on the sign-in page rather than on the pages where health information is
entered. Cloudflare's own documentation on what Turnstile collects should be read before the
sentence is written rather than after.

**Done** in `110a08b3`. The page now names Turnstile, says what Cloudflare receives — IP
address, TLS fingerprint, user-agent header, and our site key with its origin, per Cloudflare's
own Turnstile Privacy Addendum, which was read before the paragraph was written — and states
that it is neither analytics nor advertising and runs on the sign-in page rather than where
health information is entered. Version bumped to `chd-2026-08-29a`, so every existing
health-data consent goes stale and users are asked again, on the precedent set by
`chd-2026-08-27` and `aip-2026-08-27`.

## A3 — Medium. `gender` was not redacted from logs.

**The document says** (Consumer Health Data Privacy Policy, "How it is protected"):

> Health information is never written to application logs or error-reporting systems.
> Redaction happens automatically before anything is logged.

**Verified** that it did not. Running the real redactor:

```
{"gender":"nonbinary","gender_self_described":"agender", ...}
```

Migration 0024 declares gender health data; the policy lists it as consumer health data; the
logger's key list did not have it. This is the second occurrence of the same shape — sleep,
alcohol, nicotine and nutrition were in the same state until August 27.

No live leak was found: no call site currently passes a profile object to the logger, so the
promise held by accident rather than by mechanism. **Fixed** in `91af2e15`. `pronouns` stays
deliberately un-redacted and un-gated, and the new test pins that so a future broad fix cannot
quietly take it away.

## A4 — Medium. The leaderboard publishes seven columns, not four.

**The document says:**

> Exactly four things, to other signed-in users of Coach Diaz: [display name, three best
> lifts, units, position] ... the table the leaderboard reads has **no column** any of them
> could be put in without a database migration.

**Verified** against the live catalogue:

```
user_id        authenticated_can_read = true
display_name   true
best_squat     true
best_bench     true
best_deadlift  true
units          true
updated_at     true
```

Migration 0026 issues a table-wide `grant select on public.leaderboard_entries to
authenticated`, so every signed-in user can read every column of every row. Our own API is
clean — it selects named columns and `rankEntries()` returns only a handle and numbers — but
the browser holds a real JWT and can query PostgREST directly. The codebase says so itself, in
the invariant that exists because of exactly this reasoning: *"The browser holds a real JWT and
can reach PostgREST directly."*

What is additionally readable:

- **`user_id`** — the athlete's auth UUID. Opaque, but a persistent unique identifier, which
  is a defined category of personal information under CCPA and worth counsel's attention
  rather than mine.
- **`updated_at`** — when that athlete's best lift last changed, which is an activity signal
  about a person. It is selected by our API and **never used** by anything.

**Fixed** in `7ed6136b`. Migration 0039 replaces the table-wide grant with a column grant on
the five published columns, and `updated_at` is dropped from the route select where it was
used by nothing. Verified against the preview database: `user_id`, `updated_at` and
`select *` all return *permission denied for table leaderboard_entries*, while joining,
reading the board back and leaving all still work — the writers are `SECURITY DEFINER` and
unaffected by a revoke on `authenticated`. Two invariants now ask the catalogue rather than
the migration text, since a later `grant select on` would undo this and no file would look
wrong; both were confirmed to fail beforehand, naming `user_id` and `updated_at` exactly.

## A5 — Low. Four retention categories disclosed; eight exist.

The Retention section lists injury/medical (12 months), conversation messages (12), account
activity (24), and usage and cost (24). All four **verified correct** against
`retention_periods`, and the sweep is a real `pg_cron` job at `17 4 * * *`, so "these sweeps
run daily" is accurate.

The table also holds: `glp1_status` (12), `stripe_events` (3), `error_events` (6),
`guardian_email` (24, on the unmerged branch). `error_events` is the one worth a sentence: it
carries the user's id while the account exists, and it **is** included in the data export as
the person's own data — so the document treats it as personal data in one place and omits it
from retention in another.

Note also that `gender` and `gender_self_described` have **no automatic expiry at all** — the
sweep does not touch them. That is consistent with the document, which promises expiry only
for the categories it lists and says everything else is "kept until you delete your account or
withdraw the relevant consent." It is now true that withdrawal erases them (A1). Before A1 it
was not, and there was no other route.

## A6 — Low. "Around a thousand candidates."

The document says the HIBP range endpoint "returns around a thousand candidates." The
implementation's own note says "roughly 800 hash suffixes," padded to "a random 800-1000
records." "Several hundred" or "up to about a thousand" would be exact. Trivial, but this is
a document whose whole credibility rests on being precise about small technical facts.

## A7 — Low. "Nothing is kept back for our own records."

Terms, "Your account," lists what deletion removes and ends: *"Nothing is kept back for our own
records."* Migration 0030 deliberately keeps `audit_events` rows through account deletion with
`user_id` set to `NULL`, so that "an account was deleted at this time" survives — which is
almost certainly what counsel would want, and is the evidence that the deletion happened. The
design is right; the absolute sentence is wrong. Suggest: "Nothing that identifies you is kept
back," with one clause explaining the anonymized deletion record.

---

# B. Internal inconsistencies

**B1.** The Leaderboard document says *"The record that you agreed is kept, because we have to
be able to show that consent was obtained."* The Terms say that on account deletion *"your
record of consents"* is removed. Both are true — of leaving the leaderboard and of deleting
the account respectively — but a reader cannot tell that from either page. One clause each
way fixes it.

**B2.** The health-data document lists "whether a professional has cleared you to train"
among the information collected under health-data consent. `cleared_to_train` is deliberately
**outside** the database consent gate, for a mechanical reason now written into migration
0037: it is `NOT NULL`, so a fingerprint including it could never be null, and null is the
signal the trigger uses to recognize an erasure. Including it would make every withdrawal look
like a fresh collection and be refused — which is precisely the A1 bug. It **is** cleared on
withdrawal. The document is not wrong; counsel should simply know that the gate's boundary and
the document's list are not identical, and why.

**B3.** Version strings were checked and are consistent: `POLICY_VERSIONS` in
`server/src/lib/policyVersions.js`, the `policy_versions` table, and the version printed on
each page all agree, and `scripts/check-db-invariants.mjs` asserts the first two match
row-for-row. The four policy tests pass (31 assertions).

---

# C. What is missing entirely

These are gaps rather than errors — nothing here contradicts the code, because there is no
text to contradict it.

**C1 — There is no general privacy policy.** Four documents exist and all four are narrow:
terms, consumer health data, AI processing, leaderboard. Nothing covers the personal data that
is not health data: email address and password hash (Supabase Auth), request metadata at the
hosting layer, Stripe billing records, error events, display name. Washington's MHMDA requires
the consumer health data policy to be a *separate* document with its own link — a requirement
that presumes a general one exists to be separate from. **This is the largest single gap.**

**C2 — No payment, subscription, auto-renewal, refund, or cancellation terms.** Stripe
checkout and billing-portal routes are implemented in `server/src/routes/billing.js`; the
paywall switch is off today, so nothing is charged and nothing is currently misstated. Before
it flips, note that California's Automatic Renewal Law as amended (effective July 1, 2025)
requires express affirmative consent to the *auto-renewal terms specifically*, cancellation
that works entirely online "at will, and without engaging any further steps," renewal
reminders, and three-year record retention — with federal ROSCA alongside it. This is a
launch blocker for the paywall, not a nice-to-have.

**C3 — No governing law, venue, or dispute-resolution clause.** No decision either way on
arbitration or a class-action waiver.

**C4 — No limitation of liability.** The Terms carry one sentence — *"To the fullest extent
permitted by law, we are not liable for injury, loss, or damage arising from your use of it"*
— with no cap, no exclusion of consequential or indirect damages, and none of the
assumption-of-risk or waiver language a gym uses. This is a product that tells people how much
weight to put on a bar.

**C5 — No warranty disclaimer.** No "as is," no disclaimer of merchantability or fitness for
a particular purpose.

**C6 — No severability, entire-agreement, assignment, force-majeure, or survival clauses.**

**C7 — No user indemnity.**

**C8 — No DMCA designated agent or takedown process.** The exercise library links out to
third-party demonstration videos. (The no-embedding rule is honored — verified, nothing is
mirrored or hosted — which is the harder half.)

**C9 — No CCPA/CPRA material:** no notice at collection, no "we do not sell or share"
statement as a formal disclosure, no categories disclosure, no authorized-agent process, no
non-discrimination statement. Whether the thresholds are met is a question for counsel (D1).

**C10 — No breach-notification commitment to users**, and no user-facing security page.
`docs/SECURITY.md` is internal. (Separately: `docs/SECURITY.md` around line 388 still says
"Retention. Not yet implemented," which is false — migration 0031 implements it with a nightly
cron. Internal, but it should be corrected before anyone reads it as authoritative.)

**C11 — No accessibility statement.**

**C12 — Guardian consent has a version string and no document.** `GUARDIAN_CONSENT_VERSION =
'gc-2026-08-29a'` exists on the unmerged `feat/guardian-consent` branch. The codebase already
refuses to put it in `POLICY_VERSIONS` for exactly this reason, and `policyDocuments.test.js`
says so in as many words: *"users would be agreeing to nothing."* This is the same defect the
Terms of Service itself was created to fix — a consent record whose subject does not exist.
**It must not ship without a page behind it.**

**C13 — Three documents assert adults-only, and the minors gate contradicts all three.** The
Terms say it in six places, including:

> This service is for adults. By creating an account and using it, you confirm that you are
> 18 or over.

> We have not built a way for a parent or guardian to consent on your behalf, and until we
> have, you are not someone this service is for.

All six are **true in production today** — `MINORS_ENABLED` is off, and the gate refuses
under-18s. The day that flag flips, the Terms and the health-data policy become false
documents that every user has consented to. The rewrite, the version bump, and the re-consent
have to land **before** the flag moves, not with it.

---

# D. Questions I am not qualified to answer, with the facts assembled

**D1 — Scope.** Is Coach Diaz a "regulated entity" or a "small business" under MHMDA, and
does CCPA/CPRA apply? MHMDA has **no revenue or volume threshold** — it reaches any entity
conducting business in Washington or targeting products to Washington consumers, and the
compliance dates (March 31, 2024 for regulated entities, June 30, 2024 for small businesses)
have both passed. It carries a private right of action.
*Facts to hand counsel:* the full list of categories collected is in section A of the health
data policy and is verified accurate; consent is separate, pre-collection, opt-in, granular,
and withdrawable; there is exactly one recipient (Anthropic); there is no sale, no
advertising, and no analytics of any kind.

**D2 — Is the AI processing consent a *sharing* consent?** MHMDA § 19.373.030 distinguishes
*collecting* consumer health data from *sharing* it and requires separate, distinct consent
for sharing, with the request disclosing the categories of entities receiving it. Today,
`ai_processing` is a required consent and `health_data_collection` is a separate optional one;
the transfer of health data to Anthropic happens under the combination. Whether that
structure constitutes valid sharing consent — and whether the AI processing page's wording
reads as one — is a legal question. **I think this is the sharpest question in this document.**

**D3 — Deletion does not cascade to Anthropic.** RCW 19.373.040 requires that on a deletion
request the entity *"notify all affiliates, processors, contractors, and other third parties
with whom [it] has shared consumer health data of the deletion request,"* and those parties
must delete it too, within 45 days (extendable once). Health data is sent to Anthropic on
every coaching turn. **There is no mechanism in this product to notify Anthropic of a
deletion.** Whether one is required turns on whether Anthropic is a processor, a contractor, a
third party, or a service provider under a contract that already handles this — which is a
question about the Anthropic terms and about the statute, not about our code. Flagging it
because it is a real, concrete, unbuilt obligation if the answer is yes.

**D4 — Is the health-data consent "freely given"?** The reasoning is already written into
`policyVersions.js`: `health_data_collection` and `leaderboard_publication` are deliberately
*not* required, because a consent that gates something unrelated to its purpose is not freely
given; only `terms_of_service` and `ai_processing` are required, on the basis that the
coaching conversation *is* the product. This looks right to me and is worth a lawyer
confirming rather than an engineer asserting.

**D5 — Age.** Is 18 the right floor? The built-but-disabled design refuses under-13s outright
(`ABSOLUTE_MINIMUM_AGE = 13`, a COPPA line) and requires a guardian consent recorded by the
guardian following a link to their own address for 13–17. Note the COPPA amended Rule has been
in force since April 22, 2026, with penalties to $53,088 per violation. Whether guardian
consent obtained this way is sufficient, and whether verifiable parental consent is required
at all given the under-13 refusal, is for counsel.

**D6 — Professional liability.** The clearance gate stops program generation when an injury is
reported and no professional clearance is recorded, and it is enforced in code. Does that
mitigate exposure, or does it document knowledge of a risk? Genuinely unclear to me and it
cuts both ways.

**D7 — The backup claim.** The health data policy says deletion propagates out of backups
"within six months at the outside," which tracks RCW 19.373.040's six-month ceiling exactly.
The actual backup retention on the current Supabase plan is far shorter. Should the document
state the real period rather than the statutory maximum?

**D8 — The draft banner.** Every one of the four pages carries:

> **Draft — pending legal review.** ... It has not been reviewed by an attorney and should not
> be relied on as a final legal document.

Users are consenting to these documents *today*, in production. Does a recorded consent to a
document that describes itself as not final and not to be relied upon hold up? Does the banner
help — as candor — or hurt, by undermining the agreement it sits on top of? This was written
in good faith and it is the one thing in these documents I would most want a lawyer to rule on
before it stays another month.

---

# What changed in the code as a result of this review

Two commits, both on `fix/health-consent-withdrawal` work committed atop
`feat/guardian-consent` (see the note in the handover about `git checkout` over the file
bridge):

- **`84e706fe`** `chore(db): the two health columns the invariant could not see` — migration
  0037 re-comments `health_restrictions` and `glp1_status` to the convention the invariant
  searches on, documents why `cleared_to_train` stays outside the fingerprint, and adds the
  converse invariant (a column in the fingerprint whose comment does not say so). Coverage
  goes from six columns to eight; both directions verified green against the preview database.
- **`91af2e15`** `fix(consent): withdrawal did not erase health data, it erased nothing` —
  A1 and A3, with `server/test/healthWithdrawal.test.js` deriving its expectation from the
  schema rather than restating it.

`npm test` — 1606 passing, 0 failing. `npm run lint` — clean.

All six commits, in order:

| Commit | What |
|---|---|
| `84e706fe` | migration 0037 — the two health columns the invariant could not see |
| `91af2e15` | **A1 + A3** — withdrawal erased nothing; `gender` unredacted |
| `0a6c1cc1` | this review |
| `110a08b3` | **A2** — Turnstile disclosed, `chd-2026-08-29a` |
| `7ed6136b` | **A4** — migration 0039, leaderboard column grant |
| `8ea213c3` | **A1 cleanup** — migration 0040 and the standing invariant |

`npm test` — 1612 passing, 0 failing. `npm run lint` — clean. Four new database invariants,
all four confirmed to fail against the pre-fix state and pass after.

Everything in sections **C** and **D** is untouched and is the actual attorney work. **C1** (no
general privacy policy), **C2** (no payment terms behind a wired Stripe integration), **C12**
(guardian consent with a version and no document) and **C13** (three documents that go false
the day the minors flag flips) are the four that block something.

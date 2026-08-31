# Brief for counsel — Coach Diaz

**Date:** 2026-08-31
**Prepared by:** the engineering side, not a lawyer. Nothing in this file, and
nothing in the documents it describes, is legal advice.

---

## What this is for

Two documents were drafted to close the gaps the internal review
(`POLICY_REVIEW_2026-08-29.md`) listed as C1–C11:

| File | Serves |
|---|---|
| `web/src/pages/PrivacyPolicy.jsx` — **new**, `pp-2026-08-31a`, at `/policies/privacy` | C1, C9, C10 |
| `web/src/pages/Terms.jsx` — **revised**, `tos-2026-08-27b` → `tos-2026-08-31a` | C2–C8, C11 |

They are drafts written from the source code and the live database, not from a
template. Every factual claim in them is checked by a test against the thing it
describes, so they will fail the build before they can drift. What they have
**not** had is a lawyer.

This file exists so you are not reverse-engineering intent from prose. It lists
what was decided, on what basis, and what still needs a decision.

---

## Decisions already made, and who made them

The owner chose each of these. They are recorded so you can overrule them
knowingly rather than discover them.

**1. The contracting party is an individual, not a company.**
Eduardo Diaz personally, in Florida. There is no LLC. The documents say so
plainly rather than implying a corporate entity that does not exist.

> **The engineering view, offered as a flag rather than as advice:** this is the
> single largest exposure in the whole project, and it is not a software
> problem. This product tells people how much weight to put on a barbell, and
> it does so for people who have told it they are injured. An uncapped personal
> liability posture on that is worth raising before open signup, not after.

**2. Florida law, Florida venue, courts — no arbitration clause, no class
action waiver.**
Chosen deliberately over arbitration. The reasoning was that consumer
arbitration clauses draw scrutiny and require careful drafting to survive it,
mass arbitration has become its own cost, and at pre-revenue scale the clause
buys little. The Terms say *"There is no arbitration clause and no class-action
waiver"* explicitly, because silence is ambiguous and a position is not.
Easy to reverse — one section.

**3. Liability cap: the greater of fees paid in the prior twelve months, or
US$100.**
The $100 floor exists because almost every user currently pays nothing, and a
cap of "what you paid us" is a cap of zero. Carve-outs preserved for liability
that cannot lawfully be limited.

**4. Payment terms drafted now, before the paywall flips.**
Stripe is wired and off. The auto-renewal, cancellation and refund language was
written against California's amended ARL as the strictest likely standard —
express consent to the renewal terms specifically, cancellation in-app without
further steps, advance notice of price changes. **This is the section most
worth your time**, because it is the one that becomes live obligations the day
money moves, and the one where the drafting is least likely to be right.

**5. A 72-hour breach notification commitment to users.**
A promise, not a legal minimum. Chosen because a vague commitment is worth
nothing to a user. Please confirm it is one that can actually be met by a
single operator, and whether it should be softened to "without undue delay" —
overpromising here creates the liability rather than reducing it.

**6. Two documents were corrected rather than extended, and both triggered
re-consent.**
The Terms said account deletion keeps *"nothing back for our own records."*
That was false: audit rows survive with the user id nulled, and Stripe keeps
its own transaction records. Both are now named. The version bump means every
existing user is asked to agree again — the consent gate fails closed, so this
is enforced by the database rather than by anyone remembering.

---

## What still needs a decision

**D1 — Entity.** Form an LLC before open signup, or accept personal exposure?
Everything else here is downstream of that answer.

**D2 — Are the injury and clearance provisions enough?**
The product refuses to write a program for an athlete reporting unresolved pain
until they confirm a professional cleared them. That gate is enforced in code
and tested. Is a gate plus an assumption-of-risk section sufficient, or is a
separate signed waiver wanted, and is one enforceable for a service delivered
entirely online?

**D3 — Is the general-wellness position still right?**
`LEGAL_CONSIDERATIONS.md` argues the product sits on the FDA's general-wellness
side of the line and lists the coach utterances that would move it across.
Those rules are enforced in the system prompt and graded by an automated safety
evaluation on every change. Worth confirming the line is drawn where you would
draw it.

**D4 — Minors.** A guardian-consent feature exists on an unmerged branch and is
deliberately not shipped. Three documents currently assert adults-only. Those
assertions become false the day the feature flips, so the rewrite and
re-consent must land *before* the flag moves, not with it. Nothing is needed
now; it is here so it is not discovered later.

**D5 — The draft banners.** Every policy page carries *"Draft — pending legal
review."* Users are consenting to documents that describe themselves as
provisional. The review flagged this (D8). It should come off when you are
comfortable, and it is the clearest single signal that this work is finished.

**D6 — Anthropic's terms.** The coaching output is generated by a third-party
model under that provider's terms. Whether anything there needs to flow through
to end users has not been analyzed.

**D7 — International users.** The documents say the service is offered in the
United States and data is processed there. No GDPR or UK GDPR position has been
taken. If EU or UK users are wanted, that is a separate piece of work.

---

## Things you should know that a normal review would not surface

**The documents are enforced by tests, not by good intentions.** There are
suites (`privacyPolicy.test.js`, `policyDisclosure.test.js`) that compare each
document against the code and the schema: retention periods against the rows
the database sweeps, disclosed data fields against the actual profile columns,
the third-party list against the hosts the application contacts. Adding a
retention rule without disclosing it fails the build. If you change the prose,
some of those tests will need changing with it — that is the mechanism working.

**Version bumps are load-bearing.** Policy versions live in
`server/src/lib/policyVersions.js` and in a `policy_versions` table the
database reads. Changing a document's text without bumping its version silently
leaves every consent on file pointing at a document that no longer exists in
that form. If you revise these drafts, the version must move.

**The audit trail can answer "who said a doctor cleared them."** Every
clearance assertion is recorded with a timestamp and survives account deletion
in de-identified form. That is deliberate and is the record that would matter
in an injury claim.

**There is a known-honest inventory of what the product does.** `A1`–`A7` in
the policy review are places where a document once said something the code did
not do. Five are fixed in code; the two remaining were document errors, and
both are corrected in this pass.

---

## Files worth reading, in order

1. `web/src/pages/PrivacyPolicy.jsx` — the new document
2. `web/src/pages/Terms.jsx` — the revised one, new sections from "Paid plans" down
3. `docs/POLICY_REVIEW_2026-08-29.md` — the gap analysis these answer
4. `docs/LEGAL_CONSIDERATIONS.md` — the research behind the product decisions
5. `web/src/pages/HealthDataPolicy.jsx` — the MHMDA document, unchanged in this pass

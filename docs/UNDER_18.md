# Coaching 13–17 year olds

**Status: design, not yet built. Not legal advice, and not written by a lawyer.**
This document is the plan and the reasoning behind it. It exists to be argued
with before any of it is code, because the parts that are wrong are much
cheaper to fix here.

## What is being decided

Today `MINIMUM_AGE = 18` and the API refuses anyone younger — a decision taken
deliberately, and for the honest reason: collecting health information from a
minor needs a consent mechanism aimed at their parent, and there was not one.

The scope now chosen is **13 to 17, United States only.** Under-13 stays
excluded permanently, and that is not squeamishness — see below.

## Why under-13 is not on the table

COPPA's amended Rule has been in full force since 22 April 2026, and it reaches
any operator with actual knowledge that it collects personal information from a
child under 13. Serving one 12-year-old would pull this whole product into a
regime requiring, at minimum:

- verifiable parental consent, in one of the FTC's approved forms — not an
  email tick-box;
- a **written information security program** with designated personnel, annual
  risk assessments, documented safeguards, regular testing of those safeguards,
  and annual evaluation;
- a written retention policy with deletion timeframes, where indefinite
  retention is expressly prohibited;
- **distinct** parental consent before any disclosure to a third party that is
  not integral to the service — a single bundled consent is no longer enough.

Civil penalties run to $53,088 per violation. That is a different product with
a compliance function attached, and under-13 barbell coaching through an app is
the narrowest and riskiest slice of the market anyway. The gate keeps a hard
floor at 13 and the refusal for anyone younger stays exactly as it is.

Choosing US-only also keeps this outside **GDPR Article 8**, where the digital
consent age is 16 by default and each member state may lower it to as far as
13 — which would make the gate per-country rather than per-age — and outside
the UK's Age Appropriate Design Code, which imposes design duties well beyond
consent. Those are a later decision, made on purpose rather than by accident.

## The part that is not about law

A 13-year-old is not a small adult, and this is where the product risk actually
lives. The NSCA's position statement is unambiguous on the two things that
matter most here:

- **"A properly designed and supervised resistance training program is
  relatively safe for youth."** The fear this product will meet most often —
  that lifting stunts growth or damages growth plates — is not supported:
  *"injury to the growth cartilage has not been reported in any prospective
  youth resistance training research study."* The coach should be able to say
  that plainly, because a parent will ask.
- **Supervision is a requirement, not a nicety.** Qualified adult supervision
  appears in every one of the safety conditions, and "training without
  qualified supervision" is named as *not* recommended.

That second point is the uncomfortable one, and it has to be faced rather than
buried in a checkbox. **This product is unsupervised by definition.** It writes
a program and the person goes and does it alone. For an adult that is their
call; for a 15-year-old it is the parent's, and the consent has to say so in
those words rather than in a paragraph nobody reads.

### The tension at the center of the product

The recommended youth protocol is **1–3 sets of 6–15 repetitions** for strength
and **1–3 sets of 3–6** for power, with load increased **5–10%** as strength
improves. Powerlifting is the sport of the one-repetition maximum. Those two
things are in genuine tension, and the resolution is not to pretend otherwise:

**For a 13–17 year old the coach programs submaximal strength work with a
technical focus, and does not program or encourage maximal singles.** Not a
softer version of the adult product — a different emphasis, which is what
"do not treat youth as miniature adults" actually means. If they are competing,
the meet is the meet; the training does not have to rehearse it weekly.

This belongs in the prompt as its own section, computed and handed over rather
than left to the model to infer from an age field it might not weigh heavily.

## The design

### 1. The gate learns a second question

`ageGate.js` already anticipates this: *"when the rule changes — and this one
will, the moment a parental consent path exists — there should be exactly one
edit."* It stays one edit. `adultGateDecision` becomes a decision with three
outcomes rather than two:

| age | guardian consent | outcome |
| --- | --- | --- |
| < 13 | — | refused, permanently, as today |
| 13–17 | absent or withdrawn | refused, with a route for a guardian to consent |
| 13–17 | active and current | allowed, and the profile is marked as a minor |
| 18+ | — | allowed, as today |

It keeps failing closed on an unreadable or missing date, for the reason it
always has.

### 2. Consent is a ledger entry, not a flag

The `consent_records` table already exists, is append-only, is ordered by a
monotonic `seq`, and already invalidates every consent on a policy version bump.
A guardian consent is another `consent_type` in it — `guardian_consent` — which
means withdrawal, re-consent after a policy change, and the audit trail all work
on day one without new machinery.

What the record needs beyond the existing columns is the guardian's email, so
there is something to notify and something to withdraw from. That is a new
column and it is personal data about a **third party** who never signed up,
which means it gets the same treatment as everything else here: minimized, not
logged, covered by RLS, in the export, and in the retention sweep.

### 3. What "verifiable" means when COPPA does not apply

Outside COPPA there is no prescribed method, and pretending an email round-trip
is identity verification would be dishonest. What it does do is create a real
record that a real adult at a real address was told what this is and agreed —
which is the obligation that actually attaches, and it is the same honest
position the age gate already takes about self-reported birth dates:

> It is not identity verification. A self-reported birth date is trivially
> falsified, and no age gate anywhere solves that.

The proposed flow: the minor enters a guardian email; the guardian receives a
message describing what the product does, what it collects, that it is
unsupervised, and that they can withdraw at any time; consent is recorded when
they follow the link. Supabase's free plan includes custom SMTP, so this needs
no paid tier.

### 4. What the coach is told

A new computed field in the prompt's athlete state — not "age: 15" left to be
weighed, but an explicit instruction set, in the same style as the clearance
gate and the rest of the computed-not-prompted rules (ADR-2):

- submaximal work, technical focus, no programmed maximal singles;
- 5–10% progression, the youth rep ranges above;
- say plainly and without hedging that supervised training is safe for their
  age, and that the growth-plate fear is not supported by the evidence, if it
  comes up;
- an adult is responsible for supervision, and the coach should say so once
  rather than nagging;
- never discuss body composition, cutting, or weight classes with a minor
  unprompted — the existing disordered-eating safeguards get *stricter* here,
  not the same.

### 5. What has to change everywhere else

- **Paywall ordering.** The adult gate already runs before the paywall so a
  minor is never shown a subscribe button. That property must survive: a minor
  with guardian consent is now *allowed*, so the ordering assertion needs
  rewriting rather than deleting, and it should be checked by source position
  the way it is today.
- **The leaderboard.** Publishing a minor's name and lifts to other users is a
  different question from publishing an adult's. The simplest defensible answer
  is that minors cannot opt in at all, and that is what is proposed.
- **Retention.** A guardian email is personal data with no purpose once the
  account is 18 or the consent is withdrawn. It gets a `retention_periods` row
  and a line in `apply_retention()` — and, given 0035, a test that the sweep
  can actually run.
- **The policy documents.** Terms and the health-data policy both currently say
  this service is for adults. They stop being true the day this ships, and the
  documents and the code disagreeing is the exact failure that produced the
  adult gate in the first place.

## What this does not do

It does not verify anybody's age or anybody's parenthood. It does not make the
product supervised. It does not remove the need for an attorney to read the
Terms and the health-data policy before this is enabled — that review was
already outstanding and this makes it more necessary, not less.

And it is not switched on by writing the code. Like the paywall, it should be a
setting that is off until somebody decides to turn it on.

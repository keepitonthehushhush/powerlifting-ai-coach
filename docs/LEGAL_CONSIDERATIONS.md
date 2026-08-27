# Legal and Regulatory Considerations

**This is not legal advice.** It is engineering research, written by a
non-lawyer, to identify which decisions carry legal weight and which must be
reviewed by an attorney before launch. Every item marked **ATTORNEY** below is
a question this document cannot answer.

The short version: the largest exposure in this product is not the training
programs. It is (a) storing health data, and (b) the line between *coaching*
and *practising medicine* — a line regulators have recently shown they will
enforce against AI products using laws written long before AI existed.

---

## 1. The line that matters most: wellness versus medicine

### What the FDA general wellness exemption buys, and what forfeits it

An app is exempt from medical device regulation when it is intended **only for
general wellness** — fitness, sleep, stress, mental acuity — and is low risk.
Claims that reference diagnosing, screening, detecting, treating, relieving or
mitigating a disease or condition push it across into device territory,
"regardless of marketing language". Even hedged phrasing like *"flagging
possible early signs"* draws scrutiny.

**What this means concretely for Coach:**

| Coach says | Status |
|---|---|
| "Squat 3x5 at RPE 7, add 5 lb next session" | General wellness. Fine. |
| "Bracing protects your spine under load" | General education. Fine. |
| "Here's what to expect at a PT appointment" | Navigation help. Fine. |
| **"Try these stretches to relieve your back pain"** | **Treating a condition. Crosses the line.** |
| **"Ice it for 20 minutes and take an NSAID"** | **Treatment advice. Crosses the line.** |
| **"Squatting is safe for you as long as it doesn't hurt"** | **Clinical clearance judgment. Crosses the line.** |

The distinction is not how confident the advice is or how well-sourced. It is
whether the product is **acting on a health condition**. "Medically backed"
stretches for an undiagnosed injury are still treatment for an undiagnosed
injury.

### Pennsylvania v. Character Technologies — why disclaimers are not enough

In 2026 Pennsylvania's State Board of Medicine sued Character Technologies
alleging its chatbot engaged in the **unauthorized practice of medicine** under
the state Medical Practice Act. The chatbot had claimed to be a psychiatrist,
represented itself as the user's provider, and said it could prescribe.

Three findings matter for this project:

1. **Pennsylvania had no AI-specific law.** Regulators applied an existing
   professional licensure statute. Every state has one. Assuming "there's no
   law about AI coaching yet" is not a defence.
2. **The company had prominent disclaimers in every chat, and it did not
   protect them.** Regulators "examined the actual user experience rather than
   relying on boilerplate warnings."
3. The recommended mitigation is **technical guardrails** — building the
   product so it cannot behave as a clinician — not louder warnings.

That third point is the argument for enforcing the clearance gate in code
(`needsMedicalClearance()`) rather than trusting the model to remember a rule.
It is a legal argument as well as an engineering one.

**ATTORNEY:** whether a strength-programming AI touches the practice-of-medicine
statutes in each state we operate in, and what the specific carve-outs are for
fitness professionals.

---

## 2. Health data: which laws actually apply

### HIPAA almost certainly does not apply

HIPAA binds covered entities — providers, plans, clearinghouses — and their
business associates. A direct-to-consumer fitness app is none of these. **This
is not reassurance.** It means the data is unprotected by HIPAA while still
being health information, which is exactly the gap the laws below were written
to close.

**ATTORNEY:** confirm no relationship with a provider or insurer creates
business-associate status.

### Washington's My Health My Data Act — the strictest common denominator

The most demanding law that plausibly reaches this product:

- **No revenue or user threshold.** A hobby project with one Washington user is
  a regulated entity.
- **Reaches out-of-state companies** that offer services to Washington
  consumers. Being based elsewhere is irrelevant.
- **Fitness apps are explicitly in scope.** Consumer health data covers
  "past, present or future physical or mental health status", including
  inferences drawn from non-health data.
- **Separate opt-in consent** is required before collecting, and again before
  sharing. One combined "I agree to the terms" checkbox does not satisfy this.
- **Private right of action** through the state Consumer Protection Act.
  Plaintiffs must prove actual damages — there are no statutory damages, which
  limits class actions, but does not eliminate individual suits.

Nevada has a comparable law. Several other states have consumer health data
provisions.

### FTC Health Breach Notification Rule — federal, and it applies

The updated Rule expressly covers **health and fitness apps not covered by
HIPAA**. Two features matter:

- A "breach" includes **unauthorized disclosure**, not just hacking. Sending
  health data to an advertising platform is a reportable breach. The FTC has
  enforced this against GoodRx and Easy Healthcare.
- Notification within **60 days**; the FTC must be notified simultaneously for
  breaches affecting 500+ people. Violations carry civil penalties.

**This has a direct architectural consequence.** Adding an analytics SDK, an ad
pixel, or a session-replay tool to a page where injury data is entered could
itself constitute a reportable breach. The current build has no third-party
scripts on the intake form, and that should be treated as a compliance
constraint rather than a stylistic preference.

### What the current build already does right

| Requirement | Status |
|---|---|
| Data minimisation | Only fields the coach actually uses |
| Access control | RLS, verified against 11 attacks (`SECURITY.md`) |
| Not sent to third parties | Health data goes to Anthropic for coaching only; nothing else |
| Not in logs or error tracking | Centralised redaction (`lib/logger.js`, `lib/monitoring.js`) |
| Right to access | `GET /api/account/export` |
| Right to delete | `DELETE /api/account`, cascade purge verified |
| No sale of data | No mechanism exists |

### The 2026-08-27 disclosure audit

The three policy documents were checked line by line against the schema and
the code that builds the model request, rather than against each other. Four
divergences came out of it, all of them the same shape: **the code moved and a
paragraph did not.**

| Found | Document said | Code did |
|---|---|---|
| Four undisclosed health fields | Health policy listed injuries only | Also stores `sleep_hours_typical`, `alcohol_units_per_week`, `nicotine_use`, `nutrition_notes` under that consent |
| Age sent to the model | "Your date of birth … is not sent to the model" | The date is not; the **age derived from it** is, and the prompt has a section instructing the coach to program around it |
| Under-18 enforcement | "Accounts are refused where the date of birth given indicates the person is under 18" | Nothing refuses an account. The gate blocks **storing health data**, and fails closed when the date is unknown |
| Data export completeness | "everything this application stores about you" | Omitted `consent_records` and `usage_events` |

All four are fixed, all three documents are versioned `-2026-08-27`, and every
consent on file is now stale, so users are asked again. The bump is the point:
agreement to a document that did not describe what we collect is not agreement
to collecting it.

Two things are worth recording about *how* they were found, because the
lesson generalises. The first is that the existing structural tests
(`policyDocuments.test.js`) passed throughout — they checked that a document
exists, is routed, is readable without an account, and carries the version the
ledger records. Every one of those can be true of a document that is wrong.
`policyDisclosure.test.js` now holds each page to the schema and to
`renderProfile()` instead, so a column that reaches the model without a mapped
disclosure fails the build and the failure names the column.

The second is that the age finding is the one that would matter in an
enforcement action. "The date of birth is not sent" was true about the field
and silent about the inference drawn from it. MHMDA's definition of consumer
health data explicitly reaches **inferred** data, and a disclosure that is
accurate at the column level while being misleading at the level of what is
actually known about the person is the pattern these statutes were written
for.

### What the age gate does and does not buy

Written by an engineer, not a lawyer, and this is the section most in need of
review.

**What changed.** Until 2026-08-27 the terms said the service was for adults
and nothing refused an account: the gate blocked storing health data below 18
and let coaching through. The documents and the code disagreed, and the code
was what people were using. Now:

| Control | Where it lives |
|---|---|
| Coaching refused below 18, and when no date of birth is on file | `routes/chat.js`, server-side, fails closed |
| Health and lifestyle data refused below 18 | `routes/profile.js`, unchanged, fails closed |
| Explicit representation of age by the user | Terms, `tos-2026-08-27b` |
| Statement that we do not and cannot verify it | Terms |
| False date of birth is a breach | Terms |
| Deletion on being told an account belongs to a minor | Terms; the mechanism is the existing cascade purge |

**What this does not do is make anyone not liable, and the terms do not claim
it does.** No disclaimer achieves that. What these controls do is make the
position defensible on the thing that is actually tested: COPPA and the state
analogues turn on **actual knowledge**, so what matters is that the product
does not knowingly collect from minors, that a date was asked for and acted
on, and that a report is honoured when one arrives. A takedown route that is
used is worth more than any wording that is not.

**The gap that remains** is narrower than it was. The address exists in the
code and in the runbook; what has not happened is mail actually arriving at
it. That distinction is deliberately load-bearing: `CONTACT_LIVE` records an
arrival, not an intention, and the documents refuse to print the address until
it flips. A commitment nobody can invoke is not a commitment, and an address
that bounces is worse than none because it looks like one.

A personal address was the faster option and was refused: an address in a
public legal document is scraped within days, and once people have consented to
a document naming it, changing it means a version bump and re-consenting
everyone. A forwarder costs five minutes and can be repointed forever.

**Verification was considered and rejected.** The only method that actually
verifies age is collecting government identity documents, which would be a far
larger collection of personal information than anything else this product
holds, from every user, to catch the small number who lie. That trade is worse
for everyone. Recorded here so the decision is visible rather than assumed.

### Affiliate revenue on equipment: considered and declined

**Decided 2026-08-27: not doing it.** Raised as a second revenue stream — earn a
commission on the belts and sleeves the coach recommends — analysed, and
dropped. The reasoning is kept in full below rather than deleted, because the
idea is an obvious one that will occur to somebody again, and the numbers are
most of the argument against it.

**The money is smaller than it sounds.** Sports-equipment affiliate rates run
around 3%. A belt is $50–150, so roughly $1.50–4.50 a sale. Suppose 1,000 users
and an optimistic 5% buying a belt through a link in their first year: about
**$150 a year**. The subscription already decided on — free logging, paid
conversations — at even $8/month against those same 1,000 users is a different
order of magnitude entirely. Affiliate income here is a rounding error on the
business, and it is being weighed against the following costs.

**It puts a financial interest inside the coaching.** Every other recommendation
this product makes is defensible as "what this athlete needs". The moment one
of them earns money, all of them are open to the question of whether they were
chosen for that reason — including the ones that were not. That is the asset
being spent, and it is the same asset the subscription is sold on.

**It contradicts a promise already made and consented to.** The consumer health
data policy says, in terms, that no advertising or analytics scripts run on any
page of this site. Affiliate links carry click tracking and cookies by
construction; the standard programmes require it. Adding them means editing
that sentence, bumping `chd`, and asking every existing user to consent again —
to a weaker promise than the one they originally agreed to.

**It is a disclosure obligation, not just a link.** The FTC's Endorsement Guides
require a clear and conspicuous disclosure of a material connection, at the
point of the recommendation. In a chat interface that means the coach itself
disclosing, in the same message, every time — which is both correct and a
constant reminder to the athlete that their coach is on commission.

**And it is the ads argument again in different clothes.** The earlier decision
against advertising rested on MHMDA's private right of action plus the FTC's
GoodRx and BetterHelp actions, and on the fact that the privacy positioning is
load-bearing for this product. An affiliate link is an advertisement with a
different payment model.

**If it is ever revisited**, the shape that would survive the above:

- a separate, clearly labelled gear page, never inside a coaching reply;
- the coach may mention that the page exists, once, and never links a specific
  product to a specific athlete's situation;
- disclosure at the top of that page and beside every link;
- no tracking pixels — plain outbound links with a partner tag, nothing that
  sets a cookie on our origin;
- the health data policy amended honestly and the version bumped.

**What is built instead**, and what the FAQ now states: the coach describes what
to look for — belt thickness, width, fastening, federation approval — and names
no brands. That is better coaching regardless of revenue, because a
specification survives a product going out of stock, and it is the same rule
already applied to supplements.

### Gym chains and the decision not to store a location

The intake form now offers commercial gym chains as checkboxes, which pre-fill
the equipment answer. Two choices worth recording:

**The chain names are used nominatively** — to describe where a person trains —
and the suggested equipment text is explicitly presented to the user as a
starting point they correct, not as a statement about any company's premises.
No claim is made about any specific location, the text is editable, and what is
stored and sent to the model is the user's own final answer. This matters
because asserting "this chain's gyms contain X" as fact would be a factual
claim about a third party's business that varies by franchise and by year.

**A precise location is deliberately not collected.** The feature request asked
for a specific gym location. What is stored instead is a free-text label the
user types for their own reference. There is no address field, no geocoding, no
map and no geolocation API anywhere in the product, and a test asserts as much.
The reasoning: no chain publishes per-branch equipment lists, so an address
would buy no programming accuracy, while precise geolocation stored beside
injury data is a named sensitive category under MHMDA and materially worse in a
breach. Collecting it would have been cost with no benefit.

### A production bug the audit surfaced

Checking the export against the schema turned up that `usage_events` had RLS
policies but **no table grant** — RLS narrows a granted privilege, it does not
create one — so every insert had been refused since the table was created, and
it held zero rows against real conversations. Not a privacy defect; the table
holds no message content. But it is the input to every pricing decision, and
it was answering with silence. Fixed in migration 0021.

### What is missing before launch

1. **Separate, granular consent at signup** — one checkbox for collecting
   health data, worded specifically, not bundled into the terms of service.
   MHMDA requires this and the current signup does not do it.
2. ~~A dedicated Consumer Health Data Privacy Policy~~ — **done**, at
   `/policies/health-data`, with its own consent type and version string.
   Draft, unreviewed.
3. ~~A privacy policy and terms of service at all~~ — **done**, both drafted
   and both audited against the code on 2026-08-27. Still unreviewed by an
   attorney, and each says so on its face.
4. **A documented retention period.** Data is currently kept until the user
   deletes it.
5. **Deciding whether to geo-gate.** Serving only some states reduces exposure
   but is itself a decision with legal consequences.
6. ~~A decision on under-18s.~~ **Done 2026-08-27**: coaching is refused below
   18 on the server, and the terms carry the representation, the
   non-verification statement and the takedown commitment. The **contact
   address** is chosen and wired — `privacy@coachdiaz.app`, forwarded rather
   than a personal inbox, so it can be repointed later without a version bump
   and a re-consent. It is not yet live: `CONTACT_LIVE` in
   `web/src/lib/contact.js` stays `false` until a test email has actually
   arrived, and while it is false every document prints the Account-page route
   instead and says an address is being set up. A test asserts they cannot
   print an address that does not work. **Flipping that flag is the last item
   blocking a wider share.**
7. **Attorney review of all three documents.** Nothing below the draft banner
   should be relied on until this happens.

---

## 3. Liability for physical injury

### Waivers help, but less than people assume

Enforceability varies by state. Some states are hostile to exculpatory
agreements in consumer contracts; Louisiana in particular is unusually
unfriendly to them. Two limits are close to universal:

- **Waivers do not cover gross negligence or recklessness** anywhere.
- A waiver buried in a scroll-through terms page is weaker than an explicit,
  separately-acknowledged one.

The practical read: a waiver is worth having and is not a substitute for the
product behaving safely. If a lifter is injured following a program the app
generated while it knew about an untreated injury, the waiver is the second
argument, not the first.

**ATTORNEY:** draft the waiver and terms; advise on state-by-state
enforceability and whether to restrict operation in specific states.

### Where the product design does the real work

Every one of these is already built, and each is a defensive argument:

- The clearance gate is **computed in code**, not left to model judgment, so
  its behaviour is deterministic and testable.
- It is **enforced in the UI as well as the conversation** — the intake form
  shows the requirement at the point of data entry.
- Its behaviour is covered by **unit tests and a live adversarial eval**, with
  results recorded in `docs/BUILD_LOG.md`.
- The prompt forbids diagnosis and programming around undiagnosed pain, and
  the eval checks that it holds under pressure.

Being able to show that safety behaviour was specified, implemented,
adversarially tested, and version-controlled is materially better than
asserting the product "has a disclaimer".

---

## 4. On checking each user's state law at signup

The instinct is right — the exposure genuinely does vary by state — but
per-user legal branching is the wrong implementation, for three reasons:

1. **Applying the law is itself a legal judgment.** Code that decides "this
   user is in Ohio, therefore rule X" encodes a legal conclusion the company
   would have to defend.
2. **Location is unreliable.** IP geolocation is approximate, users travel, and
   VPNs exist. MHMDA reaches consumers Washington considers its own regardless
   of where the request originated.
3. **The strictest rule usually wins anyway.** Building to MHMDA plus the FTC
   Rule satisfies most other regimes, and it is far cheaper than maintaining
   fifty variants.

**The practical version, in order of cost:**

| Step | Effort |
|---|---|
| Build to the strictest standard (MHMDA + FTC HBNR) for everyone | Design decision |
| Collect state at signup, for the record and for future notification duties | Small |
| Have an attorney review before public launch | Real, and non-optional |
| Geo-gate specific states if counsel advises | Moderate |

---

## 5. Recommended behaviour when an injury is reported

The design goal — stay useful rather than shutting the conversation down — is
achievable, and is compatible with the constraints above. What Coach must not
do is act on the injury.

**Coach may, with an unresolved injury:**

- keep talking, and answer general training questions
- explain what a physiotherapy or doctor's appointment usually involves, and
  help the athlete prepare what to describe — when it started, what movement
  provokes it, whether it radiates
- explain training concepts in general terms — bracing, RPE, why progression
  works — as education, not prescription
- discuss what programming will look like *once cleared*, including how it
  would adapt to restrictions a professional might set
- say plainly that it wants to keep working with them and is not dismissing them

**Coach must not, with an unresolved injury:**

- suggest stretches, mobility work, "corrective" exercises, or rehab movements
- suggest ice, heat, medication, supplements, or any other symptom relief
- state or imply which lifts are safe to continue — including the softer
  "as long as it doesn't hurt", which asks an untrained person to clinically
  self-assess a loaded spinal movement
- estimate severity, likely cause, or expected recovery time

The distinction to hold onto: **navigation and education are fine; treatment
and clearance are not.** "Here's what to tell the physio" is help. "Here's what
will make it feel better" is treatment.

---

## 6. Open questions for counsel

1. Does an AI producing individualised strength programming implicate
   practice-of-medicine or scope-of-practice statutes in our operating states?
2. Is MHMDA-level compliance sufficient nationally, or are state-specific
   obligations needed?
3. Terms of service, privacy policy, consumer health data privacy policy, and
   assumption-of-risk waiver — all need drafting.
4. Does anything in the product's framing risk FDA medical device
   classification?
5. Insurance: is professional/general liability coverage appropriate, and at
   what stage?
6. What retention period is defensible, and what triggers deletion?
7. ~~Minors: age-gate, or accept and comply?~~ **Decided 2026-08-27: gate.**
   Coaching now requires a date of birth showing 18 or over, checked on the
   server in `routes/chat.js` via `adultGateDecision`, not in the browser. The
   terms carry an explicit representation of age, state that we cannot verify
   it, make a false date a breach, and commit to deleting an account on being
   told it belongs to a minor. See "What the age gate does and does not buy"
   below. The remaining question for counsel is narrower: **is a self-reported
   date of birth with a stated non-verification and a takedown route the right
   standard for a fitness product holding health data, or is more required?**
8. Nutrition: the coach gives general nutrition information — protein and
   carbohydrate ranges by bodyweight, rate-of-loss guidance — and never a
   calorie target, which is enforced in code (`lib/nutrition.js` returns no
   calorie figure and a test asserts it). US states run three tiers of
   dietetics regulation, from licensure (Alabama) through statutory
   certification to nothing at all (Arizona). **Does the general-information
   line hold in the licensure states, and does an AI delivering it change the
   analysis?**
9. Advertising: the decision has been made not to run ads, on the reasoning
   that MHMDA's private right of action plus the FTC's GoodRx and BetterHelp
   actions make health-data-adjacent advertising a poor risk at any revenue.
   **Is that reading right, and does it hold for non-targeted advertising
   that touches no health data?**
10. The clinician page (`/about`) describes the product's capabilities for a
   doctor or physiotherapist to read. **Does addressing a clinician change the
   product's regulatory posture** — does it read as marketing to a healthcare
   professional, and does that pull it any closer to a device claim?
11. Disclosure drift: consents are invalidated by a version bump, and every
   material correction therefore re-prompts every existing user. **Is a
   correction that only makes an existing practice explicit a material change
   requiring re-consent, or does re-prompting on every clarification devalue
   the prompt?** We chose to re-prompt. Confirm that is the right default.

---

## Sources

- [FTC — Updated Health Breach Notification Rule](https://www.ftc.gov/business-guidance/blog/2024/04/updated-ftc-health-breach-notification-rule-puts-new-provisions-place-protect-users-health-apps)
- [Clark Hill — Washington My Health My Data Act and its private right of action](https://www.clarkhill.com/news-events/news/its-here-the-who-what-and-how-of-washingtons-new-my-health-my-data-act-and-its-private-right-of-action/)
- [Troutman Pepper Locke — Pennsylvania targets AI chatbot for the unauthorized practice of medicine](https://www.troutman.com/insights/pennsylvania-targets-ai-chatbot-for-the-unauthorized-practice-of-medicine/)
- [Hogan Lovells — AI wellness or regulated medical device: navigating FDA rules](https://www.hlc.com/en/publications/ai-wellness-or-regulated-medical-device-a-lawyers-guide-to-navigating-fda-rulesand-what-could)
- [Matthiesen, Wickert & Lehrer — Exculpatory agreements and liability waivers in all 50 states](https://www.mwl-law.com/wp-content/uploads/2018/05/EXCULPATORY-AGREEMENTS-AND-LIABILTY-WAIVERS-CHART.pdf)

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

### What is missing before launch

1. **Separate, granular consent at signup** — one checkbox for collecting
   health data, worded specifically, not bundled into the terms of service.
   MHMDA requires this and the current signup does not do it.
2. **A dedicated Consumer Health Data Privacy Policy**, separate from the
   general privacy policy, as MHMDA requires — with its own link.
3. **A privacy policy and terms of service at all.** Neither exists yet.
4. **A documented retention period.** Data is currently kept until the user
   deletes it.
5. **Deciding whether to geo-gate.** Serving only some states reduces exposure
   but is itself a decision with legal consequences.

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
7. Minors: under-18 users bring COPPA and state-law obligations. Age-gate, or
   accept and comply?

---

## Sources

- [FTC — Updated Health Breach Notification Rule](https://www.ftc.gov/business-guidance/blog/2024/04/updated-ftc-health-breach-notification-rule-puts-new-provisions-place-protect-users-health-apps)
- [Clark Hill — Washington My Health My Data Act and its private right of action](https://www.clarkhill.com/news-events/news/its-here-the-who-what-and-how-of-washingtons-new-my-health-my-data-act-and-its-private-right-of-action/)
- [Troutman Pepper Locke — Pennsylvania targets AI chatbot for the unauthorized practice of medicine](https://www.troutman.com/insights/pennsylvania-targets-ai-chatbot-for-the-unauthorized-practice-of-medicine/)
- [Hogan Lovells — AI wellness or regulated medical device: navigating FDA rules](https://www.hlc.com/en/publications/ai-wellness-or-regulated-medical-device-a-lawyers-guide-to-navigating-fda-rulesand-what-could)
- [Matthiesen, Wickert & Lehrer — Exculpatory agreements and liability waivers in all 50 states](https://www.mwl-law.com/wp-content/uploads/2018/05/EXCULPATORY-AGREEMENTS-AND-LIABILTY-WAIVERS-CHART.pdf)

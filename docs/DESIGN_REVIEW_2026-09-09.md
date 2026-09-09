# Design review — 2026-09-09

What the product looks like, measured rather than judged, and what to change.

## How this was measured, so it can be repeated

Everything numeric below was read off **coachdiaz.app in a real browser** on
2026-09-09, at commit `748aa0fb`. Nothing here is inferred from the stylesheet
alone, because the stylesheet is not what a person sees.

- Screenshots: headless Chrome at 390×1400 and 1440×1400
  (`.design-shots/`, untracked).
- Contrast: the theme tokens resolved from `:root` on the live page, put
  through the WCAG relative-luminance formula.
- Target sizes: every `a`, `button`, `select` and `input` measured with
  `getBoundingClientRect`, then checked against SC 2.5.8 **including its
  spacing exception**, rather than reported as a violation on size alone.
- Line length: the average glyph width of the actual rendered font measured
  with a canvas against a representative English sentence — not `ch`, and not
  a guess at "about 8 pixels".

One correction worth recording, because it is the failure mode this
repository keeps writing tests about: **the first contrast pass produced
confident, wrong numbers.** The background walker returned
`rgba(0, 0, 0, 0)` for every element — the page color is painted on `html`,
not `body` — so every ratio was computed against black and the headline came
back at 1.18:1. A number arrived, it looked like a finding, and it was an
artifact of the measurement. The numbers below are from the resolved tokens.

## What is already good, and should not be touched

This is not a page that needs rescuing, and saying so first is the honest
framing for everything after it.

**Contrast passes everywhere, with room.** Measured, in the default Miami
light theme:

| Pair | Ratio | AA needs |
|---|---|---|
| body text on the page | **16.1** | 4.5 |
| body text on a card | **17.8** | 4.5 |
| muted text on the page | **6.4** | 4.5 |
| link on the page | **5.26** | 4.5 |
| accent (step numbers) on the page | **5.15** | 4.5 |
| white on the primary button | **5.69** | 4.5 |
| field border against the page | **3.43** | 3.0 |

The theme system earns this rather than lucking into it — `themes.js` solves
each color for the lightness at which it clears its requirement against every
ground it sits on. **Do not spend design effort here.** It is done.

**Measure is controlled on the marketing page.** The prose blocks are capped
at 34–50ch and the container at 52rem, with the 45–75 character guidance cited
in the CSS itself. `text-wrap: balance` on the headline, `pretty` on the
subhead. This is more typographic care than most shipped products have.

**Only one control is under 24×24 CSS px** — the "Already have an account?
Sign in" link, at 227×22. It **passes** SC 2.5.8 through the spacing
exception: the nearest other target's center is 52px away, comfortably past
the 24px circle. Worth fixing as best practice (the Understanding document
recommends meeting the size regardless), not worth calling a violation.

## What is actually wrong

### 1. Nobody can see the product before they commit to it

**There is not one image of the product anywhere.** `web/public` and
`web/src` contain six files that are all PWA icons. The home page — whose
entire pitch is *"a strength coach that reads what you actually lifted"* —
never shows a conversation, a program, a logged session or a chart.

This is not a taste objection. It is the funnel:

> 4 of 6 real signups completed intake and sent **zero** messages.

They filled in a long form about their injuries and their best lifts, arrived
at the coach, and stopped. The most likely reason a person stops at that exact
point is that they do not know what they are supposed to do next, because they
have never seen it happen. Everything the product is good at — the program
block, the session card, the way a missed rep changes the next week — is
invisible until after the moment where they leave.

**This is the highest-value change on the page by a distance**, and it is also
the cheapest: the screenshots already exist every time the app is opened.

`img-src 'self' data:` in the CSP means they have to be self-hosted, which is
what you want anyway.

### 2. The coach's own replies run past the measure the rest of the site honors

Measured on the live font: `.bubble { max-width: 90% }` inside a 760px page
puts an assistant reply at roughly **80–86 characters per line** on a desktop
browser.

The marketing page caps prose at 42–50ch and quotes the 45–75 range in a
comment. The transcript — **where an athlete reads ten times more text than
they ever read on the home page** — is the one surface that ignores it.

This is the single change with the best ratio of effect to effort on the whole
list: a `max-width` on `.bubble.assistant .content`, in the region of 68ch.
The athlete's own bubble can stay wide; short messages do not need a measure.

### 3. Everything is centered, including things that should not be

`.home { text-align: center }` and `.page-header`/`.page-title`/
`.header-detail` centered mean that essentially every piece of text in the
product is centered, and it is inherited rather than chosen per block.

Centering is right for the headline, the subhead and section titles. It is
wrong for:

- **The "Why not just ask a general AI?" paragraph** — six lines of centered
  prose. Both edges are ragged, so the eye has to hunt for the start of each
  line.
- **The `.home-honest` list** — multi-line items, centered.
- **The Email and Password labels on the sign-in form**, which are centered
  above full-width inputs. Measured: 6 centered text elements on `/login`,
  two of them field labels.

Practical Typography's rule is the usual one: centering is for short phrases —
titles, names, section headings — and full text blocks should not be centered
because both edges are uneven. NN/g's form guidance is that a label belongs
directly above its field, close to it, with proximity doing the work of
association; a centered label over a full-width input puts the label's start
somewhere in the middle of the field it names.

The fix is not "stop centering". It is to let the container center the
*display* type and left-align the *reading* type — one or two rules, not a
redesign.

### 4. The type scale collapses in the middle

```
--text-large-title: clamp(2.125rem, 6.2vw, 3.5rem)   34-56px
--text-title:       clamp(1.5rem, 3.4vw, 2rem)       24-32px
--text-headline:    1.0625rem                        17px
--text-body:        1.0625rem                        17px   ← identical
--text-caption:     0.8125rem                        13px
```

`--text-headline` and `--text-body` are the same value, so a "headline"
differs from body text by weight alone, and there is no step at all between
32px and 17px. That is a faithful subset of Apple's HIG roles, and an iOS app
can live with it because its screens are short. A marketing page with five
stacked sections and a coach transcript full of sub-headings cannot: every
section title is either huge or the same size as the paragraph under it.

The missing rung is one line: something around 20–22px for section
sub-headings and the step titles in "How it works".

### 5. It has no typographic identity

`system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`. That is a
defensible choice — no webfont request, no layout shift, nothing to keep
current, and it costs nothing against a strict CSP. It also means the product
looks like every other well-made SaaS page, and "looks like a serious training
tool" is part of what is being sold here.

**`font-src 'self'` already permits a self-hosted face**, so this needs no CSP
change and no third-party request: a subset `.woff2` in `web/public`, used for
`--text-large-title` and `--text-title` only, body text left on the system
stack. Applied to headings alone it is ~15–30KB and cannot shift body copy.

Worth doing only alongside the screenshots, not instead of them.

### 6. The language switcher is the loudest thing above the fold

An unstyled native `<select>` sits opposite the wordmark, and it is the only
control on the page wearing browser chrome. On the phone screenshot it is the
second thing the eye lands on, ahead of the headline. Spanish support is a real
feature and it deserves to be discoverable — it does not deserve to be the
most visually distinct element in the hero.

## What I would do, in order

| # | Change | Effort | Risk |
|---|---|---|---|
| 1 | Product screenshots in the hero and beside "How it works" | Half a day, mostly capture and cropping | Low — additive |
| 2 | Cap the assistant bubble's measure at ~68ch | Minutes | Low, but it changes every existing conversation's layout — worth looking at before and after |
| 3 | Left-align reading text; keep display type centered | An hour | Low |
| 4 | Add the missing type-scale step | Minutes | Low |
| 5 | Restyle the language switcher to match the other controls | An hour | Low |
| 6 | Raise the "Sign in" link to a 24px target | Minutes | None |
| 7 | Self-hosted display face for headings | Half a day incl. subsetting | Medium — it is the only change that can shift layout |

1 and 2 are worth more than 3–7 combined. If only one thing gets done, it is 1.

## What could not be checked, and why

**The signed-in app was not seen.** The browser available to this review was
not authenticated, so `/coach`, `/program`, `/progress`, `/log` and `/account`
were read from their components and their CSS only. Every claim about the
transcript above is derived from measured type metrics and the stylesheet, not
from looking at a real conversation — and the difference between those two
things is what the first paragraph of this document is about.

The in-app half of this review should be redone with a screenshot of a real
coach screen at 390px and at 1440px.

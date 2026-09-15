# The review harness

Mounts the **shipped page components** - the real ones from `web/src/pages` -
inside the app's real provider stack, with only the network replaced. It is how
every signed-in screen gets looked at and measured without a login.

```
node scripts/check-computed-styles.mjs          # uses this, see ROUTES there
npm run harness                                  # build it
npm run harness:serve                            # then open the URL it prints
```

`?page=<id>` picks a screen, `?mode=sparse|full` picks a data volume, and
`?auth=out` renders signed-out. The ids are the keys of `PAGES` in `main.jsx`.

## Why it exists

`docs/DESIGN_REVIEW_2026-09-09.md` ends by saying the signed-in app could not
be reviewed, because the browser had no session. `scripts/check-computed-styles.mjs`
has the same hole for the same reason: it watches `/` and `/login` only, so the
regression net covers two of twenty screens and none of the ones with tables,
charts or a transcript in them.

## The three rules, each of them a bug this has already caused

**1. Shapes come from routes, not from what a page appears to want.** The first
fixture put `units` at the top level, because that is the column name. The
route wraps it: `equipment: { units, smallestPlatePair }`. Every weight on the
Program page rendered with no unit and no plate readout, and column widths were
tuned against a page that was missing two things. When adding a fixture, read
the `res.json(...)` in `server/src/routes/` and copy that shape.

**2. Every api method is stubbed, not the ones a page is known to call.** An
unanticipated fetch would otherwise reach the network, fail, and be reviewed in
its error state - which looks exactly like a product defect and is not one.

**3. No real athlete data, and no real health data.** Injuries and restrictions
are populated with obviously invented text. The FIELDS are real so the layout
is honest; the content is not anybody's. The program fixture is a written-out
week, not an export of a real one.

## It is not a test

It renders and measures; it asserts nothing on its own. What asserts is
`scripts/check-computed-styles.mjs`, which drives it.

## A phone viewport is not a phone

Headless Chromium answers `hover: hover` and `pointer: fine` at 390px unless
touch is emulated. This app branches on those queries in at least two places -
the chart hint (`.hint-pointer` / `.hint-touch`) and the 16px focus-zoom floor
on form controls - so a review that only resizes the window reads the desktop
answer and reports it as a phone bug. One finding in
`docs/UI_REVIEW_2026-09-14.md` was withdrawn for exactly this.

When looking at phone behavior, set both:

```js
browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true })
```

`scripts/check-computed-styles.mjs` deliberately does NOT emulate touch: it
measures the theme and the cascade, where pointer capability is not a factor,
and adding it would change every recorded value for no gain.

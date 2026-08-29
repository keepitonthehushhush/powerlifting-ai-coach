# Runbook

Short, and only things that are done under pressure. Anything that can be
looked up calmly belongs in ARCHITECTURE.md or SECURITY.md instead.

---

## Put the site into maintenance mode

`web/public/maintenance.html` is a standalone page with no build step, no
imports and no dependencies. It survives a broken bundle, a failed deploy, an
expired API key and a database refusing connections — which is the point, since
those are the situations in which somebody reads it.

**To switch it on**, add this rewrite to `vercel.json` **above** the SPA
fallback, and deploy:

```json
{ "source": "/((?!api/|maintenance.html).*)", "destination": "/maintenance.html" }
```

The full `rewrites` array becomes:

```json
"rewrites": [
  { "source": "/api/(.*)", "destination": "/api/index" },
  { "source": "/((?!api/|maintenance.html).*)", "destination": "/maintenance.html" },
  { "source": "/((?!api/).*)", "destination": "/index.html" }
]
```

Order matters: the first matching rewrite wins, so the maintenance rule has to
come before the SPA fallback or it never fires.

`/api` is deliberately still live, because the page polls `/api/health` to
notice when the site is back. If the API is the thing that is broken, that is
fine — the check simply keeps reporting down.

**To switch it off**, delete that line and deploy. It is not behind an
environment variable on purpose: a `VITE_` variable needs a rebuild anyway, and
an API-driven flag is unreachable in exactly the outage it exists for.

**The page is also reached without any of this**, two other ways:

- `ErrorBoundary.jsx` links to it when a React render throws.
- Directly, if somebody has the link.

---

## Something is broken and you do not know what

**Check DNS first.** "It is always DNS" is a joke in the trade because it is
right often enough to be a heuristic, and this product now has three separate
DNS dependencies that fail silently and independently: the site's A records,
the Supabase hostname, and the MX records carrying the contact address in the
Terms. None of them announce themselves when they break. A registrar change, a
nameserver migration, an accidental edit while adding an unrelated record — the
site keeps looking fine and one specific thing stops working.

```
dig +short A coachdiaz.app        # the site resolves
dig +short NS coachdiaz.app       # nameservers are still Vercel's
dig +short MX coachdiaz.app       # mail to privacy@ has somewhere to go
npm run check:contact             # the same, with the reasoning attached
```

Then, in this order. It has found four defects this way already, three of which
had nothing to do with the reported symptom:

1. **Vercel runtime logs**, filtered to errors. Most of what has gone wrong
   here was already written down there and nobody was reading it.
   `get_runtime_errors` groups them; `get_runtime_logs` shows the sequence.
2. **`npm run check:db`** — the deployed-database invariants. Grants,
   `SECURITY DEFINER`, health-column coverage. Two silent production defects
   were properties of the database that no unit test could see.
3. **`npm run test:db`** — the full RLS suite. Needs `DATABASE_URL` set and
   runs through Node, no psql required.
4. **The browser console**, for anything that renders but misbehaves.

A blank page means a render threw before the boundary mounted, which almost
always means `main.jsx` or an import at module scope.

---

## The under-18 takedown route

The Terms commit to deleting an account when somebody tells us it belongs to a
minor. That commitment is only real if the address works.

- The address lives in **one place**: `web/src/lib/contact.js`.
- `CONTACT_LIVE` must stay `false` until a test email has actually **arrived**
  — not when DNS is added, not when a dashboard says verified. While it is
  false the documents print the Account-page route instead and say an address
  is being set up, and a test asserts they cannot print the address.
- When a report arrives: confirm the account email, delete it through the
  normal account-deletion path (which cascades everything), and reply. Do not
  ask for proof. Deleting an account in error is recoverable by signing up
  again; leaving a child's health data in place while deliberating is not.

### When health information arrives that nobody asked for

It will. A parent explaining why an account should go will explain, and the
explanation is the child's medical history in an inbox that has none of the
protections the app has — no row-level security, no consent record, no
retention rule. We did not collect it and we still have it.

**A confidentiality disclaimer does not fix this and is not used here.** It
tries to bind the recipient by appending text to a message; contract formation
needs both parties to agree and nobody agrees to a footer. It also addresses
the wrong risk — the danger is not that the recipient misuses it, it is that we
are holding it.

What the law actually points at, across the state privacy statutes, is
minimisation: collect what is reasonably necessary and dispose of it within a
reasonable time once it is not. So:

1. **Ask for less.** The Terms and the FAQ both say plainly that an account
   email address is all that is needed, and both ask people not to send medical
   details. The mailto link opens a message already written with those two
   fields and that request in it — most people send it as-is, which shapes the
   message before it exists in a way no footer can.
2. **Act on the request.** Confirm the account email, delete the account
   through the normal path, reply.
3. **Then delete the message, including from Trash and any Sent copy that
   quotes it.** Do not file it, do not forward it, do not keep it because it
   might be useful later. The promise in the Terms is explicit about this, so
   it is a commitment rather than a preference.
4. **Do not paste it anywhere.** Not into a ticket, not into a chat, not into a
   note. Every copy is another place it has to be deleted from.

If somebody sends a lot of it, or something distressing, that is still the
process. Reply to the person, be kind about it, and delete.

### The route is carried by DNS, so check it on a schedule

`npm run check:contact` verifies the domain still advertises somewhere to
deliver mail and that it is the forwarder we configured. It exits non-zero when
the documents are printing an address that cannot receive.

It cannot prove a message reaches a human — the forwarder could be suspended,
the mailbox full, the mail in spam. **Send a real test message to the address
once a month**, and if it does not arrive, set `CONTACT_LIVE` to `false` and
deploy before fixing anything else. The documents then fall back to the
Account-page route, which needs no DNS and no inbox. Printing an address that
bounces is worse than printing none, because it looks like a route.

---

## Where configuration lives

**`.env` at the repository root.** Not `server/.env` — that file does not exist,
and `server/dev.js` loads the root one through `dotenv/config`. Written down
because it has been got wrong twice.

`.env` is gitignored and must stay that way. `.env.example` is the committed
list of what is needed, with no values in it.

**Production is separate.** Vercel does not read `.env`; it injects its own
environment variables, set in the project dashboard under Settings →
Environment Variables. So every new key has to be added in **two** places, and
adding it locally alone is a working laptop and a broken deploy.

One-way door worth knowing: Vercel marks some variables "sensitive" and will
never show them again, so `vercel env pull` cannot recover the Anthropic key.
Keep a separate local-dev key rather than expecting to read production back.

---

## Before there is anything to pay for

Written down now so it is not relitigated later under pressure to convert:

**Cancelling must be possible at any time, from inside the account, without
emailing anybody and without explaining why.** Access runs to the end of the
period already paid for, and cancelling deletes nothing — the data belongs to
the person either way. This is promised on the FAQ before any payment exists,
because a subscription somebody is worried about escaping is a subscription
they will not start.

## Upgrading the Stripe SDK

`server/src/lib/stripe.js` pins `apiVersion` to a dated Stripe API version.
That pin is not a preference and it is not free-floating: it must match the
version the installed `stripe` package was built against, because the SDK's
request and response handling is written for that version. Pinning older than
the SDK means the library and the wire format disagree, and the symptom is a
field that is quietly absent rather than an error.

When you run `npm update stripe` or bump the major:

1. Read `node_modules/stripe/esm/apiVersion.js` (or `cjs/apiVersion.js`) in the
   new version. That file holds the API version the SDK is built for.
2. Update `apiVersion` in `server/src/lib/stripe.js` to match, in the same
   commit as the upgrade, and update the "Verified" line above it with today's
   date and the SDK version you checked.
3. Read the Stripe changelog for the release train you are moving to
   (https://docs.stripe.com/changelog). A move between major trains - Basil to
   Dahlia, say - carries breaking changes; a monthly release within a train
   does not.
4. Run `npm test`. `server/test/billing.test.js` compares the pin against the
   installed SDK's own file and fails if they have drifted apart, so on any
   machine that has run `npm install` you will be told rather than having to
   remember.

Current pin: `2026-08-26.dahlia`, verified 2026-08-27 against stripe-node
v22.6.0.

## Deploying without confusing anybody

### What can actually go wrong

Not what you would guess. This app has **no code splitting**, so the classic
"refresh during a deploy and get a 404 on a chunk" failure cannot happen here -
there is one bundle, and Vercel serves `index.html` with `must-revalidate`, so a
refresh gets fresh HTML pointing at a fresh asset.

The real exposure is **version skew**: somebody leaves a tab open, a deploy
lands, and their JavaScript is now a commit behind the API answering it. Nothing
crashes. A field the old client does not send, an error code it does not know, a
response shape it mis-reads - and a report that "it did something weird" that
neither of you can reproduce, because refreshing fixes it silently.

### What is in place

- `/api/health` reports the deployment id currently serving.
- The bundle carries the id of the build that produced it (`__BUILD_ID__`).
- When a tab regains focus, it compares them. If they differ, a banner offers a
  reload. It does **not** reload by itself: somebody may be halfway through
  logging a session, and taking that off the screen to fix a problem they have
  not hit yet trades a possible confusion for a certain loss.
- Every API request sends `x-deployment-id`. Vercel's Skew Protection would use
  it to pin an old client to the deployment it came from; it is Pro-and-above
  and does not support a plain Vite SPA automatically, so today Vercel ignores
  the header. It is sent anyway so the feature works the day the plan changes
  rather than being something to remember.

### Finding out what is actually breaking

Every failure the API returns carries a code — `coach_refused`, `CD-002` — and
every one that happens to a signed-in athlete is written to
`public.error_events`. That table exists because Vercel's runtime logs expire
in days, cannot be grouped, and answer "what happened just now" rather than
"what keeps happening". The failure everybody hits and nobody reports is
exactly the one a log stream loses.

Read it in the Supabase SQL editor. This is the query worth having a shortcut
to:

```sql
select * from private.error_summary(7);
```

Occurrences, distinct people, which routes, first and last seen — grouped by
code, worst first. Change the argument for a different window.

Three readings, in order of how much they should worry you:

- **`withdrawal_incomplete` (CD-020), ever.** Somebody withdrew consent and the
  health data it governed was not removed. Drop everything.
- **A code with `occurrences` far above `people`.** One person hitting the same
  wall repeatedly, which usually means the error tells them to do something
  that cannot work — `coach_empty` said "please try again" for over a year in a
  case where trying again could never help.
- **A code that starts appearing on a deploy date.** Compare `first_seen`
  against the deployment list.

For one athlete who has written in, quoting a code:

```sql
select created_at, code, http_status, route, detail
  from public.error_events
 where user_id = '<their uuid>'
 order by seq desc
 limit 50;
```

The table holds a code, a route, a status and a whitelisted set of diagnostic
keys. It never holds a message, a reply, or a field value, and there is a
`CHECK` constraint rather than a convention keeping that true. Rows are removed
after six months, and rows whose account was deleted already carry no user id.


### Before a deploy that changes an API shape

1. `npm run lint`, `npm test`, `npm run check:docs`, `npm run check:lockfile`.
2. `npm run build`, then grep the artefact for anything that has to be in it -
   this is how a missing `VITE_` variable gets caught, and it has been caught
   this way once already.
3. `npm run check:mounts` - loads the build you just made in headless Chrome
   and fails if the page is blank. `npm run check` runs all of it in order.
4. Push to a **branch**, not main. Vercel builds a preview deployment.
5. Open the preview URL and exercise the path you changed.
6. Merge.

### Preview deployments, and the database they are allowed to touch

Vercel builds a preview for every branch. Until now every one of them talked to
the **production** database, so testing anything that writes meant testing on
real athletes' rows — which is why nobody tested on a preview, and why three
faults reached coachdiaz.app in one afternoon that a single click would have
caught.

Previews now get their own Supabase project, and the isolation is **enforced
rather than configured**. A preview whose `SUPABASE_URL` is the production
project refuses to serve, and a preview *build* carrying production's
`VITE_SUPABASE_URL` renders a configuration screen instead of the app. Both
halves, because the browser talks to Supabase directly and a server-side check
cannot stop it.

The consequence worth knowing: **a preview with no Preview-scoped variables
does not run at all.** Vercel applies "All Environments" variables to previews,
so an unconfigured branch inherits production's and is refused. That is the
intended failure — fail closed, loudly, on a deployment that is not the live
site.

Production is never refused, whatever it is pointed at. The check is
one-directional on purpose: failing to boot normally turns a configuration
mistake into an outage, and the only reason it is acceptable here is that the
thing failing is a preview.

**Setting up the preview project** (once):

1. Create a second Supabase project in the same organisation.
2. Replay the schema into it:

   ```sh
   DATABASE_URL='<the preview project's SESSION POOLER URI>' npm run db:replay
   ```

   **Take the session pooler URI, not the direct one.** Supabase's direct
   connection host is IPv6-only. On a network without IPv6 the script fails at
   connect with `ENETUNREACH` and leaves the database empty, which looks
   exactly like "it did nothing" — and did, the first time this was attempted.
   The script now names the pooler in both its error messages.

   It applies every file in `supabase/migrations/` in order, each in its own
   transaction, and refuses to run against the production project or against
   any database that already has tables. It is also the only thing that has
   ever answered "can these files rebuild the database from nothing" — they
   were applied one at a time, months apart, to a database that was never
   empty.
3. In the Vercel dashboard, add these scoped to **Preview** only:
   `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. In the new project's Auth settings (Authentication → URL Configuration →
   Redirect URLs), add the preview URL **patterns**. There is no preview URL to
   copy until a branch has been pushed — Vercel mints one per deployment — so
   this step is wildcards or nothing:

   ```
   https://powerlifting-ai-coach-git-*-keepitonthehushhush1.vercel.app/**
   https://powerlifting-ai-coach-*-keepitonthehushhush1.vercel.app/**
   ```

   `*` matches within one host or path segment; `**` matches across them; the
   separators are `.` and `/`. The first line covers branch URLs, the second
   the per-commit ones. Without these, sign-in on a preview bounces to the Site
   URL and appears to do nothing.
5. Use Cloudflare's Turnstile **test keys** for the preview site key
   (`1x00000000000000000000AA` always passes). A real site key is bound to a
   hostname and every preview has a different one.
6. Keep Stripe in test mode there, and point `STRIPE_WEBHOOK_SECRET` at a
   separate endpoint or leave billing unconfigured — `config.paywall` already
   refuses to gate anybody when billing is not configured.

**What the first replay found.** Building the schema from the files and
diffing it against production is the only thing that has ever asked whether the
two agree. They did, everywhere except one object — and three defects fell out
of the exercise, none of which had any failure signal:

- `delete_my_account` was in the `private` schema in production and in `public`
  in the files. `supabase.rpc()` resolves against `public` and PostgREST cannot
  see `private`, so **account deletion was broken in production** while every
  test passed — the tests mock `rpc`, and a mock answers to any name.
- `apply_retention()` set `cleared_to_train = null` on a `not null` column.
  plpgsql does not plan a statement until it runs, so the function created
  cleanly and the nightly job reported success for as long as it had nothing to
  do. The first row to age past the health retention period would have raised
  `23502` and aborted every other category with it.
- The consent trigger had stopped calling `private.health_fingerprint`, so
  sleep, alcohol, nicotine, nutrition notes and gender were writable with no
  active consent. The invariant that exists for exactly this checked the
  fingerprint's contents and not whether anything called it.

All three are fixed in migration `0035`, and each now has a catalogue invariant
in `scripts/check-db-invariants.mjs` that fails against the database rather than
against a file.

**Comparing the two databases.** `scripts/schema-fingerprint.sql` reduces a
whole schema — columns, policies, grants, constraints, indexes, triggers and
function bodies — to one hash. Paste it into the SQL editor of both projects
and compare. Equal means the live schema is exactly what these files build.
After 0035, both read `cf6ada787700693ebe40ecc3de6a26f8` across 330 objects.

Run it after any change to `supabase/migrations/`, and after anything applied
through a dashboard — which is where drift comes from. Note that it compares
function *logic*: three functions in production are missing their comments,
because they were applied through a path that stripped them, and a check that
reports the same three every time is a check somebody stops reading.

**A preview says so.** Every page carries a "Preview build — not
coachdiaz.app" bar. Confusing a preview tab for the live site is the mistake a
preview environment makes possible, and it is made by looking at a page that is
identical to production in every other way.

**Migrations are still not branch-scoped.** They are applied to a project, so
applying one to production makes it live immediately, before the code that uses
it deploys. Write them so the old code still works: add columns, do not rename
or drop them in the same change as the code that stops using them.

### If a deploy has to be rolled back

Vercel keeps previous deployments. Promote the last good one from the dashboard
rather than reverting and rebuilding - it is immediate, and a revert commit can
be written calmly afterwards. A database migration does **not** roll back with
it, which is the other reason migrations should be written so the previous
version of the code still runs.


## Regenerating the icons

`scripts/generate-icons.py` draws the home-screen and favicon images from the
same coordinates as `web/src/components/Logo.jsx`. It is a script rather than a
one-off because a mark that drifts from the app's own logo is a second logo, and
a test compares the two coordinate sets.

    python3 scripts/generate-icons.py

Requires Pillow (`pip install pillow`). It writes into `web/public/icons/`.

If the badge geometry in Logo.jsx ever changes, change it here too and rerun -
the test will tell you if you forget. If the PALETTE changes, note that these
files are fixed assets and cannot re-theme the way the in-app SVG does: they are
pinned to the dark values, which are the `:root` defaults.

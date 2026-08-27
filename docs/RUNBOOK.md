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

In this order. It has found four defects this way already, three of which had
nothing to do with the reported symptom:

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

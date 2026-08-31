# Weekly: project health

Read `README.md` in this directory first — it carries the network facts and the
PASS / FAIL / COULD NOT DETERMINE rule that every step below depends on.

**READ-ONLY.** Do not edit files, commit, push, deploy, run migrations, or
apply dependency updates. You are reporting, not fixing.

Run everything from the repo root:
`$HOME/mnt/Documents/powerlifting-ai-coach`

## 1. Where the repository stands

```
git fetch origin --quiet
git status --short --branch
git log --oneline -5
```

Report whether the working tree is dirty and whether local `main` is ahead of
`origin/main`. **Unpushed commits mean production cannot be current** — call
that out, it is Eduardo's action to take.

## 2. Tests and lint

```
npm test
npm run lint
```

Report them separately. If `npm test` fails, quote the failing test names and
assertion messages **verbatim**. Do not paraphrase a failure.

## 3. The verification scripts

Each reported separately. If one is missing from `package.json`, report that —
do not invent a result.

```
npm run verify:deps
npm run verify:bundle
npm run check:contact
npm run check:docs
npm run check:lockfile
```

`npm run verify:deployment` fetches `coachdiaz.app` and **cannot run here**.
Skip it and say so; it is the daily task's job.

## 4. The convention guards

Confirm these suites are present and passing inside `npm test`: American
English spelling, i18n key parity between the English and Spanish catalogs, and
the policy-disclosure checks. If you cannot tell whether those specific suites
ran, say COULD NOT DETERMINE rather than assuming.

## 5. Dependencies — report only, apply nothing

```
npm audit
npm outdated
```

Majors are decisions Eduardo makes, not chores. List them; do not recommend an
upgrade run. Flag any **new** high or critical vulnerability prominently.

Context so you do not re-report settled decisions: `@anthropic-ai/sdk` was
upgraded 0.71 → 0.122 on 2026-08-31 and is current. Several majors are
deliberately deferred.

## 6. Database invariants

```
npm run check:db -- --print-sql
```

The script itself cannot connect from here — the proxy blocks Supabase, which
is exactly why `--print-sql` exists. Take the SQL it prints and run it with the
**Supabase MCP tools** against the production project `pwbkdxnvubtflgpqpest`,
then report every row whose result is not `true`, quoting the check name.

If the Supabase tools are not available, say so and include the printed SQL.
**Do not claim the invariants hold.**

## 7. Secret hygiene

The repository is public on GitHub, so this is worth a weekly look.

```
git check-ignore -v .env
git grep -I -n -E 'sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{40,}|sb_secret_[A-Za-z0-9_-]{20,}' -- . || echo "clean"
```

A match is an emergency: report it first, name the file, and say the key must
be rotated. As of 2026-08-31 all 253 commits were clean and only `.env.example`
was ever committed.

## How to report

Eduardo asked to hear from this task **only when something is wrong**. If every
step is PASS, reply with a single short line saying the weekly check passed.

If anything is FAIL or COULD NOT DETERMINE, lead with that, quote the actual
output, and keep the rest brief.

Never report a check as passing when it could not be run.

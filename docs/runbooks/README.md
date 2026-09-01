# Runbooks for the scheduled checks

Three scheduled tasks run against this repository on a timer. Their
instructions are **here**, not in the scheduling system, and that is the whole
point of this directory.

## Why the instructions live in the repo

A scheduled task on this account is bound to Eduardo's Mac, and editing a
device-bound task's prompt needs his approval on that machine. So every time a
check needed correcting — and in the first day they needed it twice — the fix
had to travel through him, by hand, into a text box.

That is a bad place for instructions to live for three reasons beyond the
friction:

1. **They go stale silently.** The weekly check told itself for a week that
   `@anthropic-ai/sdk` was "intentionally behind" after the upgrade landed.
   Nothing could have caught that, because nothing reviews a prompt.
2. **They are not reviewable.** A change to what the daily check does should
   be a diff somebody can read, next to the code it checks.
3. **They cannot be tested.** A claim in a prompt is prose. A claim in this
   directory can be asserted against reality — see
   `server/test/runbooks.test.js`, which checks that these files do not
   contradict what the repository actually contains.

So the scheduled task's own prompt is now three sentences: who you are, which
file to read, and what to do if it is missing. Everything that changes lives
here, in git, where a correction is a commit.

## The three runbooks

| File | Cadence | Reports |
|---|---|---|
| `daily-deployment-check.md` | every day, ~8am ET | only when something is wrong |
| `weekly-health-check.md` | Mondays, ~9am ET | only when something is wrong |
| `monthly-deep-review.md` | 1st of the month, ~10am ET | **always**, healthy or not |

The monthly one always reports because Eduardo cannot otherwise tell "all
clear" from "the task silently stopped running."

## The rule every runbook shares

Every step reports one of three outcomes: **PASS**, **FAIL**, or **COULD NOT
DETERMINE**. Never collapse "could not run" into "passed."

This project's recurring defect is a check that answers confidently without
looking — a log line nobody read, a promise nobody awaited, a CI job that
skipped green. The three-valued rule is the guard against it, and it is worth
more than any individual check in these files.

## What every run must know about the network

Measured on 2026-08-31, not assumed. The `device_bash` shell reaches the
internet through an egress proxy with an allowlist:

| Host | Reachable? |
|---|---|
| github.com | yes — `git fetch` works |
| registry.npmjs.org | yes — `npm audit` / `npm outdated` work |
| api.anthropic.com **without** a credential | yes |
| api.anthropic.com **with** a credential | **no** — see below |
| coachdiaz.app | **no** — use WebFetch |
| *.supabase.co | **no** — use the Supabase MCP tools |

A blocked host answers `403 from proxy after CONNECT`. **That is the sandbox
refusing, not the site being down.** Never report it as an outage.

The credentialed row is the subtle one and it was measured with a
discriminator, because the status code lies: an *uncredentialed* request to
the Anthropic API comes back `401` **with a `request-id`**, which only
Anthropic can mint. The same request carrying the API key comes back `401`
with **no** `request-id` and an empty body — it never arrived. Two identical
status codes, one of them real.

**So a 401 from this shell says nothing about the API key**, and anything
needing that key has to be run by Eduardo in his own terminal.

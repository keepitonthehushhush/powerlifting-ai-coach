# Monthly: deep review

Read `README.md` in this directory first — it carries the network facts and the
PASS / FAIL / COULD NOT DETERMINE rule that every step below depends on.

**READ-ONLY.** Do not edit files, commit, push, deploy, or run migrations.

## 1. The safety evaluation — you cannot run it, and that is not a failure

`npm run safety:eval` needs the Anthropic API key, and **the proxy in front of
this shell refuses requests carrying a credential**. It will die with "fetch
failed" whatever key is set.

**Do not run it. Do not report a score you did not observe.**

The measurement behind that, because the status code lies: an uncredentialed
request to the Anthropic API returns `401` **with** a `request-id`, which only
Anthropic can mint. The same request carrying the key returns `401` with **no**
`request-id` and an empty body — it never arrived.

Report that the evaluation is outstanding, and give Eduardo the command:

```
cd ~/Documents/powerlifting-ai-coach
set -a; source .env; set +a
npm run safety:eval
```

It costs roughly $3–10 per run, which he has approved monthly.

When he sends you the output, the one distinction that matters: a result marked
`[UNVERIFIED — harness limit]` means the grading harness could not verify the
judge's quote — **not** that the coach misbehaved. A plain failure is the kind
worth acting on. If you cannot tell which, say COULD NOT DETERMINE.

## 2. Is the eval grading the coach that is actually serving?

WebFetch `https://coachdiaz.app/api/health?cb=<today's date>` — the query string
defeats WebFetch's 15-minute cache — and compare `maxOutputTokens` against:

```
grep '^ANTHROPIC_MAX_TOKENS=' ~/mnt/Documents/powerlifting-ai-coach/.env
```

That variable is a plain number, not a secret. **Print no other line of
`.env`.** If they differ, a passing score describes a coach nobody is talking
to. This exact mismatch — 2048 local against 8192 in production — went
unnoticed until 2026-08-30.

## 3. Policy versions

Compare the version strings in `server/src/lib/policyVersions.js` against the
rows in `public.policy_versions`, queried with the **Supabase MCP tools**
against production (`pwbkdxnvubtflgpqpest`). Report any disagreement between
code and database.

If the Supabase tools are unavailable, print the code-side versions and say the
database side could not be checked.

## 4. Retention

Check that the retention categories named in `web/src/pages/PrivacyPolicy.jsx`
still agree with the `retention_periods` definition in the codebase. Report any
category present in one and absent from the other.

## 5. Legal follow-ups

Read `docs/COUNSEL_BRIEF.md` and list the questions still open. Grep the policy
pages for the "Draft — pending legal review" banner and say whether it is still
displayed.

**D1 — forming an LLC — is the largest outstanding exposure.** Mention it every
month until it is closed. The filing is $50 on form CSCL/CD-700 with Michigan
LARA; it does not need the attorney the other questions need.

## 6. Baseline

```
npm test
npm run lint
```

Quote any failure verbatim.

## How to report

**Unlike the daily and weekly tasks, this one reports every month even when
everything is healthy.** Eduardo's reason: he cannot otherwise tell "all clear"
from "the scheduled task silently stopped running."

Keep it short when things are fine — the outstanding eval, a one-line all-clear
on the other checks, and the count of open counsel questions. Expand only where
something is FAIL or COULD NOT DETERMINE, and quote real output when you do.

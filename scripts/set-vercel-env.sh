#!/usr/bin/env bash
#
# Push the environment this app needs into a Vercel project, with the right
# visibility on each variable.
#
# WHY A SCRIPT AND NOT THE DASHBOARD. Visibility is the part people get wrong,
# and it is invisible once set - a "Sensitive" variable renders as `Hidden` in
# every listing, which looks identical to a correctly-set one. This project
# shipped a black page for three deploys because of that. Encoding the intent
# here makes it reviewable, repeatable, and diffable, which a dashboard click
# is not.
#
# THE RULE THIS ENCODES:
#
#   Sensitive     = the value cannot be read back afterwards, by a person in
#                   the dashboard or by `vercel env ls`. Vercel's docs are
#                   explicit that sensitive values ARE still available to the
#                   build container and at runtime.
#   Non-sensitive = readable back. Still encrypted at rest; the distinction is
#                   about who can retrieve the value, not about who receives
#                   it at build time.
#
#   So: anything the browser bundle needs (VITE_*) MUST NOT be sensitive - not
#   because the compiler could not see it, but because Vercel REFUSES the
#   combination on Production and Preview. A VITE_ value is compiled into
#   public JavaScript, so marking it unreadable claims a protection it cannot
#   have. The refusal is easy to miss in a long CLI session, and a rejected
#   create means the variable simply does not exist - which is how
#   VITE_SUPABASE_URL came to be missing entirely.
#
#   ANTHROPIC_API_KEY is sensitive because it is a genuine secret and nothing
#   needs to read it back. The other server variables are not secrets, so they
#   are left readable, which makes them debuggable.
#
#   SENSITIVITY FOLLOWS THE VALUE, NOT THE NAME. A variable is sensitive
#   because of what is stored in it, not because of what it is called. See the
#   SMTP block below for the case that proves it: SMTP_USER sounds like config
#   and holds a token.
#
#   TWO CONSTRAINTS FROM VERCEL'S DOCS worth knowing before you run this.
#   First, sensitivity is not something `env add --force` changes: it overwrites
#   the value of an existing variable and leaves its type alone. The dashboard
#   cannot edit it either - Vercel's instruction there is to remove the variable
#   and add it again - and the CLI ships `vercel env update <NAME> --sensitive`
#   precisely because `add` does not do it. This script removes and re-adds the
#   secret variables for that reason; see readd_secret below.
#   Second, sensitive is only available on production and preview. A
#   development-scope variable cannot be sensitive at all, which is one more
#   reason nothing secret belongs in a development-scope variable - and why the
#   SMTP block is production-only.
#
# THE FLAG THAT IS NOT OPTIONAL. Recent Vercel CLI versions make `env add`
# SENSITIVE BY DEFAULT. `--no-sensitive` is not a redundant restatement of the
# default - it is the opt-out, and without it every build-time variable here is
# created in a state the build cannot read. A secure default that silently
# breaks the build is still a secure default; it just has to be written down.
#
# Values are read from .env, which is gitignored. Nothing secret lives here.
#
# Usage:  bash scripts/set-vercel-env.sh [production|preview|all]
set -euo pipefail

cd "$(dirname "$0")/.."

# An aborted run leaves some variables updated and others stale. That is
# recoverable - every write here is an in-place overwrite, so re-running fixes
# it - but silence would leave the reader unable to tell a completed run from a
# half-finished one, and those fail very differently.
trap 'echo; echo "FAILED part-way through. Some variables were updated and others were not. Fix the error above and run this script again; every write is an overwrite, so re-running is safe."' ERR

TARGETS=${1:-all}
case "$TARGETS" in
  all) TARGETS="production preview" ;;
  production|preview|development) ;;
  *) echo "Usage: bash scripts/set-vercel-env.sh [production|preview|development|all]"; exit 2 ;;
esac

if [ ! -f .env ]; then
  echo "No .env in $(pwd). Copy .env.example to .env and fill it in first."
  exit 2
fi

VERCEL="npx --yes vercel@latest"

BUILD_VARS="VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY SUPABASE_URL SUPABASE_PUBLISHABLE_KEY ANTHROPIC_MODEL"
SECRET_VARS="ANTHROPIC_API_KEY"

# ── SMTP: OPTIONAL, AND PRODUCTION ONLY ──────────────────────────────────────
#
# Optional because it genuinely is. env.js and mailer.js both treat an absent
# transport as a normal state - local development and every test run have none -
# so requiring it here would stop this script working for the people it works
# for today.
#
# PRODUCTION ONLY, and that is the part worth arguing. Every other variable in
# this file goes to preview as well, because a preview with the wrong Supabase
# URL is a broken preview and nothing more. SMTP is not like that. The one
# message this product sends is a consent request to the PARENT OF A CHILD, at
# an address a real person typed. A preview deployment is half-finished work by
# definition, and half-finished work with live mail credentials sends real
# email to real parents about real children.
#
# Without it, preview returns `email_unavailable` on that route - which is the
# honest degraded state, and visible, which is the whole design of mailer.js.
# The send path is proved by `npm run check:smtp` and by one guardian request
# in production to an address you control.
#
# Putting SMTP on preview would be a deliberate edit here, with a reason
# written next to it. Same rule mailer.js uses for adding a second kind of mail.
# ── WHICH OF THESE ARE SENSITIVE ─────────────────────────────────────────────
#
# Sensitivity follows the VALUE a variable holds, not its name. The obvious
# split - "the one called PASSWORD is the secret" - is wrong here, and it was
# wrong in this file until it was fixed.
#
# Postmark authenticates SMTP with the Server API Token used as BOTH the
# username and the password. SMTP_USER and SMTP_PASSWORD therefore carry the
# same secret. Writing SMTP_USER non-sensitive would publish that secret in a
# field anyone with dashboard access, or `vercel env ls`, can read back - which
# defeats the protection on SMTP_PASSWORD entirely, because the attacker only
# needs the value, not the variable it came from.
#
# Host, port and From are config: a public hostname, a port number, and the
# address recipients see. Keeping them readable is what makes a bad send
# debuggable without touching the token.
SMTP_VARS="SMTP_HOST SMTP_PORT SMTP_FROM"
SMTP_SECRET_VARS="SMTP_USER SMTP_PASSWORD"

read_env() {
  grep -E "^$1=" .env | head -1 | sed -E "s/^$1=//" | sed -E 's/^"(.*)"$/\1/' | sed -E "s/^'(.*)'\$/\1/" | tr -d '\r' || true
}

missing=""
for name in $BUILD_VARS $SECRET_VARS; do
  value="$(read_env "$name")"
  if [ -z "$value" ]; then missing="$missing $name"; fi
done

if [ -n "$missing" ]; then
  echo "Missing from .env:$missing"
  echo "Fill these in before running. Nothing has been changed on Vercel."
  exit 2
fi

# ── ALL FIVE, OR NONE ────────────────────────────────────────────────────────
#
# A PARTIAL SMTP CONFIGURATION IS THE DANGEROUS STATE, not the harmless one.
# `configured` in env.js is `host && user && pass`, so four out of five reads
# as "no mail configured" and the guardian route quietly answers
# email_unavailable - indistinguishable from never having set it up, on a
# machine where somebody clearly just did.
#
# So this refuses to write a half-set group rather than leaving somebody to
# discover it through a parent who never got the link.
smtp_present=""
smtp_absent=""
for name in $SMTP_VARS $SMTP_SECRET_VARS; do
  if [ -n "$(read_env "$name")" ]; then smtp_present="$smtp_present $name"; else smtp_absent="$smtp_absent $name"; fi
done

SEND_SMTP=no
if [ -n "$smtp_present" ] && [ -n "$smtp_absent" ]; then
  echo "SMTP is half-configured in .env."
  echo "  set:    $smtp_present"
  echo "  unset: $smtp_absent"
  echo
  echo "Four out of five reads as 'no mail configured' and fails the same silent way as none."
  echo "Set all five or clear them. Nothing has been changed on Vercel."
  exit 2
elif [ -n "$smtp_present" ]; then
  SEND_SMTP=yes
fi

echo "Target environments: $TARGETS"
echo

for name in $BUILD_VARS $SECRET_VARS; do
  value="$(read_env "$name")"
  case " $SECRET_VARS " in *" $name "*) kind="sensitive  (runtime only)" ;; *) kind="build+runtime" ;; esac
  printf '%-32s %-24s %s chars\n' "$name" "$kind" "${#value}"
done

if [ "$SEND_SMTP" = yes ]; then
  echo
  echo "SMTP (production only - see the note above):"
  for name in $SMTP_VARS $SMTP_SECRET_VARS; do
    value="$(read_env "$name")"
    case " $SMTP_SECRET_VARS " in *" $name "*) kind="sensitive  (runtime only)" ;; *) kind="runtime" ;; esac
    printf '%-32s %-24s %s chars\n' "$name" "$kind" "${#value}"
  done
else
  echo
  echo "SMTP: not in .env, skipping. The guardian consent mail will not send."
fi

echo
printf 'Replace these on Vercel? [y/N] '
read -r reply
case "$reply" in [yY]*) ;; *) echo "Aborted."; exit 1 ;; esac

# --force overwrites in place, so this replaces rather than remove-then-add. An
# aborted run then leaves stale values rather than no values, which is the
# difference between a deployment that is out of date and one that cannot boot.
#
# --yes matters only for preview, and only because of how the value is passed.
# Preview variables can be scoped to a single git branch, so the CLI prompts
# for one - but the value arrives on stdin, and stdin is exhausted by the time
# the prompt appears. Without --yes every preview write dies at a prompt that
# can never be answered. The alternative, --value on the command line, would
# put the Anthropic key in the process table for anyone on the machine to read.
#
# Production does not prompt, which is exactly why this went unnoticed: the
# environment that mattered succeeded and the one that did not is the one
# nobody looks at.
add_var() {
  printf '%s' "$(read_env "$1")" | $VERCEL env add "$1" "$2" "$3" --force --yes
}

# ── A VARIABLE THAT ALREADY EXISTS DOES NOT CHANGE ITS SENSITIVITY ───────────
#
# `env add --force` overwrites the VALUE. Vercel's own docs are clear that
# sensitivity is not an editable property in the dashboard - you remove the
# variable and add it again - and they ship a separate `env update --sensitive`
# for exactly this, which is not a command you need if `add --force` did it.
#
# That matters here because SMTP_USER already exists on this project as a
# NON-SENSITIVE variable: it was created that way by this script, before anyone
# noticed that Postmark's username is the Server API Token. Re-running with the
# corrected list would overwrite the value and leave it readable, which fixes
# nothing and looks exactly like a fix.
#
# So the secret variables are removed first. `|| true` because the first run on
# a fresh project has nothing to remove and that is not an error - and because a
# failed remove followed by a successful add still leaves a working deployment,
# which a failed add would not.
readd_secret() {
  $VERCEL env rm "$1" "$2" --yes >/dev/null 2>&1 || true
  add_var "$1" "$2" --sensitive
}

for target in $TARGETS; do
  for name in $BUILD_VARS; do
    # --no-sensitive is load-bearing. See the note at the top of this file.
    add_var "$name" "$target" --no-sensitive
  done

  for name in $SECRET_VARS; do
    readd_secret "$name" "$target"
  done

  # Production only. The reasoning is at the declaration, not here, because
  # this line is where somebody would "fix" it without reading why.
  if [ "$SEND_SMTP" = yes ] && [ "$target" = production ]; then
    for name in $SMTP_VARS; do
      add_var "$name" "$target" --no-sensitive
    done
    for name in $SMTP_SECRET_VARS; do
      readd_secret "$name" "$target"
    done
  fi
done

echo
for target in $TARGETS; do
  echo "Current $target environment:"
  # The `value` column shows the encrypted envelope (eyJ2IjoidjIi...) for
  # non-sensitive variables, not the plaintext. It is not a wrong value. Read
  # the `type` column: Non-sensitive reaches the build, Sensitive does not.
  $VERCEL env ls "$target" || true
  echo
done

cat <<'NEXT'

Environment variables are read at BUILD time. The running deployment was built
with the old values and will not change until it is rebuilt:

  npx vercel@latest redeploy coachdiaz.app

Then confirm what the public actually downloads:

  npm run verify:deployment -- https://coachdiaz.app
NEXT

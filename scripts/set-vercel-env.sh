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

echo "Target environments: $TARGETS"
echo

for name in $BUILD_VARS $SECRET_VARS; do
  value="$(read_env "$name")"
  case " $SECRET_VARS " in *" $name "*) kind="sensitive  (runtime only)" ;; *) kind="build+runtime" ;; esac
  printf '%-32s %-24s %s chars\n' "$name" "$kind" "${#value}"
done

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

for target in $TARGETS; do
  for name in $BUILD_VARS; do
    # --no-sensitive is load-bearing. See the note at the top of this file.
    add_var "$name" "$target" --no-sensitive
  done

  for name in $SECRET_VARS; do
    add_var "$name" "$target" --sensitive
  done
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

  npx vercel@latest redeploy powerlifting-ai-coach.vercel.app

Then confirm what the public actually downloads:

  npm run verify:deployment -- https://powerlifting-ai-coach.vercel.app
NEXT

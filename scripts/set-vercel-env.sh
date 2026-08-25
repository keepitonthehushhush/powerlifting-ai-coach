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
#   Sensitive     = runtime only. Vercel withholds it from the BUILD.
#   Non-sensitive = available to the build and at runtime. Still encrypted at
#                   rest; "non-sensitive" is about who can read it back, not
#                   about it being public.
#
#   So: anything the browser bundle needs (VITE_*) MUST NOT be sensitive - it
#   is compiled into public JavaScript anyway, and marking it sensitive only
#   means the compiler cannot see it. Vercel actually refuses this combination
#   on Production and Preview, and the refusal is easy to miss in a long CLI
#   session, which is how VITE_SUPABASE_URL came to not exist at all.
#
#   ANTHROPIC_API_KEY is sensitive, correctly: the server reads it at runtime
#   and no build step ever needs it.
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

# Each target is cleared before it is repopulated, so a failure part-way
# through leaves that environment INCOMPLETE rather than merely unchanged. Say
# so loudly: an empty environment and a stale one fail in very different ways,
# and the person watching needs to know which one they are now looking at.
trap 'echo; echo "FAILED part-way through. The environment is now incomplete - some variables were removed and not re-added. Fix the error above and run this script again; it is safe to re-run."' ERR

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

for target in $TARGETS; do
  for name in $BUILD_VARS $SECRET_VARS; do
    # Remove first: `env add` on an existing name fails rather than replacing,
    # and a partially-applied change is worse than a clean one.
    $VERCEL env rm "$name" "$target" --yes >/dev/null 2>&1 || true
  done

  for name in $BUILD_VARS; do
    # --no-sensitive is load-bearing. See the note at the top of this file.
    printf '%s' "$(read_env "$name")" | $VERCEL env add "$name" "$target" --no-sensitive
  done

  for name in $SECRET_VARS; do
    printf '%s' "$(read_env "$name")" | $VERCEL env add "$name" "$target" --sensitive
  done
done

echo
echo "Current production environment:"
$VERCEL env ls production || true

cat <<'NEXT'

Environment variables are read at BUILD time. The running deployment was built
with the old values and will not change until it is rebuilt:

  npx vercel@latest redeploy powerlifting-ai-coach.vercel.app

Then confirm what the public actually downloads:

  npm run verify:deployment -- https://powerlifting-ai-coach.vercel.app
NEXT

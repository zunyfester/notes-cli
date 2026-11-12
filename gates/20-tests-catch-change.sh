#!/usr/bin/env bash
# gates/20-tests-catch-change.sh — the builder says it wrote failing tests first; this gate checks it.
# It runs the NEW tests against the OLD code (FACTORY_BASE). At least one must fail: if they all pass
# on the code from before the change, they do not test the change.
set -uo pipefail

if ! grep -q '^src/' <<<"${FACTORY_CHANGED:-}"; then
  echo "No changes in src/, nothing to check."
  exit 0
fi

old="$(mktemp -d)/old"
cleanup() { git worktree remove --force "$old" >/dev/null 2>&1; rm -rf "$(dirname "$old")"; }
trap cleanup EXIT

git worktree add --quiet --detach "$old" "$FACTORY_BASE" || { echo "Could not check out $FACTORY_BASE."; exit 1; }
rm -rf "$old/test" && cp -R test "$old/test"     # new tests, old src/
ln -s "$PWD/node_modules" "$old/node_modules"

if (cd "$old" && npm test --silent >"$old/../run.log" 2>&1); then
  echo "The new tests also pass on the code from before the change ($FACTORY_BASE)."
  echo "So they do not test what changed. Write at least one test that fails without the change."
  exit 1
fi
summary="$(grep -E 'Tests? +[0-9]+ failed|[0-9]+ failed' "$old/../run.log" | head -1 | sed -E 's/\x1b\[[0-9;]*m//g; s/^[ ❯]+//; s/ [0-9]+ms$//')"
echo "Good: on the old code the new tests fail (${summary:-at least one failure}), so they test the change."

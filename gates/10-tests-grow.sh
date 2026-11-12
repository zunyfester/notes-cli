#!/usr/bin/env bash
# gates/10-tests-grow.sh — if the agents change code in src/, they must also add new tests.
# Counts it(...)/test(...) cases in test/ before the run (FACTORY_BASE) and now; the number has to go up.
set -euo pipefail

if ! grep -q '^src/' <<<"${FACTORY_CHANGED:-}"; then
  echo "No changes in src/, so no new tests are required."
  exit 0
fi

count_tests() { grep -hoE '\b(it|test)(\.each\([^)]*\))?\(' "$@" 2>/dev/null | wc -l | tr -d ' '; }

before=0
for f in $(git ls-tree -r --name-only "$FACTORY_BASE" -- test/); do
  before=$((before + $(git show "$FACTORY_BASE:$f" | count_tests /dev/stdin)))
done
after=0
for f in $(git ls-files -co --exclude-standard -- test/); do
  [ -f "$f" ] && after=$((after + $(count_tests "$f")))
done

if [ "$after" -le "$before" ]; then
  echo "The code in src/ changed, but test/ has $after test cases and had $before before the run."
  echo "Every change to src/ must add at least one new test that covers it."
  exit 1
fi
echo "Tests grew from $before to $after."

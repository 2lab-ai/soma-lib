#!/bin/bash
# Inventory gate: every module directory directly under src/{domain,ports,adapters}
# must have a `### src/<layer>/<name>` entry in MODULES.md, and every entry must
# point at a directory that still exists. This forces the update-vs-new dedup
# decision to be recorded — the entry contract requires an "Overlap decision"
# field — so near-duplicate modules can't slip in without a written comparison
# against what already exists.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# 1. Every module dir has an entry
for layer in domain ports adapters; do
  [ -d "src/$layer" ] || continue
  for dir in src/$layer/*/; do
    [ -d "$dir" ] || continue
    mod="${dir%/}"
    if ! grep -q "^### $mod\$" MODULES.md; then
      echo "::error::$mod has no entry in MODULES.md — read MODULES.md, decide extend-vs-new, and record the Overlap decision."
      fail=1
    fi
  done
done

# 2. Every entry points at a live dir (stale entries rot the dedup check)
while IFS= read -r mod; do
  if [ ! -d "$mod" ]; then
    echo "::error::MODULES.md entry '$mod' points at a missing directory — remove or fix the entry."
    fail=1
  fi
done < <(grep -o '^### src/[a-z]*/[a-z0-9-]*' MODULES.md | sed 's/^### //')

# 3. Every entry carries the Overlap decision field
while IFS= read -r mod; do
  entry=$(awk "/^### ${mod//\//\\/}\$/{f=1;next} /^### /{f=0} f" MODULES.md)
  if ! grep -q "Overlap decision" <<<"$entry"; then
    echo "::error::MODULES.md entry '$mod' lacks an 'Overlap decision' field — record why this is a new module (or an extension)."
    fail=1
  fi
done < <(grep -o '^### src/[a-z]*/[a-z0-9-]*' MODULES.md | sed 's/^### //')

if [ "$fail" -eq 0 ]; then
  echo "module inventory: OK"
fi
exit $fail

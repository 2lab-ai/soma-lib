#!/bin/bash
# Step 1 publish — the classifier-blocked externals, batched in dependency order.
# Safe to re-run: each phase skips work that already exists.
set -euo pipefail

LIB=~/2lab.ai/soma-lib
SW=~/2lab.ai/soma-work/.worktrees/refactor-command-safety-soma-lib
SM=~/2lab.ai/soma/.worktrees/refactor-command-safety-soma-lib
BR=refactor/command-safety-soma-lib

echo "=== 1/4 soma-lib: repo + push + tag + release tarball ==="
cd "$LIB"
if ! gh repo view 2lab-ai/soma-lib >/dev/null 2>&1; then
  gh repo create 2lab-ai/soma-lib --public \
    --description "Shared hexagonal core for soma + soma-work — domain/ports/adapters extracted step by step" \
    --source . --push
else
  git remote get-url origin >/dev/null 2>&1 || git remote add origin git@github.com:2lab-ai/soma-lib.git
  git push -u origin main
fi
git tag -f v0.1.0 && git push -f origin v0.1.0
if ! gh release view v0.1.0 --repo 2lab-ai/soma-lib >/dev/null 2>&1; then
  gh release create v0.1.0 soma-lib-0.1.0.tgz --repo 2lab-ai/soma-lib \
    --title "v0.1.0" --notes "Step 1: command-safety domain (extracted from soma-work) + createRuleSet engine. See docs/ROADMAP.md."
fi

echo "=== 2/4 soma-work: lockfile against the live release, push, PR ==="
cd "$SW"
npm install --no-fund --no-audit   # resolves the release tarball URL into package-lock.json
npm run build:somalib >/dev/null
git add package-lock.json && git commit -m "chore: lock soma-lib release tarball

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" || echo "lockfile already committed"
git push -u origin "$BR"
gh pr create --repo 2lab-ai/soma-work --head "$BR" \
  --title "refactor: dangerous-rules catalog moves to shared soma-lib" \
  --body "Step 1 of the soma ⊕ soma-work convergence roadmap (2lab-ai/soma-lib docs/ROADMAP.md). Canonical catalog+engine extracted verbatim to soma-lib; this file becomes a thin re-export — zero call-site changes, rules unchanged. Receipt in commit message. 🤖 Generated with [Claude Code](https://claude.com/claude-code)" \
  2>/dev/null || echo "PR may already exist"

echo "=== 3/4 soma: lockfile against the live release, push, PR ==="
cd "$SM"
bun install                        # resolves the release tarball URL into bun.lock
git add bun.lock && git commit -m "chore: lock soma-lib release tarball

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" || echo "lockfile already committed"
git push -u origin "$BR"
gh pr create --repo 2lab-ai/soma --head "$BR" \
  --title "refactor: run command-safety block rules on the shared soma-lib engine" \
  --body "Step 1 of the soma ⊕ soma-work convergence roadmap (2lab-ai/soma-lib docs/ROADMAP.md). BLOCKED_* rules unchanged, re-expressed as soma-lib DangerousRule entries matched via createRuleSet. Deny reasons byte-identical; receipt in commit message. 🤖 Generated with [Claude Code](https://claude.com/claude-code)" \
  2>/dev/null || echo "PR may already exist"

echo "=== 4/4 verify ==="
cd "$SW" && npx vitest run src/__tests__/dangerous-command-filter.test.ts 2>&1 | tail -3
cd "$SM" && bun test src/security.test.ts 2>&1 | tail -3
echo "DONE — PRs:"
gh pr list --repo 2lab-ai/soma-work --head "$BR" --json url -q '.[].url'
gh pr list --repo 2lab-ai/soma --head "$BR" --json url -q '.[].url'

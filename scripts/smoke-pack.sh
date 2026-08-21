#!/bin/bash
# Package-boundary smoke: prove the PACKED tarball works for every consumer
# resolution mode — Node CJS require, tsc moduleResolution:node types, and
# (when bun is on PATH) bun's `bun` export condition. Run by CI and before
# every release. Source-relative vitest greens do NOT cover this.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

TARBALL=$(npm pack --silent | tail -1)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "smoke dir: $TMP (tarball: $TARBALL)"

mkdir -p "$TMP/consumer"
cd "$TMP/consumer"
cat > package.json <<EOF
{ "name": "smoke-consumer", "private": true, "dependencies": { "soma-lib": "file:$ROOT/$TARBALL" } }
EOF
npm install --no-fund --no-audit --silent

# 1. Node CJS require — every public symbol present and functional
node -e '
const l = require("soma-lib");
const assert = require("assert");
for (const k of ["DANGEROUS_RULES","createRuleSet","matchRules","rulesByIds","overridableMatchedRuleIds","overridableRulesByIds","isCrossUserAccess","isSshCommand"]) {
  assert(l[k] !== undefined, "missing export: " + k);
}
assert(l.DANGEROUS_RULES.length >= 14, "catalog too small");
assert(l.isSshCommand("ssh host") === true, "isSshCommand broken");
assert(l.matchRules("kill -9 1").some(r => r.id === "kill"), "matchRules broken");
assert(l.overridableMatchedRuleIds("ssh host").length === 0, "lockdown isolation broken");
const set = l.createRuleSet([{id:"x",label:"x",description:"x",sessionOverridable:false,match:(c)=>c.includes("boom")}]);
assert(set.matchRules("boom")[0].id === "x", "createRuleSet broken");
console.log("node CJS require: OK");
'

# 2. tsc type resolution under moduleResolution:node (soma-work's mode)
cat > check.ts <<'EOF'
import { DANGEROUS_RULES, createRuleSet, type DangerousRule, type DangerousRuleContext, type RuleSet, isCrossUserAccess, isSshCommand, matchRules, overridableMatchedRuleIds, overridableRulesByIds, rulesByIds } from 'soma-lib';
const r: DangerousRule = DANGEROUS_RULES[0]!;
const s: RuleSet = createRuleSet([r]);
const ctx: DangerousRuleContext = { userId: 'U1' };
void [s.matchRules('x', ctx), rulesByIds(['kill']), overridableMatchedRuleIds('x'), overridableRulesByIds(['kill']), isCrossUserAccess('x', 'U1'), isSshCommand('x'), matchRules('x')];
EOF
cat > tsconfig.json <<'EOF'
{ "compilerOptions": { "target": "ES2020", "module": "commonjs", "moduleResolution": "node", "strict": true, "noEmit": true }, "include": ["check.ts"] }
EOF
"$ROOT/node_modules/.bin/tsc" -p tsconfig.json
echo "tsc moduleResolution:node types: OK"

# 3. bun import via the "bun" export condition (TS source) — when available
if command -v bun >/dev/null 2>&1; then
  bun -e '
import { DANGEROUS_RULES, createRuleSet, isSshCommand } from "soma-lib";
if (DANGEROUS_RULES.length < 14) throw new Error("catalog too small");
if (!isSshCommand("ssh host")) throw new Error("isSshCommand broken");
if (createRuleSet([{id:"x",label:"x",description:"x",sessionOverridable:false,match:(c)=>c.includes("boom")}]).matchRules("boom").length !== 1) throw new Error("createRuleSet broken");
console.log("bun import: OK");
'
else
  echo "bun not on PATH — skipped (covered locally before release)"
fi

echo "SMOKE PACK: ALL OK"

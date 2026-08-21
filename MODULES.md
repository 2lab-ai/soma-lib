# Module inventory — read BEFORE adding anything

Single source of truth for what already lives in soma-lib. **Before creating a
new module you MUST read this file and decide: extend an existing module, or
add a new one — and record that decision in the new entry.** CI
(`scripts/check-module-inventory.sh`) fails any module directory that has no
entry here, so the check cannot be skipped silently.

Entry contract: every directory directly under `src/domain/`, `src/ports/`,
`src/adapters/` gets one `### `-heading entry with the four fields below.
"Covers / Does NOT cover" is what makes the next dedup decision cheap — write
it for the reader who is about to duplicate you.

---

### src/domain/command-safety

- **Purpose**: classify shell commands as dangerous — pure rule catalog +
  matching engine. Policy (deny vs ask vs log) stays in the apps.
- **Covers**: canonical `DANGEROUS_RULES` catalog; `createRuleSet()` engine for
  project-specific catalogs; lockdown vs session-overridable split; standalone
  matchers `isCrossUserAccess` (per-user /tmp isolation), `isSshCommand`.
- **Does NOT cover**: path allowlisting (`isPathAllowed` — app-side, future
  port candidate), rate limiting, chat authorization, tool-input validation
  beyond Bash commands.
- **Overlap decision** (2026-08-21): new module — first extraction, no prior
  soma-lib code existed. Origin: soma-work `somalib/permission/dangerous-rules.ts`
  (moved verbatim); soma `BLOCKED_*` re-expressed on the shared engine.
  Keywords: dangerous command, blocked pattern, command safety, permission,
  bash filter, security rules.

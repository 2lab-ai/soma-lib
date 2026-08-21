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
  matchers `isCrossUserAccess` (per-user /tmp isolation), `isSshCommand`;
  `EXECUTION_DISPATCH_RULES` named subset (curl|sh interpreter-pipe family,
  Step 2 promotion from soma — overridable in the canonical ask flow, consumed
  as hard-deny by soma).
- **Does NOT cover**: path allowlisting (`isPathAllowed` — app-side, future
  port candidate), rate limiting, chat authorization, tool-input validation
  beyond Bash commands, soma's substring `BLOCKED_PATTERNS` (personal-policy
  hard-denies, stay app-side).
- **Overlap decision** (2026-08-21): new module — first extraction, no prior
  soma-lib code existed. Origin: soma-work `somalib/permission/dangerous-rules.ts`
  (moved verbatim); soma `BLOCKED_*` re-expressed on the shared engine.
  Keywords: dangerous command, blocked pattern, command safety, permission,
  bash filter, security rules.
- **Overlap decision** (2026-08-21, Step 2): EXTENDED this module rather than
  adding a new one — the execution-dispatch family is the same domain
  (command-danger classification); compared against `DANGEROUS_RULES` (no id
  or matcher overlap) before promotion from soma `BLOCKED_EXECUTION_RULES`
  (moved verbatim, ids preserved).

### src/domain/cron-expression

- **Purpose**: 5-field cron expression semantics — match against a Date (UTC)
  and validate expression/name syntax. Pure functions, no scheduling.
- **Covers**: `matchesCronExpression` (numbers, `*`, lists, ranges, steps;
  UTC evaluation; dow 0===7 Sunday), `isValidCronExpression` (syntax + range +
  zero-step + reversed-range rejection), `isValidCronName`.
- **Does NOT cover**: scheduling policy (polling loops, timers, dedup,
  misfire/catch-up), job models (CronJob stays in soma-work; cron.yaml schema
  stays in soma), next-run computation (nothing needs it yet), storage
  (CronStorage adapter stays app-side until a JobStore port exists).
- **Overlap decision** (2026-08-21, Step 3): new module — compared against
  `command-safety` (disjoint domain: time semantics vs command classification).
  Origin: soma-work `somalib/cron/cron-storage.ts` hand-rolled engine (moved
  verbatim; only `as string` casts added for this repo's
  noUncheckedIndexedAccess). soma's counterpart is the external `croner`
  package — migrating soma's scheduler onto this engine is a deliberate
  backlog step, not part of this extraction.
  Keywords: cron, schedule, expression, crontab, 5-field, match, validate,
  every minute, UTC.

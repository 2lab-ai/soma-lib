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

### src/ports/cron-scheduling

- **Purpose**: the contract by which an app hands recurring work to a
  scheduler — `CronJobFactory(expression, onTick) → CronJobHandle {stop,
  nextRun}` + injectable `CronTimers`.
- **Covers**: the type contract only (creation-time throw on invalid
  expression is part of the contract).
- **Does NOT cover**: any implementation (see adapters), job persistence,
  run-request lifecycle, catch-up policy.
- **Overlap decision** (2026-08-21, Step 3b): new module — first ports-layer
  entry; formalizes the injection seam soma's scheduler already had
  (`SchedulerServiceDependencies.createCronJob`, previously satisfied by
  croner). Keywords: port, scheduler, factory, job handle, timers.

### src/adapters/minute-cron-job

- **Purpose**: croner-free `CronJobFactory` implementation over
  `domain/cron-expression` — polls (default 20s), fires at most once per
  matching calendar minute, `nextRun()` via bounded forward scan.
- **Covers**: wall-clock modes 'local' (croner parity — soma cron.yaml) and
  'utc' (soma-work model); creation-time validation; onTickError isolation;
  injectable timers/clock for tests.
- **Does NOT cover**: seconds-precision firing, 6-field/named/alias
  expressions, vixie dom/dow OR-combination (engine ANDs all fields), missed-
  minute catch-up after process sleep.
- **Overlap decision** (2026-08-21, Step 3b): new module — first
  adapters-layer entry; compared against `domain/cron-expression` (this is
  its consumer, not a duplicate) and soma-work's CronScheduler tick loop
  (storage-driven multi-job loop — candidate to adopt this adapter later,
  noted in ROADMAP backlog). Keywords: croner replacement, polling scheduler,
  minute dedup, wall clock, timezone, nextRun.

### src/domain/session-state

- **Purpose**: pure state machine for an agent chat session's runtime — the
  `ActivityState`/`QueryState` algebra with stop/interrupt flags and a
  generation counter for stale-callback fencing.
- **Covers**: `SessionRuntimeState` + every transition (`startProcessing`,
  `startQuery`, `completeQuery`, `finalizeQuery`, stop-request variants,
  interrupt begin/end/consume, generation increment) and the
  `isQueryRunning`/`isQueryProcessing` predicates; the shared
  `ActivityState` vocabulary ('idle' | 'working' | 'waiting').
- **Does NOT cover**: the session object itself (stores, serialization,
  session keys, thread/workdir wiring), soma-work's SessionRegistry
  persistence policy (idle-only saves), any UI state.
- **Overlap decision** (2026-08-22, Step 4a): new module — compared against
  existing domains (disjoint: command classification / time semantics vs
  session lifecycle). Origin: soma `src/core/session/state-machine.ts`
  (moved verbatim; soma-originated → Rinaldi MIT attribution added to
  LICENSE). soma-work counterpart is the identical `ActivityState` union in
  `src/types.ts` (adopts the shared type this step; its ad-hoc registry
  transitions are a later sub-step). Keywords: session, state machine,
  activity state, query state, interrupt, stop request, generation, idle,
  working, waiting.

### src/domain/session-identity

- **Purpose**: session identity model — branded (tenantId, channelId,
  threadId) triplet with two canonical encodings: session key
  `tenant:channel:thread` and storage partition `tenant/channel/thread`;
  symmetric build/parse with machine-readable invariant errors.
- **Covers**: branded id types + `to*Id` validators (empty / separator
  rejection), `createSessionIdentity`, `buildSessionKey(/FromInput)`,
  `parseSessionKey`, `buildStoragePartitionKey(/FromInput)`,
  `parseStoragePartitionKey`, `SessionIdentityInvariantError` (coded),
  `sessionKeyContract` object.
- **Does NOT cover**: soma's Telegram delivery policy
  (`resolveSendFileChatId`) and scheduler tenant convention
  (`SCHEDULER_TENANT_ID`) — app-side; soma's on-disk `serializeSessionData`
  (app persistence glue); soma-work's current `channel-threadTs` key (ad hoc
  in SessionRegistry — adopting this model there = persisted-key migration,
  ROADMAP backlog).
- **Overlap decision** (2026-08-22, Step 4b): new module — compared against
  `session-state` (same session domain family but disjoint concern: identity
  vs runtime algebra; kept separate so soma-work can adopt identity without
  the state machine and vice versa). Origin: soma
  `src/core/routing/session-key.ts` generic portion (moved verbatim;
  soma-originated → Rinaldi attribution already in LICENSE). Keywords:
  session key, tenant, channel, thread, identity, storage partition, branded
  type, parse, invariant.

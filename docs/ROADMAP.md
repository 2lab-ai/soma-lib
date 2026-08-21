# soma ⊕ soma-work convergence roadmap

Goal: converge soma (Telegram/Slack personal bot, bun) and soma-work (Slack work
harness, npm) on a shared hexagonal core. End state: both apps are **glue code**
(config + adapter wiring) over soma-lib; then — and only then — decide whether
to physically merge the repos.

## Operating principles

1. **One module per step.** Each step extracts exactly one domain (or port)
   into soma-lib, ships a tagged release, and switches BOTH consumers (or one,
   when the domain exists only in one — the other adopts when its counterpart
   feature lands).
2. **Behavior-preserving.** Extraction is a move, not a redesign. Existing test
   suites in both apps are the receipt; rule/semantics merges are their own
   later steps, never smuggled into an extraction step.
3. **Strangler pattern.** The old path keeps working until the new one is
   proven (re-export shims are fine and expected).
4. **Plan one step ahead only.** The backlog below is a candidate list with a
   suggested order, re-evaluated after every step — NOT a committed design.
   Detailed design happens per-step, when the step starts.
5. Each step's receipt: soma-lib `npm run check` green + both consumers' own
   gates green (`bun test`/typecheck for soma, `npm run lint && npm test` for
   soma-work) + external review.
6. **License provenance.** soma derives from Fabrizio Rinaldi's MIT
   claude-telegram-bot — any future extraction of soma-originated code into
   soma-lib must carry his MIT attribution alongside ours. Step 1 code is
   soma-work-originated (2lab.ai).
7. **Update-vs-new gate.** Before any module is added, the extraction protocol
   in CLAUDE.md runs: read MODULES.md, search for overlap, decide
   extend-vs-new, record the decision in the module's MODULES.md entry. CI
   enforces entry presence + the Overlap decision field
   (`scripts/check-module-inventory.sh`) — near-duplicate modules must not
   accumulate.

## Step log

### Step 1 — command-safety domain ✅ (2026-08-21, v0.1.0)

- Extracted soma-work `somalib/permission/dangerous-rules.ts` verbatim as
  `src/domain/command-safety` (canonical catalog + engine), plus
  `createRuleSet()` so apps can run project-specific catalogs on the same
  engine and inherit the lockdown-isolation invariant.
- soma-work: `somalib/permission/dangerous-rules.ts` became a thin re-export of
  `soma-lib` — zero call-site changes (everything already flowed through it).
- soma: `BLOCKED_PATTERNS` / `BLOCKED_EXECUTION_RULES` re-expressed as
  `DangerousRule[]`; `checkCommandSafety` now runs on the shared engine via
  `createRuleSet`. Deny reasons preserved verbatim (existing security tests are
  the receipt). Catalog contents unchanged on both sides.
- Packaging decision: release-tarball dependency over HTTPS (not `git:`) — see
  README §Consuming for the gitconfig-insteadOf rationale.

### Step 2 — catalog merge: execution-dispatch promotion ✅ (2026-08-21, v0.2.0)

Per-rule decisions:

- **Promoted**: soma's 7 execution-dispatch rules (`pipe-to-interpreter`,
  `pipe-to-path-interpreter`, `pipe-to-busybox`, `process-substitution`,
  `source-dot-substitution`, `xargs-to-interpreter`,
  `env-wrapped-interpreter`) moved verbatim into the canonical catalog as
  `sessionOverridable: true` — soma-work's bypass escalation now ASKS on
  curl|sh-style dispatch instead of sailing through; legitimate installer
  pipes can be approved or session-disabled.
- **Not adopted**: canonical kill/reboot/rm family stays out of soma's
  hard-deny set — those semantics are only safe as ask-rules (soma has no ask
  flow; hard-denying `kill` would break personal-bot workflows).
- **Deduped**: soma deletes its local `BLOCKED_EXECUTION_RULES` regex
  definitions and consumes `EXECUTION_DISPATCH_RULES` (hard-deny policy and
  deny-reason strings preserved). `BLOCKED_PATTERNS` substring denies stay
  app-side (personal policy).

## Candidate backlog (suggested order — re-evaluate each step)

3. **cron/scheduling domain** — soma `src/scheduler/*` + `cron.yaml` vs
   soma-work `src/cron-scheduler.ts` + `somalib/cron/cron-storage.ts`. Domain:
   job spec, schedule computation, run-request lifecycle. Ports: `JobStore`,
   `Clock`, `Dispatcher`.
4. **session domain** — soma `src/core/session/*` (state-machine, session-key,
   serialize) vs soma-work agent-session/agent-manager. Biggest overlap,
   biggest risk; will decompose into sub-steps (state machine first, stores
   later).
5. **provider orchestration ports** — soma `src/providers/*` (claude/codex
   adapters, retry policy, error normalizer) vs soma-work claude-handler. Port:
   `EngineAdapter`; domain: retry/error policy.
6. **chat formatting domain** — markdown → platform-chunked messages (soma
   `formatting.ts` vs soma-work `src/format/*`). Domain: chunking/split rules;
   adapters: Slack mrkdwn vs Telegram HTML.
7. **memory/model-commands** — soma-work `somalib/model-commands/*` vs soma
   counterparts (hierarchical memory exists in both).
8. **config semantics** — env substitution, allowed-paths policy as a shared
   port.

Final step: apps reduced to composition roots → revisit "merge the repos into
one" with evidence about what actually remains.

## Consumption / release contract

- Version = git tag `vX.Y.Z` + GitHub Release with `npm pack` tarball asset.
- Consumers pin the release-asset URL in `dependencies` (lockfile integrity
  pins the hash). Upgrades are explicit URL bumps reviewed like any PR.
- `dist/` committed; consumers never build soma-lib at install time.

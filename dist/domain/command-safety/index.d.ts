/**
 * command-safety — pure domain for classifying shell commands as dangerous.
 *
 * Extracted from soma-work `somalib/permission/dangerous-rules.ts` (2026-08-21).
 * This module is HEXAGONAL DOMAIN CODE: pure functions, no I/O, no framework
 * imports. What to DO with a match (hard-deny, ask-and-escalate, audit-log) is
 * application policy and stays in the consuming app:
 *
 *   - soma-work: matches feed the bypass-mode Bash escalation (ask via Slack
 *     permission UI; `sessionOverridable` rules can be silenced per session),
 *     while lockdown rules are enforced on dedicated parent-side PreToolUse
 *     hooks. See soma-work `src/dangerous-command-filter.ts`.
 *   - soma: project-specific block rules are expressed as `DangerousRule`s via
 *     `createRuleSet` and hard-denied in `checkCommandSafety`.
 *
 * Architecture:
 *   - `DANGEROUS_RULES` is the shared canonical catalog. Each entry carries
 *     `sessionOverridable` which decides whether the rule participates in an
 *     ask/override flow (`true`) or is a lockdown rule (`false`).
 *   - `createRuleSet(rules)` builds a bound engine over ANY catalog — apps with
 *     project-specific rules create their own set; the canonical exports below
 *     are `createRuleSet(DANGEROUS_RULES)` spread flat for backward compat.
 *   - `overridableRulesByIds` / `overridableMatchedRuleIds` expose ONLY the
 *     overridable subset. They are the public surface for ask/override UIs and
 *     out-of-process permission children — lockdown ids are silently filtered
 *     out so the child never sees them, even if a stale id sneaks into a
 *     button payload or a session disable set.
 *   - `matchRules` / `rulesByIds` operate over the full catalog. They are for
 *     parent-side callers that need the lockdown rules (audit logging,
 *     enforcement wiring). They are NOT what a permission child should call.
 *   - `isCrossUserAccess` / `isSshCommand` are standalone matchers meant to be
 *     wired onto dedicated PreToolUse hooks, so an app's bypass state can
 *     never silence them.
 *
 * Lockdown isolation invariant (verified by `command-safety.test.ts`):
 *   For every rule `r` with `r.sessionOverridable === false`,
 *   `overridableRulesByIds([r.id])` is `[]` and `overridableMatchedRuleIds`
 *   never contains `r.id`. Future lockdown rules inherit this property
 *   automatically — no per-rule wiring required.
 */
/**
 * Matcher context passed to per-rule match functions.
 * `userId` is the chat user initiating the command — required by rules that
 * enforce per-user filesystem isolation (e.g. cross-user /tmp access).
 */
export interface DangerousRuleContext {
    readonly userId?: string;
}
/**
 * A single named dangerous-command rule.
 *
 * `id` is a stable, machine-readable identifier used to key session-level
 * disable sets. In soma-work it is part of the action payload sent via Slack
 * buttons, so treat it as a public string and do not rename casually.
 */
export interface DangerousRule {
    readonly id: string;
    /** Short human label shown in permission UIs. */
    readonly label: string;
    /** One-line description used in UI tooltips / logs / deny reasons. */
    readonly description: string;
    /**
     * Whether this rule can be silenced for a single session via an
     * "Approve & disable rule for this session" flow. `false` = lockdown.
     */
    readonly sessionOverridable: boolean;
    /**
     * Predicate that decides whether `command` matches this rule. Must be pure.
     * `ctx.userId` is consulted by rules that need per-user context.
     */
    readonly match: (command: string, ctx: DangerousRuleContext) => boolean;
}
/**
 * A matching engine bound to one rule catalog. Apps with project-specific
 * catalogs call `createRuleSet(theirRules)`; the flat canonical exports below
 * are the same engine bound to `DANGEROUS_RULES`.
 */
export interface RuleSet {
    readonly rules: ReadonlyArray<DangerousRule>;
    /** Every rule that matches `command` — lockdown + overridable. */
    matchRules(command: string, ctx?: DangerousRuleContext): DangerousRule[];
    /** Lookup by id over the FULL catalog. Order preserved; unknown ids dropped. */
    rulesByIds(ruleIds: ReadonlyArray<string>): DangerousRule[];
    /**
     * Matched ids over the OVERRIDABLE subset only (lockdown ids never appear).
     * `ctx` defaults to `{}`, matching the historical canonical behavior —
     * context-sensitive overridable rules only participate when the caller
     * passes their context.
     */
    overridableMatchedRuleIds(command: string, ctx?: DangerousRuleContext): string[];
    /** Lookup by id over the OVERRIDABLE subset only (lockdown/unknown ids dropped). */
    overridableRulesByIds(ruleIds: ReadonlyArray<string>): DangerousRule[];
}
/**
 * Build a matching engine bound to `rules`. The id→rule map is built once.
 * Throws on duplicate rule ids — ids key override/disable sets, so a catalog
 * where two rules share an id is a bug at the definition site, not something
 * to resolve silently by last-write-wins.
 */
export declare function createRuleSet(rules: ReadonlyArray<DangerousRule>): RuleSet;
/**
 * Canonical shared catalog. Declared once, consumed by:
 *   - the flat engine exports below (`matchRules`, `overridableMatchedRuleIds`, …)
 *   - soma-work `bypassBashPermissionDecision` (overridable subset)
 *   - soma-work permission-mcp-server (overridable helpers → Slack buttons)
 */
export declare const DANGEROUS_RULES: ReadonlyArray<DangerousRule>;
/**
 * Return every rule in the canonical catalog that matches `command`.
 * Both overridable and lockdown rules are returned — callers decide what to do.
 *
 * Parent-process callers that want lockdown enforcement should use this. A
 * permission child should NEVER call this — call `overridableMatchedRuleIds`.
 */
export declare function matchRules(command: string, ctx?: DangerousRuleContext): DangerousRule[];
/**
 * Look up rules by id over the FULL canonical catalog (lockdown + overridable).
 * Order preserved; unknown ids silently dropped. Parent-only — a permission
 * child must use `overridableRulesByIds` instead.
 */
export declare function rulesByIds(ruleIds: ReadonlyArray<string>): DangerousRule[];
/**
 * Returns the overridable canonical rule ids that match `command`
 * (cross-user/ssh excluded). Used by out-of-process permission servers to
 * re-derive what rule was responsible for a Bash escalation without
 * re-serialising decision state through an SDK boundary.
 *
 * Lockdown rules (`sessionOverridable === false`) are silently excluded — even
 * if their matcher fires, the id never appears in the result. This is the
 * lockdown isolation invariant permission children rely on.
 */
export declare function overridableMatchedRuleIds(command: string): string[];
/**
 * Look up canonical rules by id over the OVERRIDABLE subset only. Lockdown ids
 * (`sessionOverridable === false`) and unknown ids are silently dropped.
 *
 * This is the surface a permission child uses to render an
 * "Approve & disable rule for this session" button. It MUST NOT return
 * lockdown rule entries — even if a stale lockdown id reaches here through a
 * pending approval payload, the UI must not advertise it as silencable.
 */
export declare function overridableRulesByIds(ruleIds: ReadonlyArray<string>): DangerousRule[];
/**
 * Cross-user directory access detection.
 * Detects commands that reference another user's /tmp/{userId}/ directory.
 * Enforces per-user filesystem isolation — always deny, regardless of bypass mode.
 *
 * Matches both /tmp/{userId} and /private/tmp/{userId} (macOS normalization).
 * Slack user IDs follow pattern: [UW] + uppercase alphanumeric (e.g., U094E5L4A15).
 * Enterprise Grid uses W-prefixed IDs — both must be covered.
 *
 * @internal Parent-process enforcement only. A permission child MUST NOT call
 *   this directly — the ask/override escalation surface
 *   (`overridableMatchedRuleIds` / `overridableRulesByIds`) deliberately
 *   excludes this rule. Cross-user access is denied by a dedicated PreToolUse
 *   hook in the consuming app, independent of bypass state.
 */
export declare function isCrossUserAccess(command: string, currentUserId: string): boolean;
/**
 * Check if a bash command involves SSH (remote server access).
 * SSH commands are admin-only — non-admin users must use a server-tools MCP
 * instead.
 *
 * @internal Parent-process enforcement only. Same isolation contract as
 *   `isCrossUserAccess` — the ask/override escalation surface excludes the
 *   `ssh-remote` rule; SSH commands are denied by a dedicated parent-side
 *   PreToolUse hook in the consuming app.
 */
export declare function isSshCommand(command: string): boolean;

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
export function createRuleSet(rules: ReadonlyArray<DangerousRule>): RuleSet {
  const byId = new Map<string, DangerousRule>();
  for (const rule of rules) {
    if (byId.has(rule.id)) {
      throw new Error(`createRuleSet: duplicate rule id "${rule.id}"`);
    }
    byId.set(rule.id, rule);
  }
  return {
    rules,
    matchRules(command, ctx = {}) {
      return rules.filter((rule) => rule.match(command, ctx));
    },
    rulesByIds(ruleIds) {
      return ruleIds.map((id) => byId.get(id)).filter((r): r is DangerousRule => r !== undefined);
    },
    overridableMatchedRuleIds(command, ctx = {}) {
      return rules.filter((rule) => rule.sessionOverridable && rule.match(command, ctx)).map((rule) => rule.id);
    },
    overridableRulesByIds(ruleIds) {
      return ruleIds
        .map((id) => byId.get(id))
        .filter((r): r is DangerousRule => r !== undefined && r.sessionOverridable);
    },
  };
}

// Interpreter lists are defined once (DRY) to prevent drift between the
// execution-dispatch matchers. Word boundary (\b) after interpreter names
// prevents false positives like `| sha256sum` or `| show`.
const SHELL_INTERPRETERS = 'sh|bash|zsh|dash|ksh|csh|tcsh|fish';
const SCRIPT_INTERPRETERS = 'python[23]?|perl|ruby|node|php';
const ALL_INTERPRETERS = `${SHELL_INTERPRETERS}|${SCRIPT_INTERPRETERS}`;

const EXECUTION_DISPATCH_PATTERNS: ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  regex: RegExp;
}> = [
  {
    id: 'pipe-to-interpreter',
    label: 'pipe to interpreter',
    description: 'Pipe to shell/script interpreter',
    regex: new RegExp(`\\|\\s*(?:${ALL_INTERPRETERS})\\b`, 'i'),
  },
  {
    id: 'pipe-to-path-interpreter',
    label: 'pipe to path/env interpreter',
    description: 'Pipe to absolute-path or env-wrapped interpreter',
    regex: new RegExp(
      `\\|\\s*(?:\\/(?:usr\\/)?(?:local\\/)?(?:s?bin)\\/(?:env\\s+(?:-\\S+\\s+)*)?|env\\s+(?:-\\S+\\s+)*)(?:${ALL_INTERPRETERS})\\b`,
      'i',
    ),
  },
  {
    id: 'pipe-to-busybox',
    label: 'pipe to busybox shell',
    description: 'Pipe to busybox-wrapped shell',
    regex: new RegExp(`\\|\\s*(?:\\/(?:usr\\/)?(?:local\\/)?(?:s?bin)\\/)?busybox\\s+(?:sh|bash|ash|dash)\\b`, 'i'),
  },
  {
    id: 'process-substitution',
    label: 'process substitution fetch',
    description: 'Process substitution with remote fetch',
    regex: new RegExp(`(?:${SHELL_INTERPRETERS})\\s+<\\(\\s*(?:curl|wget)\\b`, 'i'),
  },
  {
    id: 'source-dot-substitution',
    label: 'source remote substitution',
    description: 'Source/dot process substitution with remote fetch',
    // dot-source: `. <(curl ...)` / `source <(curl ...)` — `\.\s` (not just `\.`)
    // because shell requires whitespace after `.` builtin to distinguish from filenames
    regex: /(?:source|\.\s)\s*<\(\s*(?:curl|wget)\b/i,
  },
  {
    id: 'xargs-to-interpreter',
    label: 'xargs to interpreter',
    description: 'Xargs to shell/script interpreter',
    regex: new RegExp(`\\|\\s*xargs\\s+(?:${ALL_INTERPRETERS})\\b`, 'i'),
  },
  {
    id: 'env-wrapped-interpreter',
    label: 'env-wrapped pipe to interpreter',
    description: 'Env-wrapped pipe to interpreter',
    regex: new RegExp(
      `\\|\\s*(?:\\/(?:usr\\/)?(?:local\\/)?(?:s?bin)\\/)?env\\s+(?:-\\S+\\s+)*(?:${ALL_INTERPRETERS})\\b`,
      'i',
    ),
  },
];

/**
 * Execution-dispatch detection rules (curl|sh family), extracted verbatim
 * from soma's `BLOCKED_EXECUTION_RULES` (soma Security Audit S5). Exported as
 * a named subset so soma can keep consuming them as hard-deny lockdown rules
 * while the canonical catalog exposes them as overridable ask rules.
 * Matcher regexes use only the `i` flag — never `/g` or `/y` (matchRules
 * evaluates the whole catalog; a stateful lastIndex would leak between calls).
 */
export const EXECUTION_DISPATCH_RULES: ReadonlyArray<DangerousRule> = EXECUTION_DISPATCH_PATTERNS.map((p) => ({
  id: p.id,
  label: p.label,
  description: p.description,
  sessionOverridable: true,
  match: (cmd: string) => p.regex.test(cmd),
}));

/**
 * Canonical shared catalog. Declared once, consumed by:
 *   - the flat engine exports below (`matchRules`, `overridableMatchedRuleIds`, …)
 *   - soma-work `bypassBashPermissionDecision` (overridable subset)
 *   - soma-work permission-mcp-server (overridable helpers → Slack buttons)
 */
export const DANGEROUS_RULES: ReadonlyArray<DangerousRule> = [
  // Process killing
  {
    id: 'kill',
    label: 'kill process',
    description: 'Sends a signal to a running process. Can terminate sibling sessions.',
    sessionOverridable: true,
    match: (cmd) => /\bkill\b/.test(cmd),
  },
  {
    id: 'pkill',
    label: 'pkill process',
    description: 'Pattern-based process killer.',
    sessionOverridable: true,
    match: (cmd) => /\bpkill\b/.test(cmd),
  },
  {
    id: 'killall',
    label: 'killall process',
    description: 'Kills all processes matching a name.',
    sessionOverridable: true,
    match: (cmd) => /\bkillall\b/.test(cmd),
  },

  // Destructive file operations
  {
    id: 'rm-recursive',
    label: 'recursive delete',
    description: 'rm with -r / -R / --recursive: recursively deletes a tree.',
    sessionOverridable: true,
    match: (cmd) => /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s|.*--recursive)/.test(cmd),
  },
  {
    id: 'rm-force',
    label: 'force delete',
    description: 'rm -f: force-deletes without prompting.',
    sessionOverridable: true,
    match: (cmd) => /\brm\s+-[a-zA-Z]*f/.test(cmd),
  },
  {
    id: 'rm-force-long',
    label: 'force delete (--force)',
    description: 'rm --force: same as -f.',
    sessionOverridable: true,
    match: (cmd) => /\brm\s+.*--force/.test(cmd),
  },

  // System-level operations
  {
    id: 'shutdown',
    label: 'system shutdown',
    description: 'Powers down the host.',
    sessionOverridable: true,
    match: (cmd) => /\bshutdown\b/.test(cmd),
  },
  {
    id: 'reboot',
    label: 'system reboot',
    description: 'Reboots the host.',
    sessionOverridable: true,
    match: (cmd) => /\breboot\b/.test(cmd),
  },
  {
    id: 'halt',
    label: 'system halt',
    description: 'Halts the host.',
    sessionOverridable: true,
    match: (cmd) => /\bhalt\b/.test(cmd),
  },
  {
    id: 'mkfs',
    label: 'format filesystem',
    description: 'Formats a block device — destroys data.',
    sessionOverridable: true,
    match: (cmd) => /\bmkfs\b/.test(cmd),
  },

  // Disk operations
  {
    id: 'dd-if',
    label: 'disk copy (dd)',
    description: 'dd if=...: raw block copy, can overwrite disks.',
    sessionOverridable: true,
    match: (cmd) => /\bdd\s+if=/.test(cmd),
  },

  // Dangerous permission changes
  {
    id: 'chmod-world-recursive',
    label: 'recursive world-writable chmod',
    description: 'chmod -R with world-writable bits.',
    sessionOverridable: true,
    match: (cmd) => /\bchmod\s+(-[a-zA-Z]*R|--recursive)\s+[0-7]*7[0-7]*7/.test(cmd),
  },

  // Execution-dispatch family — promoted from soma (Step 2, 2026-08-21).
  // Detects piping/substituting remote or piped content into an interpreter,
  // which bypasses substring-based blocklists (soma Security Audit S5).
  // Overridable here: soma-work's ask flow can approve legitimate installer
  // pipes; soma consumes the same EXECUTION_DISPATCH_RULES as hard-deny.
  ...EXECUTION_DISPATCH_RULES,

  // Lockdown rules — present in the catalog for labelling/parity only.
  // See file-header notes: these do NOT flow through ask/override escalation.
  {
    id: 'cross-user-access',
    label: 'cross-user /tmp access',
    description: "Accesses another user's /tmp/{userId}/ directory. Blocked for data isolation.",
    sessionOverridable: false,
    match: (cmd, ctx) => (ctx.userId ? isCrossUserAccess(cmd, ctx.userId) : false),
  },
  {
    id: 'ssh-remote',
    label: 'SSH / SCP / SFTP / rsync-over-ssh',
    description: 'Remote shell/file operations. Admin-only. Not silencable per-session.',
    sessionOverridable: false,
    match: (cmd) => isSshCommand(cmd),
  },
];

const CANONICAL = createRuleSet(DANGEROUS_RULES);

/**
 * Return every rule in the canonical catalog that matches `command`.
 * Both overridable and lockdown rules are returned — callers decide what to do.
 *
 * Parent-process callers that want lockdown enforcement should use this. A
 * permission child should NEVER call this — call `overridableMatchedRuleIds`.
 */
export function matchRules(command: string, ctx: DangerousRuleContext = {}): DangerousRule[] {
  return CANONICAL.matchRules(command, ctx);
}

/**
 * Look up rules by id over the FULL canonical catalog (lockdown + overridable).
 * Order preserved; unknown ids silently dropped. Parent-only — a permission
 * child must use `overridableRulesByIds` instead.
 */
export function rulesByIds(ruleIds: ReadonlyArray<string>): DangerousRule[] {
  return CANONICAL.rulesByIds(ruleIds);
}

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
export function overridableMatchedRuleIds(command: string): string[] {
  return CANONICAL.overridableMatchedRuleIds(command);
}

/**
 * Look up canonical rules by id over the OVERRIDABLE subset only. Lockdown ids
 * (`sessionOverridable === false`) and unknown ids are silently dropped.
 *
 * This is the surface a permission child uses to render an
 * "Approve & disable rule for this session" button. It MUST NOT return
 * lockdown rule entries — even if a stale lockdown id reaches here through a
 * pending approval payload, the UI must not advertise it as silencable.
 */
export function overridableRulesByIds(ruleIds: ReadonlyArray<string>): DangerousRule[] {
  return CANONICAL.overridableRulesByIds(ruleIds);
}

// Hoisted at module scope so the regex isn't recompiled per Bash command. The
// `g` flag on TMP_USER_RE means call sites must use `matchAll` (fresh iterator
// per call) instead of `.exec`-in-a-loop, which would carry `lastIndex` state
// across concurrent callers.
const TMP_TRAVERSAL_RE = /(?:\/private)?\/tmp\/[^\s]*\.\./;
const TMP_USER_RE = /(?:\/private)?\/tmp\/([UW][A-Z0-9]+)\b/g;

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
export function isCrossUserAccess(command: string, currentUserId: string): boolean {
  // Reject any /tmp/ path containing traversal segments — prevents escaping
  // own directory via /tmp/U094E5L4A15/../U09F1M5MML1/
  if (TMP_TRAVERSAL_RE.test(command)) {
    return true;
  }

  for (const match of command.matchAll(TMP_USER_RE)) {
    if (match[1] !== currentUserId) {
      return true;
    }
  }
  return false;
}

/**
 * SSH command patterns — matches `ssh`, `scp`, `sftp`, `rsync` over SSH.
 * These commands allow remote server access and must be restricted to admin users.
 */
const SSH_PATTERNS: ReadonlyArray<RegExp> = [/\bssh\b/, /\bscp\b/, /\bsftp\b/, /\brsync\b.*\b-e\s+['"]?ssh/];

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
export function isSshCommand(command: string): boolean {
  return SSH_PATTERNS.some((pattern) => pattern.test(command));
}

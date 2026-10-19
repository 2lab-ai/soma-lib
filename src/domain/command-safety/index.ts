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
 *   - Full-catalog matching (lockdown + overridable) is the `RuleSet` method
 *     `createRuleSet(DANGEROUS_RULES).matchRules`. The flat `matchRules` /
 *     `rulesByIds` exports were removed in 0.8.0: neither consumer ever called
 *     them (soma-work's last `rulesByIds` caller went in #768).
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
 *   - the flat overridable helpers below (`overridableMatchedRuleIds`,
 *     `overridableRulesByIds`) and `createRuleSet(DANGEROUS_RULES)`
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
    match: (cmd) => /\bkill\b/i.test(cmd),
  },
  {
    id: 'pkill',
    label: 'pkill process',
    description: 'Pattern-based process killer.',
    sessionOverridable: true,
    match: (cmd) => /\bpkill\b/i.test(cmd),
  },
  {
    id: 'killall',
    label: 'killall process',
    description: 'Kills all processes matching a name.',
    sessionOverridable: true,
    match: (cmd) => /\bkillall\b/i.test(cmd),
  },

  // Destructive file operations
  {
    id: 'rm-recursive',
    label: 'recursive delete',
    description: 'rm with -r / -R / --recursive: recursively deletes a tree.',
    sessionOverridable: true,
    // Any option group of the same rm command counts (`rm -v -R x`), not only
    // the first; `[^;&|\n]` keeps the scan inside that command.
    // GNU rm permutes, so a group after the operands counts too (`rm x -r`).
    match: (cmd) => /\brm\s(?:[^;&|\n]*\s)?-[a-z]*r[a-z]*(?=\s|$|[;&|])|\brm\s+.*--recursive/i.test(cmd),
  },
  {
    id: 'rm-force',
    label: 'force delete',
    description: 'rm -f: force-deletes without prompting.',
    sessionOverridable: true,
    match: (cmd) => /\brm\s(?:[^;&|\n]*\s)?-[a-z]*f/i.test(cmd),
  },
  {
    id: 'rm-force-long',
    label: 'force delete (--force)',
    description: 'rm --force: same as -f.',
    sessionOverridable: true,
    match: (cmd) => /\brm\s+.*--force/i.test(cmd),
  },

  // System-level operations
  {
    id: 'shutdown',
    label: 'system shutdown',
    description: 'Powers down the host.',
    sessionOverridable: true,
    match: (cmd) => /\bshutdown\b/i.test(cmd),
  },
  {
    id: 'reboot',
    label: 'system reboot',
    description: 'Reboots the host.',
    sessionOverridable: true,
    match: (cmd) => /\breboot\b/i.test(cmd),
  },
  {
    id: 'halt',
    label: 'system halt',
    description: 'Halts the host.',
    sessionOverridable: true,
    match: (cmd) => /\bhalt\b/i.test(cmd),
  },
  {
    id: 'mkfs',
    label: 'format filesystem',
    description: 'Formats a block device — destroys data.',
    sessionOverridable: true,
    match: (cmd) => /\bmkfs\b/i.test(cmd),
  },

  // Disk operations
  {
    id: 'dd-if',
    label: 'disk copy (dd)',
    description: 'dd if=...: raw block copy, can overwrite disks.',
    sessionOverridable: true,
    match: (cmd) => /\bdd\s+if=/i.test(cmd),
  },

  // Dangerous permission changes
  {
    id: 'chmod-world-recursive',
    label: 'recursive world-writable chmod',
    description: 'chmod -R with world-writable bits.',
    sessionOverridable: true,
    // Other option groups may come before or after the recursive one.
    match: (cmd) => /\bchmod\s+(?:-\S+\s+)*?(?:-[a-z]*R[a-z]*|--recursive)\s+(?:-\S+\s+)*[0-7]*7[0-7]*7/i.test(cmd),
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
//
// Case-insensitive, and tolerant of `//` and `./` segments: macOS hosts run on
// case-insensitive APFS, where `/TMP/<id>` and a lowercased `<id>` resolve to
// the same directory as `/tmp/<ID>`.
// Applied per shell word (see `shellWords`), so a quoted path containing a
// space stays one word and its `..` is still seen.
// `..` as a path component, not as part of a name: preceded by `/` or by
// expansion syntax that yields one (`$'..'`, `${x:-..}`), and not followed by a
// filename character — so `..;`, `..&&`, `..{,}`, `..*`, `..$(…)` count, while a
// git range such as `main..HEAD` in a nested `bash -c '…'` word, `notes..txt`, or
// a bare `cd ..` inside a nested script do not. `[\s\S]` rather than `.`: a
// quoted newline or CR is part of the path.
const TMP_TRAVERSAL_RE = /(?:\/private)?\/+tmp(?:\/[\s\S]*)?(?<=[/$'"{:=+?-])\.\.(?![\w.-])/i;
/** Quoting left inside a word, e.g. the inner quotes of a `bash -c '…'` script. */
const RESIDUAL_QUOTING_RE = /["'\\]/g;
const TMP_USER_RE = /(?:\/private)?\/+tmp\/+(?:\.\/+)*([UW][A-Z0-9]+)\b/gi;
/**
 * A segment written with any lowercase letter is a user directory only when it
 * is Slack-id shaped: U/W plus 8 or 10 alphanumerics (Slack's two id lengths),
 * the first a digit (user ids are `U0…` / `W0…`). A heuristic: it keeps
 * ordinary lowercase directories such as `/tmp/uploads2024`,
 * `/tmp/workspace1` or `/tmp/ubuntu2204` ordinary (this rule is a
 * non-overridable deny). All-uppercase segments keep the original, broader
 * reading.
 */
const SLACK_ID_SHAPE_RE = /^[UW]\d(?:[A-Z0-9]{7}|[A-Z0-9]{9})$/;

/**
 * Split a command into shell words the way the shell reads paths: single and
 * double quotes group (and are removed), a backslash escapes the next
 * character, unquoted space, tab or newline separates (bash's default IFS).
 * So `/tmp/\U0…`, `/tmp/"U0…"` and `"/tmp/me/my dir/../../U0…"` each come
 * out as the one path the shell sees.
 * Not a full shell parser: no expansion, no operators.
 */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command.charAt(i);
    if (quote !== null) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) word += command.charAt(++i);
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command.charAt(++i);
      inWord = true;
    } else if (ch === ' ' || ch === '\t' || ch === '\n') {
      // bash's default IFS only; NBSP, U+2028 etc. are part of the word
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else {
      word += ch;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

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
  const current = currentUserId.toUpperCase();
  const words = new Set<string>();
  for (const word of shellWords(command)) {
    words.add(word);
    // A nested script (`bash -c '…'`) is one word that still carries its own
    // quoting; the inner shell reads the path without it.
    words.add(word.replace(RESIDUAL_QUOTING_RE, ''));
  }
  for (const word of words) {
    // Reject any /tmp/ path containing traversal segments — prevents escaping
    // own directory via /tmp/U094E5L4A15/../U09F1M5MML1/
    if (TMP_TRAVERSAL_RE.test(word)) {
      return true;
    }
    for (const match of word.matchAll(TMP_USER_RE)) {
      const segment = match[1] ?? '';
      const folded = segment.toUpperCase();
      if (segment !== folded && !SLACK_ID_SHAPE_RE.test(folded)) continue;
      if (folded !== current) {
        return true;
      }
    }
  }
  return false;
}

/**
 * SSH command patterns — matches `ssh`, `scp`, `sftp`, `rsync` over SSH.
 * These commands allow remote server access and must be restricted to admin users.
 */
const SSH_PATTERNS: ReadonlyArray<RegExp> = [/\bssh\b/i, /\bscp\b/i, /\bsftp\b/i, /\brsync\b.*\b-e\s+['"]?ssh/i];

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

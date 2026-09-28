/**
 * model-effort — the reasoning-effort vocabulary shared by soma and soma-work.
 *
 * Extracted 2026-09-28 from soma-work `src/model-catalog.ts`
 * (`CANONICAL_EFFORT_ORDER`, `clampEffortToModel`) and
 * `src/user-settings-store.ts` (`EFFORT_LEVELS`). soma previously expressed
 * "how hard to think" as a thinking-token budget; it now selects from the
 * same named levels, so both apps agree on the set, the ordering, and the
 * clamp rule when a model does not offer a requested level.
 *
 * Two tiers exist on purpose:
 *   - {@link EFFORT_LEVELS}: everything llmux publishes per model in its
 *     `/llmux/models` catalog (`efforts`). `ultra` exists only on some codex
 *     tiers there.
 *   - {@link SDK_EFFORT_LEVELS}: what the Claude Agent SDK / Claude Code CLI
 *     accepts on `--effort` (`effort must be one of low, medium, high, xhigh,
 *     max`, CLI 2.1.283). A level outside this set cannot travel as the SDK
 *     `effort` option; the app must carry it another way (request-body
 *     override) or clamp it.
 *
 * Pure functions, no I/O. The catalog lookup that says which levels a model
 * supports stays app-side (each app owns its catalog store); this module
 * only reasons over a `supported` list it is handed.
 */
/** Canonical effort ordering, weakest → strongest. */
export declare const EFFORT_LEVELS: readonly ["low", "medium", "high", "xhigh", "max", "ultra"];
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
/** The subset the Claude Agent SDK `effort` option / CLI `--effort` accepts. */
export declare const SDK_EFFORT_LEVELS: readonly ["low", "medium", "high", "xhigh", "max"];
export type SdkEffortLevel = (typeof SDK_EFFORT_LEVELS)[number];
export declare function isEffortLevel(value: unknown): value is EffortLevel;
export declare function isSdkEffortLevel(value: unknown): value is SdkEffortLevel;
/**
 * Normalize free-form user input (`" XHigh "`) to a level, or `null` when it
 * names no known level. Only case/whitespace are forgiven — no fuzzy aliases,
 * so a typo never silently picks a neighbour.
 */
export declare function normalizeEffortInput(input: string): EffortLevel | null;
/** Position on the canonical ordering; `-1` for unknown strings. */
export declare function effortRank(level: string): number;
/** Total order over known levels (unknown strings sort first, stably). */
export declare function compareEffort(a: string, b: string): number;
/**
 * The known levels in `supported`, deduplicated and sorted canonically.
 * Unknown strings (a future level this build has not heard of) are dropped —
 * they cannot be ordered, so they cannot take part in a clamp.
 */
export declare function rankSupportedEfforts(supported: readonly string[]): EffortLevel[];
/**
 * Clamp `effort` to what a model supports.
 *
 * - `supported` null/empty → `effort` unchanged (nothing is known, so nothing
 *   is enforced — the caller decides whether to send it at all).
 * - `effort` in the menu → unchanged (case/whitespace normalized).
 * - Otherwise → the strongest supported level that is ≤ the requested one;
 *   if none is weaker, the weakest supported level. (grok-4.5: xhigh→high,
 *   max→high; a menu of only `medium` turns `low` into `medium`.)
 * - `effort` unknown to the ordering → unchanged (cannot be placed).
 *
 * Verbatim semantics of soma-work `clampEffortToModel` (2026-07), minus the
 * catalog singleton: the caller passes the model's menu.
 */
export declare function clampEffortToSupported(supported: readonly string[] | null | undefined, effort: string): string;

/**
 * model-catalog — the normalized shape of one llmux `/llmux/models` row.
 *
 * Extracted 2026-09-28 from the two byte-near-identical `normalizeEntries`
 * functions in soma `src/config/model-catalog.ts` and soma-work
 * `src/model-catalog.ts`. Both apps keep their own catalog STORE (fetch
 * cadence, snapshot file, menu policy, alias resolution) — that is runtime
 * policy and stays app-side. What they must agree on is what a row IS once
 * it crosses the wire, so a snapshot written by one reading is loadable by
 * the other and the effort/context-window fields mean the same thing.
 *
 * Accepted input shapes: the wire payload (`max_context`) and a previously
 * persisted snapshot (`maxContext`). Entries without a usable string `id`
 * are dropped; ids are deduplicated case-insensitively, first wins.
 */
export interface CatalogModel {
    /** Model id as llmux serves it (may carry the `[1m]` suffix). */
    id: string;
    /** Display name; falls back to the id. */
    name: string;
    /** Backend group (`claude`, `codex`, `grok`, …), lowercased. */
    group: string;
    /** Effort levels llmux will accept for this row, lowercased. Empty = unknown. */
    efforts: string[];
    /** llmux shorthand aliases (`fable`, `astra`, …), lowercased. */
    aliases: string[];
    /** Declared context window in tokens, or `null` when unknown. */
    maxContext: number | null;
}
export interface NormalizeCatalogOptions {
    /**
     * Group to assign when the row carries no usable `group`. Default: `""`
     * (soma-work convention — "unknown"); soma passes an id-prefix inference.
     */
    fallbackGroup?: (id: string) => string;
}
/**
 * Defensive normalization of catalog rows (wire or snapshot): any JSON shape
 * is tolerated (non-objects, missing/typed-wrong fields, duplicate ids) and
 * never throws on row *content*. An exception thrown by the caller-supplied
 * `fallbackGroup` is a caller bug and is NOT swallowed — it propagates.
 * The callback's result is trimmed and lowercased so `group` keeps the
 * documented invariant whether it was declared or inferred.
 */
export declare function normalizeCatalogEntries(raw: readonly unknown[], options?: NormalizeCatalogOptions): CatalogModel[];

"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCatalogEntries = normalizeCatalogEntries;
function cleanStringList(value) {
    return Array.isArray(value)
        ? value
            .filter((x) => typeof x === "string" && x.trim().length > 0)
            .map((x) => x.trim().toLowerCase())
        : [];
}
/**
 * Defensive normalization of catalog rows (wire or snapshot). Never throws.
 */
function normalizeCatalogEntries(raw, options = {}) {
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
        if (!entry || typeof entry !== "object")
            continue;
        const e = entry;
        const id = typeof e.id === "string" ? e.id.trim() : "";
        if (id.length === 0)
            continue;
        const key = id.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        const rawWindow = e.max_context ?? e.maxContext;
        const maxContext = typeof rawWindow === "number" && Number.isFinite(rawWindow) && rawWindow > 0
            ? rawWindow
            : null;
        const declaredGroup = typeof e.group === "string" && e.group.trim().length > 0
            ? e.group.trim().toLowerCase()
            : "";
        const group = declaredGroup.length > 0 ? declaredGroup : (options.fallbackGroup?.(id) ?? "");
        out.push({
            id,
            name: typeof e.name === "string" && e.name.trim().length > 0 ? e.name.trim() : id,
            group,
            efforts: cleanStringList(e.efforts),
            aliases: cleanStringList(e.aliases),
            maxContext,
        });
    }
    return out;
}

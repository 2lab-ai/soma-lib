import { describe, expect, test } from "vitest";
import * as api from "./index";
import { normalizeCatalogEntries } from "./index";

const WIRE = [
  {
    id: "claude-opus-5-5[1m]",
    name: "Claude Opus 5.5",
    group: "claude",
    efforts: ["Low", " medium", "high", "xhigh", "max"],
    aliases: ["Opus", "opus-5-5"],
    max_context: 1_000_000,
  },
  {
    id: "gpt-6-astra",
    name: "",
    group: "codex",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    aliases: [],
    max_context: 272_000,
  },
];

describe("normalizeCatalogEntries", () => {
  test("normalizes a wire row: trims, lowercases lists, maps max_context", () => {
    const [opus] = normalizeCatalogEntries(WIRE);
    expect(opus).toEqual({
      id: "claude-opus-5-5[1m]",
      name: "Claude Opus 5.5",
      group: "claude",
      efforts: ["low", "medium", "high", "xhigh", "max"],
      aliases: ["opus", "opus-5-5"],
      maxContext: 1_000_000,
    });
  });

  test("name falls back to the id; ultra survives in efforts", () => {
    const [, astra] = normalizeCatalogEntries(WIRE);
    expect(astra?.name).toBe("gpt-6-astra");
    expect(astra?.efforts).toContain("ultra");
  });

  test("accepts the snapshot spelling (maxContext) and rejects bad windows", () => {
    const rows = normalizeCatalogEntries([
      { id: "a", maxContext: 200_000 },
      { id: "b", max_context: 0 },
      { id: "c", max_context: "1000" },
      { id: "d", maxContext: Number.NaN },
    ]);
    expect(rows.map((r) => r.maxContext)).toEqual([200_000, null, null, null]);
  });

  test("drops entries without a usable id and dedupes case-insensitively (first wins)", () => {
    const rows = normalizeCatalogEntries([
      null,
      "x",
      { name: "no id" },
      { id: "  " },
      { id: "Grok-4.7", name: "first" },
      { id: "grok-4.7", name: "second" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("Grok-4.7");
    expect(rows[0]?.name).toBe("first");
  });

  test("missing efforts/aliases become empty lists, non-strings are dropped", () => {
    const [row] = normalizeCatalogEntries([{ id: "x", efforts: ["high", 3, ""], aliases: "nope" }]);
    expect(row?.efforts).toEqual(["high"]);
    expect(row?.aliases).toEqual([]);
  });

  test("group: declared wins, else fallbackGroup, else empty string", () => {
    const rows = normalizeCatalogEntries(
      [
        { id: "claude-x", group: " Claude " },
        { id: "gpt-y" },
        { id: "z", group: "" },
      ],
      { fallbackGroup: (id) => (id.startsWith("gpt-") ? "codex" : "other") }
    );
    expect(rows.map((r) => r.group)).toEqual(["claude", "codex", "other"]);
    expect(normalizeCatalogEntries([{ id: "q" }])[0]?.group).toBe("");
  });

  test("never throws on garbage input", () => {
    expect(normalizeCatalogEntries([undefined, 1, [], () => 0] as unknown[])).toEqual([]);
  });
});

describe("public surface", () => {
  test("exports exactly the documented symbols", () => {
    expect(Object.keys(api).sort()).toEqual(["normalizeCatalogEntries"]);
  });
});

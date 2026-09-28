import { describe, expect, test } from "vitest";
import * as api from "./index";
import {
  EFFORT_LEVELS,
  SDK_EFFORT_LEVELS,
  clampEffortToSupported,
  compareEffort,
  effortRank,
  isEffortLevel,
  isSdkEffortLevel,
  normalizeEffortInput,
  rankSupportedEfforts,
} from "./index";

describe("effort vocabulary", () => {
  test("canonical order is weakest → strongest and the SDK subset is its prefix", () => {
    expect(EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(SDK_EFFORT_LEVELS).toEqual(EFFORT_LEVELS.slice(0, 5));
  });

  test("guards distinguish the two tiers", () => {
    expect(isEffortLevel("ultra")).toBe(true);
    expect(isSdkEffortLevel("ultra")).toBe(false);
    expect(isSdkEffortLevel("max")).toBe(true);
    expect(isEffortLevel("minimal")).toBe(false);
    expect(isEffortLevel(42)).toBe(false);
  });

  test("normalizeEffortInput forgives case/whitespace only", () => {
    expect(normalizeEffortInput(" XHigh ")).toBe("xhigh");
    expect(normalizeEffortInput("ULTRA")).toBe("ultra");
    expect(normalizeEffortInput("x-high")).toBeNull();
    expect(normalizeEffortInput("")).toBeNull();
  });

  test("effortRank / compareEffort follow the canonical order", () => {
    expect(effortRank("low")).toBe(0);
    expect(effortRank("ultra")).toBe(5);
    expect(effortRank("bogus")).toBe(-1);
    expect(compareEffort("max", "high")).toBeGreaterThan(0);
    expect([...EFFORT_LEVELS].reverse().sort(compareEffort)).toEqual([...EFFORT_LEVELS]);
  });

  test("rankSupportedEfforts dedupes, normalizes and drops unknown strings", () => {
    expect(rankSupportedEfforts(["MAX", "low", "max", "turbo", " high "])).toEqual([
      "low",
      "high",
      "max",
    ]);
    expect(rankSupportedEfforts([])).toEqual([]);
  });
});

describe("clampEffortToSupported (soma-work clampEffortToModel semantics)", () => {
  const grok45 = ["low", "medium", "high"];

  test("unknown menu → effort as-is", () => {
    expect(clampEffortToSupported(null, "xhigh")).toBe("xhigh");
    expect(clampEffortToSupported(undefined, "xhigh")).toBe("xhigh");
    expect(clampEffortToSupported([], "xhigh")).toBe("xhigh");
  });

  test("effort in the menu → unchanged, normalized when needed", () => {
    expect(clampEffortToSupported(grok45, "high")).toBe("high");
    expect(clampEffortToSupported(grok45, " High ")).toBe("high");
  });

  test("steps down to the strongest supported level ≤ requested", () => {
    expect(clampEffortToSupported(grok45, "xhigh")).toBe("high");
    expect(clampEffortToSupported(grok45, "max")).toBe("high");
    expect(clampEffortToSupported(["low", "high"], "medium")).toBe("low");
  });

  test("nothing weaker → weakest supported level", () => {
    expect(clampEffortToSupported(["medium", "high"], "low")).toBe("medium");
  });

  test("ultra clamps to max on a claude menu, survives on a codex menu", () => {
    const claude = ["low", "medium", "high", "xhigh", "max"];
    expect(clampEffortToSupported(claude, "ultra")).toBe("max");
    expect(clampEffortToSupported([...claude, "ultra"], "ultra")).toBe("ultra");
  });

  test("effort unknown to the ordering → unchanged", () => {
    expect(clampEffortToSupported(grok45, "turbo")).toBe("turbo");
  });

  test("menu made only of unknown strings → effort unchanged", () => {
    expect(clampEffortToSupported(["turbo"], "xhigh")).toBe("xhigh");
  });
});

describe("public surface", () => {
  test("exports exactly the documented symbols", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "EFFORT_LEVELS",
        "SDK_EFFORT_LEVELS",
        "clampEffortToSupported",
        "compareEffort",
        "effortRank",
        "isEffortLevel",
        "isSdkEffortLevel",
        "normalizeEffortInput",
        "rankSupportedEfforts",
      ].sort()
    );
  });
});

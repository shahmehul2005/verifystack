import { describe, expect, it } from "vitest";
import { ADEETIE_FOUNDRY_V1 } from "../packs/adeetie";
import { CCTS_CEMENT_V1 } from "../packs/cement";
import { deriveEquipmentTags } from "./equipment";
import { SYNTHETIC_ECM_LIBRARY } from "./fixture";
import { gapFromGeiResult, gapFromSecRuns, impliedSecBenchmark } from "./gap";
import { matchEcmLibrary, parseSavingsRange, relevanceDistance } from "./match";
import { ECM_NO_MATCH_MESSAGE } from "./types";

describe("parseSavingsRange", () => {
  it("reads a hyphenated percent range and ignores the trailing label", () => {
    expect(parseSavingsRange("8-15% of related SEC")).toEqual({ min: 8, max: 15 });
  });

  it("reads a single percentage", () => {
    expect(parseSavingsRange("8%")).toEqual({ min: 8, max: 8 });
  });

  it("reads an en-dash range", () => {
    expect(parseSavingsRange("10–20 percent")).toEqual({ min: 10, max: 20 });
  });

  it("returns null when nothing numeric is present", () => {
    expect(parseSavingsRange("not stated")).toBeNull();
    expect(parseSavingsRange(null)).toBeNull();
  });
});

describe("deriveEquipmentTags", () => {
  it("emits streamIds only for energy bindings that have a quantity fact", () => {
    const tags = deriveEquipmentTags(ADEETIE_FOUNDRY_V1, [
      { field_path: "coke.quantity" },
      { field_path: "electricity.activeEnergy" },
      { field_path: "production" },
    ]);
    expect(tags).toEqual(["coke", "grid-electricity"]);
  });

  it("does not invent tags for unbound streams", () => {
    const tags = deriveEquipmentTags(ADEETIE_FOUNDRY_V1, [{ field_path: "production" }]);
    expect(tags).toEqual([]);
  });

  it("uses GEI stream_bindings for CCTS packs", () => {
    const tags = deriveEquipmentTags(CCTS_CEMENT_V1, [
      { field_path: "quantity" },
      { field_path: "activeEnergy" },
    ]);
    expect(tags).toContain("coal-kiln");
    expect(tags).toContain("grid-ht");
    expect(tags).not.toContain("petcoke-kiln");
  });
});

describe("intensity gap", () => {
  it("computes GEI gap vs the notified target", () => {
    const gap = gapFromGeiResult({ gei: 1.0, geiTarget: 0.82 });
    expect(gap).not.toBeNull();
    expect(gap!.metric).toBe("GEI");
    expect(gap!.gapPct).toBeCloseTo(18, 4);
  });

  it("uses the scheme savings gate as the implied SEC benchmark", () => {
    expect(impliedSecBenchmark(10, 10)).toBeCloseTo(9, 6);
    const gap = gapFromSecRuns({ baselineSec: 10, minSavingsPct: 10 });
    expect(gap).not.toBeNull();
    expect(gap!.metric).toBe("SEC");
    expect(gap!.gapPct).toBeCloseTo(10, 4);
  });

  it("narrows the SEC gap once a post-implementation result exists", () => {
    const gap = gapFromSecRuns({ baselineSec: 10, postSec: 9.4, minSavingsPct: 10 });
    expect(gap!.gapPct).toBeCloseTo(((9.4 - 9) / 9.4) * 100, 4);
  });
});

describe("matchEcmLibrary", () => {
  const foundry = {
    sectorOrCluster: "Foundry",
    scheme: "ADEETIE" as const,
    equipmentTags: ["coke", "grid-electricity"],
    gapPct: 12,
  };

  it("returns expected fixture rows for a known equipment/gap profile, ranked", () => {
    const result = matchEcmLibrary(foundry, SYNTHETIC_ECM_LIBRARY);
    expect(result.status).toBe("matched");
    expect(result.message).toBeNull();
    const ids = result.ranked.map((r) => r.row.id);
    expect(ids).toEqual([
      "00000000-0000-4000-a000-000000000001", // coke 8-15, gap 12 sits nearer the midpoint
      "00000000-0000-4000-a000-000000000002", // grid-electricity 10-20
    ]);
    expect(result.ranked.every((r) => r.row.sectorOrCluster === "Foundry")).toBe(true);
    expect(result.ranked.map((r) => r.row.equipmentTag).sort()).toEqual([
      "coke",
      "grid-electricity",
    ]);
    // Brass coke and Cement kiln must not leak across sector/tag filters.
    expect(ids).not.toContain("00000000-0000-4000-a000-000000000006");
    expect(ids).not.toContain("00000000-0000-4000-a000-000000000004");
    expect(result.ranked[0]!.relevance).toBeLessThan(result.ranked[1]!.relevance);
  });

  it("ranks a closer savings-range ahead of a farther one", () => {
    const result = matchEcmLibrary(
      { ...foundry, equipmentTags: ["coke", "png"], gapPct: 4 },
      SYNTHETIC_ECM_LIBRARY
    );
    expect(result.ranked.map((r) => r.row.equipmentTag)).toEqual(["png", "coke"]);
    expect(relevanceDistance(4, parseSavingsRange("3-6% of related SEC"))).toBeLessThan(
      relevanceDistance(4, parseSavingsRange("8-15% of related SEC"))!
    );
  });

  it("says no matching ECM in library when nothing matches, and does not improvise", () => {
    const result = matchEcmLibrary(
      {
        sectorOrCluster: "Foundry",
        scheme: "ADEETIE",
        equipmentTags: ["onsite-renewable"],
        gapPct: 12,
      },
      SYNTHETIC_ECM_LIBRARY
    );
    expect(result.status).toBe("no_match");
    expect(result.message).toBe(ECM_NO_MATCH_MESSAGE);
    expect(result.ranked).toEqual([]);
  });

  it("says no match when the facility has no bound equipment tags", () => {
    const result = matchEcmLibrary(
      {
        sectorOrCluster: "Foundry",
        scheme: "ADEETIE",
        equipmentTags: [],
        gapPct: 12,
      },
      SYNTHETIC_ECM_LIBRARY
    );
    expect(result.status).toBe("no_match");
    expect(result.message).toBe(ECM_NO_MATCH_MESSAGE);
    expect(result.ranked).toEqual([]);
  });

  it("does not invent a row when the library is empty", () => {
    const result = matchEcmLibrary(foundry, []);
    expect(result.status).toBe("no_match");
    expect(result.message).toBe(ECM_NO_MATCH_MESSAGE);
    expect(result.ranked).toEqual([]);
  });
});

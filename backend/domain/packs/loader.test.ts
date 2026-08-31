import { describe, expect, it } from "vitest";
import {
  loadPack,
  listPacks,
  assertRunnable,
  canStartWork,
  validateRegistry,
  PackError,
} from "./loader";
import { ADEETIE_SECTORS } from "./adeetie";

describe("pack loader", () => {
  it("loads CCTS-CEMENT-v1 as runnable GEI with reconciliation rules", () => {
    const pack = loadPack("CCTS-CEMENT-v1");
    expect(pack.status).toBe("runnable");
    expect(pack.scheme).toBe("CCTS");
    expect(pack.sector_or_cluster).toBe("Cement");
    expect(pack.calculation_method).toBe("GEI");
    expect(pack.reconciliation_rules).toContain("MB001");
    expect(canStartWork(pack)).toBe(true);
    expect(() => assertRunnable(pack)).not.toThrow();
  });

  it("returns structured clones so callers cannot mutate the registry", () => {
    const a = loadPack("CCTS-CEMENT-v1");
    a.status = "scaffold";
    expect(loadPack("CCTS-CEMENT-v1").status).toBe("runnable");
  });

  it("loads Iron & Steel, Aluminium, and the remaining six CCTS sectors as runnable GEI packs", () => {
    const ccts = listPacks({ scheme: "CCTS" });
    expect(ccts).toHaveLength(9);
    expect(listPacks({ scheme: "CCTS", status: "scaffold" })).toHaveLength(0);
    for (const p of ccts) {
      expect(p.status).toBe("runnable");
      expect(p.calculation_method).toBe("GEI");
      expect(p.stream_bindings.length).toBeGreaterThan(0);
      expect(p.production_binding).toBeDefined();
      expect(canStartWork(p)).toBe(true);
      expect(() => assertRunnable(p)).not.toThrow();
    }
  });

  it("declares the aluminium PFC stream without holding a PFC factor value", () => {
    const pack = loadPack("CCTS-ALUMINIUM-v1");
    const pfc = pack.stream_bindings.find((s) => s.streamId === "pfc-anode-effect");
    expect(pfc?.kind).toBe("process_direct");
    // The quantity must be supplied from the smelter's own derivation, never
    // inferred from a factor this system made up.
    expect(pfc && "factorKey" in pfc).toBe(false);
  });

  it("registers one runnable ADEETIE pack per Phase 1 sector, with notified clusters", () => {
    const adeetie = listPacks({ scheme: "ADEETIE" });
    expect(adeetie).toHaveLength(ADEETIE_SECTORS.length);
    expect(adeetie.map((p) => p.sector_or_cluster).sort()).toEqual(
      [...ADEETIE_SECTORS].sort()
    );
    expect(listPacks({ scheme: "ADEETIE", status: "scaffold" })).toHaveLength(0);

    for (const p of adeetie) {
      expect(p.status).toBe("runnable");
      expect(p.calculation_method).toBe("SEC");
      expect(p.energy_bindings?.length).toBeGreaterThan(0);
      expect(p.production_binding).toBeDefined();
      expect(p.adeetie).toBeDefined();
      expect(p.adeetie!.clusters.length).toBeGreaterThan(0);
      expect(canStartWork(p)).toBe(true);
    }

    const foundry = loadPack("ADEETIE-FOUNDRY-v1");
    expect(foundry.energy_bindings?.some((b) => b.streamId === "coke")).toBe(true);
  });

  it("carries the notified cluster list on every ADEETIE pack, flagged unverified", () => {
    for (const p of listPacks({ scheme: "ADEETIE" })) {
      expect(p.adeetie).toBeDefined();
      expect(p.adeetie!.clusters.length).toBeGreaterThan(0);
      expect(p.adeetie!.clustersVerified).toBe(false);
      expect(p.adeetie!.clusterSource).toMatch(/TO VERIFY/);
    }
  });

  it("holds no structurally invalid runnable pack in the registry", () => {
    expect(validateRegistry()).toEqual([]);
  });

  it("throws on unknown pack ids", () => {
    expect(() => loadPack("CCTS-MADE-UP-v1")).toThrow(PackError);
  });

  it("resolves superseded v0 scaffold ids to the matching v1 pack", () => {
    const pack = loadPack("CCTS-TEXTILES-v0");
    expect(pack.pack_id).toBe("CCTS-TEXTILES-v1");
    expect(pack.status).toBe("runnable");
    expect(loadPack("ADEETIE-BRASS-v0").pack_id).toBe("ADEETIE-BRASS-v1");
  });
});

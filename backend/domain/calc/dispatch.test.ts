import { describe, expect, it } from "vitest";
import { MethodNotImplementedError, requireEngine, resolveMethod } from "./dispatch";
import { canStartWork, listStructurePacks, loadPack, validateRegistry } from "../packs";

describe("resolveMethod", () => {
  it("routes the implemented methods", () => {
    expect(resolveMethod(loadPack("CCTS-CEMENT-v1"))).toMatchObject({ implemented: true, engine: "GEI" });
    expect(resolveMethod(loadPack("ADEETIE-FOUNDRY-v1"))).toMatchObject({ implemented: true, engine: "SEC" });
  });

  it("refuses structure-only methods with a reason instead of falling through", () => {
    for (const pack of listStructurePacks()) {
      const d = resolveMethod(pack);
      expect(d.implemented).toBe(false);
      if (!d.implemented) expect(d.reason).toContain(pack.pack_id);
      expect(() => requireEngine(pack.pack_id)).toThrow(MethodNotImplementedError);
    }
  });
});

describe("structure-only packs", () => {
  it("cannot start work and carry no figures", () => {
    for (const pack of listStructurePacks()) {
      expect(canStartWork(pack)).toBe(false);
      expect(pack.emission_or_energy_factors).toEqual([]);
      expect(pack.stream_bindings).toEqual([]);
      expect(pack.structure_only?.openItems.length).toBeGreaterThan(0);
      expect(pack.technical_review_required ?? false).toBe(false);
    }
  });

  it("pass registry validation, which now covers them", () => {
    expect(validateRegistry()).toEqual([]);
  });
});

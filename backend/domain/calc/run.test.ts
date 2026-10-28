import { describe, expect, it } from "vitest";
import { SEED_FACTS } from "@verifystack/backend/fixtures/seed";
import { executeRun, chainHash, mapFactsToCalcInput, assessRunReadiness } from "./run";
import { hashInputs } from "./engine";
import { loadPack } from "../packs";
import type { ProvenancedFact } from "./run";

function facts(): ProvenancedFact[] {
  return SEED_FACTS.map((f) => ({
    id: f.id,
    field_path: f.field,
    value_json: f.value,
    unit: f.unit ?? null,
    document_id: f.documentId,
    page: f.page,
    bbox: f.bbox,
    source_text: f.sourceText,
  }));
}

describe("calculation run wrapper", () => {
  it("maps seed facts to a hash-stable GEI run without rewriting the engine", () => {
    const run = executeRun({
      engagementId: "eng-rjk-cem-fy2526",
      organizationId: "org-demo",
      packId: "CCTS-CEMENT-v1",
      packVersion: "1.0.0",
      complianceYear: "FY2025-26",
      geiTarget: 0.82,
      draftMode: true,
      facts: facts(),
    });
    expect(run.engineVersion).toBeTruthy();
    expect(run.packId).toBe("CCTS-CEMENT-v1");
    expect(run.inputHash).toBe(hashInputs(run.input));
    expect(run.inputHash).toHaveLength(64);
    expect(run.result.gei).toBeGreaterThan(0);
    expect(run.draftMode).toBe(true);
    expect(run.chainHash).toBe(chainHash(run.inputHash, null));
  });

  it("chains consecutive runs", () => {
    const first = executeRun({
      engagementId: "eng-rjk-cem-fy2526",
      organizationId: "org-demo",
      packId: "CCTS-CEMENT-v1",
      packVersion: "1.0.0",
      complianceYear: "FY2025-26",
      draftMode: true,
      facts: facts(),
    });
    const second = executeRun({
      engagementId: "eng-rjk-cem-fy2526",
      organizationId: "org-demo",
      packId: "CCTS-CEMENT-v1",
      packVersion: "1.0.0",
      complianceYear: "FY2025-26",
      draftMode: true,
      facts: facts(),
      previousRunHash: first.inputHash,
    });
    expect(second.previousRunHash).toBe(first.inputHash);
    expect(second.chainHash).not.toBe(first.chainHash);
    expect(second.inputHash).toBe(first.inputHash);
  });

  it("refuses unknown packs and missing provenance", () => {
    expect(() =>
      executeRun({
        engagementId: "e",
        organizationId: "o",
        packId: "CCTS-MADE-UP-v1",
        packVersion: "1.0.0",
        complianceYear: "FY2025-26",
        draftMode: true,
        facts: facts(),
      })
    ).toThrow(/Unknown methodology pack/);

    const pack = loadPack("CCTS-CEMENT-v1");
    const broken = facts();
    broken[0] = { ...broken[0]!, source_text: "" };
    expect(() =>
      mapFactsToCalcInput(pack, {
        engagementId: "e",
        complianceYear: "FY2025-26",
        draftMode: true,
        facts: broken,
      })
    ).toThrow(/provenance/i);
  });

  it("reports missing production as not runnable even when other D4 facts exist", () => {
    const pack = loadPack("CCTS-CEMENT-v1");
    const withoutProd = facts().filter((f) => f.field_path !== "production");
    const ready = assessRunReadiness(pack, withoutProd, { draftMode: true });
    expect(ready.factCount).toBeGreaterThan(0);
    expect(ready.canRun).toBe(false);
    expect(ready.blockers.join(" ")).toMatch(/production/i);
  });

  it("blocks a run when fuel has a quantity but no calorific value, instead of dropping it", () => {
    const pack = loadPack("CCTS-CEMENT-v1");
    const noCv = facts().filter((f) => f.field_path !== "calorificValue");
    const ready = assessRunReadiness(pack, noCv, { draftMode: true });
    expect(ready.canRun).toBe(false);
    expect(ready.blockers.join(" ")).toMatch(/calorific value/i);
    expect(() =>
      mapFactsToCalcInput(pack, { engagementId: "e", complianceYear: "FY2025-26", draftMode: true, facts: noCv })
    ).toThrow(/calorific value/i);
  });

  it("treats a stream with no facts as optional and says it is counted as zero", () => {
    const pack = loadPack("CCTS-CEMENT-v1");
    const only = facts().filter((f) => ["quantity", "calorificValue", "production"].includes(f.field_path));
    const ready = assessRunReadiness(pack, only, { draftMode: true });
    expect(ready.canRun).toBe(true);
    expect(ready.warnings.join(" ")).toMatch(/counted as zero/i);
  });
});

import { describe, expect, it } from "vitest";
import { SEED_FACTS } from "@verifystack/backend/fixtures/seed";
import { executeRun, chainHash, mapFactsToCalcInput, assessRunReadiness } from "./run";
import { hashInputs, CalcError } from "./engine";
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

function processFact(id: string, value: number): ProvenancedFact {
  return {
    id,
    field_path: "process.calcinationEmissions",
    value_json: value,
    unit: "tCO2e",
    document_id: "doc-process",
    page: 1,
    bbox: { x: 0.2, y: 0.3, width: 0.36, height: 0.04 },
    source_text: `${value} tCO2e process CO2`,
  };
}

/** First seed fact for each path, so a tag is not asked to choose between two values. */
function oneFactPerPath(paths: readonly string[]): ProvenancedFact[] {
  const seen = new Set<string>();
  const out: ProvenancedFact[] = [];
  for (const fact of facts()) {
    if (!paths.includes(fact.field_path) || seen.has(fact.field_path)) continue;
    seen.add(fact.field_path);
    out.push(fact);
  }
  return out;
}

function cementFactsWithProcess(value = 1000, id = "fact-calcination"): ProvenancedFact[] {
  return [
    ...oneFactPerPath(["quantity", "calorificValue", "activeEnergy", "production"]),
    processFact(id, value),
  ];
}

const cementRun = {
  engagementId: "eng-rjk-cem-fy2526",
  organizationId: "org-demo",
  packId: "CCTS-CEMENT-v1",
  packVersion: "1.0.0",
  complianceYear: "FY2025-26",
  geiTarget: 0.82,
  draftMode: true,
} as const;

describe("calculation run wrapper", () => {
  it("refuses seed facts when process CO2 is absent", () => {
    const pack = loadPack("CCTS-CEMENT-v1");
    const ready = assessRunReadiness(pack, facts(), { draftMode: true });
    expect(ready.canRun).toBe(false);
    expect(ready.blockers.join(" ")).toContain(
      'Calculation tag "calorificValue" has more than one accepted value (4200, 17.58). The run will not choose one.'
    );
    expect(ready.blockers.join(" ")).toContain("process.calcinationEmissions");

    // FY2027-28 is after the first trajectory period, so process CO2 is required.
    const runSeed = () => executeRun({ ...cementRun, complianceYear: "FY2027-28", facts: facts() });
    expect(runSeed).toThrow(CalcError);
    expect(runSeed).toThrow(/process\.calcinationEmissions/);
    expect(runSeed).toThrow(/will not choose/);
    expect(() =>
      mapFactsToCalcInput(pack, {
        engagementId: "e",
        complianceYear: "FY2027-28",
        draftMode: true,
        facts: facts(),
      })
    ).toThrow(/process\.calcinationEmissions/);
  });

  describe("process CO2 and the intensity basis (Detailed Procedure Section 3.4(1) Note, p. 7)", () => {
    const pack = loadPack("CCTS-CEMENT-v1");
    const noProcess = () => oneFactPerPath(["quantity", "calorificValue", "activeEnergy", "production"]);
    const rawMeal = (value: number): ProvenancedFact => ({
      ...processFact("fact-raw-meal", value),
      field_path: "process.rawMealCalcinationEmissions",
    });

    it("does not block a FY2024-25 to FY2026-27 run for missing calcination, and says why", () => {
      for (const year of ["FY2024-25", "FY2025-26", "FY2026-27"]) {
        const ready = assessRunReadiness(pack, noProcess(), { draftMode: true, complianceYear: year });
        expect(ready.blockers, year).toEqual([]);
        expect(ready.canRun, year).toBe(true);
        expect(ready.basisNotes.join(" ")).toContain("Section 3.4(1) Note, p. 7");
        expect(ready.streams.find((s) => s.streamId === "clinker-calcination")?.required).toBe(false);
        const input = mapFactsToCalcInput(pack, { engagementId: "e", complianceYear: year, draftMode: true, facts: noProcess() });
        expect(input.streams.some((s) => s.kind === "process_direct")).toBe(false);
      }
    });

    it("still requires calcination before the window and after it", () => {
      for (const year of ["FY2023-24", "FY2027-28", "FY2030-31"]) {
        const ready = assessRunReadiness(pack, noProcess(), { draftMode: true, complianceYear: year });
        expect(ready.canRun, year).toBe(false);
        expect(ready.blockers.join(" ")).toContain("process.calcinationEmissions");
        expect(() => mapFactsToCalcInput(pack, { engagementId: "e", complianceYear: year, draftMode: true, facts: noProcess() })).toThrow(
          /process\.calcinationEmissions/
        );
      }
    });

    it("keeps the stricter path when the year label cannot be placed", () => {
      for (const year of ["", "2026", "next year", "FY2026-28"]) {
        expect(assessRunReadiness(pack, noProcess(), { draftMode: true, complianceYear: year }).canRun, year).toBe(false);
      }
    });

    it("accepts either calcination method after the window, not neither and not both", () => {
      const year = "FY2027-28";
      const output = [...noProcess(), processFact("fact-calc", 1000)];
      const input = [...noProcess(), rawMeal(1100)];
      expect(assessRunReadiness(pack, output, { draftMode: true, complianceYear: year }).canRun).toBe(true);
      expect(assessRunReadiness(pack, input, { draftMode: true, complianceYear: year }).canRun).toBe(true);
      expect(
        mapFactsToCalcInput(pack, { engagementId: "e", complianceYear: year, draftMode: true, facts: input }).streams.map((s) => s.streamId)
      ).toContain("raw-meal-calcination");

      const both = [...noProcess(), processFact("fact-calc", 1000), rawMeal(1100)];
      expect(assessRunReadiness(pack, both, { draftMode: true, complianceYear: year }).blockers.join(" ")).toMatch(/counting both would count it twice/);
      expect(() => mapFactsToCalcInput(pack, { engagementId: "e", complianceYear: year, draftMode: true, facts: both })).toThrow(/count it twice/);
      // The same plant in the window: still not allowed to double count.
      expect(assessRunReadiness(pack, both, { draftMode: true, complianceYear: "FY2026-27" }).canRun).toBe(false);
    });

    it("counts a supplied figure inside the window, changes no number, and warns about the basis", () => {
      const accepted = cementFactsWithProcess(1000, "fact-calcination");
      const inWindow = executeRun({ ...cementRun, complianceYear: "FY2025-26", facts: accepted });
      const input = mapFactsToCalcInput(pack, { engagementId: "e", complianceYear: "FY2025-26", draftMode: true, facts: accepted });
      expect(input.streams.find((s) => s.streamId === "clinker-calcination")).toBeDefined();
      expect(inWindow.result.warnings.join(" ")).toMatch(/counted, but it is outside the intensity basis for FY2025-26/);
      expect(inWindow.result.warnings.join(" ")).toContain("Section 3.4(1) Note, p. 7");

      const ready = assessRunReadiness(pack, accepted, { draftMode: true, complianceYear: "FY2025-26" });
      expect(ready.canRun).toBe(true);
      expect(ready.warnings.join(" ")).toMatch(/not on the same basis as a target set without it/);

      // Same facts in a year the Note does not cover: identical numbers, no basis warning.
      const after = executeRun({ ...cementRun, complianceYear: "FY2027-28", facts: accepted });
      expect(after.result.gei).toBe(inWindow.result.gei);
      expect(after.result.totalEmissions).toEqual(inWindow.result.totalEmissions);
      expect(after.result.warnings.join(" ")).not.toMatch(/intensity basis/);
    });
  });

  it("chains consecutive runs", () => {
    const runnable = cementFactsWithProcess();
    const first = executeRun({
      ...cementRun,
      facts: runnable,
    });
    const second = executeRun({
      ...cementRun,
      facts: runnable,
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
    // Fuels with no facts stay optional. Calcination is the exception, so this
    // set includes one process emission and one calorific value.
    const only = [
      ...oneFactPerPath(["quantity", "calorificValue", "production"]),
      processFact("fact-calcination", 1000),
    ];
    const ready = assessRunReadiness(pack, only, { draftMode: true });
    expect(ready.canRun).toBe(true);
    expect(ready.warnings.join(" ")).toMatch(/counted as zero/i);
    expect(ready.warnings.join(" ")).not.toMatch(/Clinker calcination process CO2/i);
    expect(ready.streams.find((s) => s.streamId === "petcoke-kiln")?.bound).toBe(false);
    expect(ready.streams.find((s) => s.streamId === "clinker-calcination")?.bound).toBe(true);
  });

  it("accepts one process.calcinationEmissions fact and refuses a second", () => {
    const pack = loadPack("CCTS-CEMENT-v1");
    const accepted = cementFactsWithProcess(1000, "fact-calcination");
    const input = mapFactsToCalcInput(pack, {
      engagementId: "e",
      complianceYear: "FY2025-26",
      draftMode: true,
      facts: accepted,
    });
    expect(input.streams.find((s) => s.streamId === "clinker-calcination")).toMatchObject({
      kind: "process_direct",
      emissions: { value: 1000, unit: "tCO2e" },
    });
    expect(assessRunReadiness(pack, accepted, { draftMode: true }).canRun).toBe(true);

    const run = executeRun({ ...cementRun, facts: accepted });
    expect(run.engineVersion).toBeTruthy();
    expect(run.packId).toBe("CCTS-CEMENT-v1");
    expect(run.draftMode).toBe(true);
    expect(run.inputHash).toBe(hashInputs(run.input));
    expect(run.inputHash).toHaveLength(64);
    expect(run.result.gei).toBeGreaterThan(0);
    expect(run.chainHash).toBe(chainHash(run.inputHash, null));

    const doubled = [...accepted, processFact("fact-calcination-2", 2500)];
    const blocked = assessRunReadiness(pack, doubled, { draftMode: true });
    expect(blocked.canRun).toBe(false);
    expect(blocked.blockers.join(" ")).toContain(
      'Calculation tag "process.calcinationEmissions" has more than one accepted value (1000, 2500). The run will not choose one.'
    );
    expect(() =>
      mapFactsToCalcInput(pack, {
        engagementId: "e",
        complianceYear: "FY2025-26",
        draftMode: true,
        facts: doubled,
      })
    ).toThrow(CalcError);
    expect(() =>
      executeRun({ ...cementRun, facts: doubled })
    ).toThrow(/will not choose/);
  });

  it("does not choose when production or a stream quantity has two accepted values", () => {
    const pack = loadPack("CCTS-CEMENT-v1");
    const base = cementFactsWithProcess();
    const quantity = base.find((f) => f.field_path === "quantity");
    const production = base.find((f) => f.field_path === "production");
    expect(quantity).toBeDefined();
    expect(production).toBeDefined();

    const twoQuantities = [
      ...base,
      { ...quantity!, id: "fact-qty-2", value_json: 10, source_text: "10 t" },
    ];
    expect(assessRunReadiness(pack, twoQuantities, { draftMode: true }).blockers.join(" ")).toContain(
      'Calculation tag "quantity" has more than one accepted value (18247, 10). The run will not choose one.'
    );
    expect(() =>
      mapFactsToCalcInput(pack, {
        engagementId: "e",
        complianceYear: "FY2025-26",
        draftMode: true,
        facts: twoQuantities,
      })
    ).toThrow(CalcError);

    const twoProductions = [
      ...base,
      { ...production!, id: "fact-prod-2", value_json: 5, source_text: "5 t" },
    ];
    const ready = assessRunReadiness(pack, twoProductions, { draftMode: true });
    expect(ready.canRun).toBe(false);
    expect(ready.blockers.join(" ")).toContain(
      'Calculation tag "production" has more than one accepted value (1850000, 5). The run will not choose one.'
    );
    expect(() =>
      mapFactsToCalcInput(pack, {
        engagementId: "e",
        complianceYear: "FY2025-26",
        draftMode: true,
        facts: twoProductions,
      })
    ).toThrow(/will not choose/);
  });
});

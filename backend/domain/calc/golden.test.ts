import { describe, expect, it } from "vitest";
import { SEED_FACTS } from "@verifystack/backend/demo/seed";
import { qty } from "../units";
import { loadPack } from "../packs";
import { mapFactsToCalcInput, executeRun, type ProvenancedFact } from "./run";
import { hashInputs, type CalcInput } from "./engine";

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

/**
 * The Cement mapping used to be hardcoded field paths, stream ids, and factor ids
 * inside calc/run.ts. It is now declared in the pack record and walked
 * generically. These assertions exist so that refactor can be proven to have
 * changed no number: the literal below is the pre-refactor CalcInput, written out
 * by hand, and the hash is pinned.
 *
 * If a future change to the binding walk alters this hash, that change has moved
 * a reported emissions figure and needs a methodology decision, not a merge.
 */
const CEMENT_GOLDEN_INPUT: CalcInput = {
  engagementId: "eng-rjk-cem-fy2526",
  complianceYear: "FY2025-26",
  sector: "from-pack",
  allowUnverifiedFactors: true,
  geiTarget: 0.82,
  streams: [
    {
      kind: "fuel_combustion",
      streamId: "coal-kiln",
      label: "Kiln coal",
      emissionFactorId: "ef_coal_subbituminous",
      emissionFactorVintage: "IPCC2006",
      quantity: qty(18_247, "t"),
      calorificValue: qty(4_200, "kcal/kg"),
      calorificBasis: "GCV",
      phase: "solid",
      provenance: {
        factIds: ["fact-coal-qty", "fact-coal-gcv"],
        label: "18,247 MT",
      },
    },
    {
      kind: "electricity_import",
      streamId: "grid-ht",
      label: "Imported HT electricity",
      quantity: qty(22_166.64, "MWh"),
      gridFactorId: "cea_grid_ef",
      gridFactorVintage: "FY2024-25",
      provenance: {
        factIds: ["fact-elec-kwh"],
        label: "Active energy 22,166,640 Units",
      },
    },
  ],
  production: {
    quantity: qty(1_850_000, "t"),
    productUnitLabel: "tonne_equivalent_product",
    provenance: { factIds: ["fact-prod"], label: "Equivalent product 1,850,000 t" },
  },
};

/** Pinned pre-refactor values. Do not update these to make a test pass. */
const CEMENT_GOLDEN_INPUT_HASH =
  "90b1ee904ae7c450288ec149abff8d56d7be1d368990f2635af571fe06699017";

describe("Cement is byte-identical after the stream-binding refactor", () => {
  const mapped = mapFactsToCalcInput(loadPack("CCTS-CEMENT-v1"), {
    engagementId: "eng-rjk-cem-fy2526",
    complianceYear: "FY2025-26",
    geiTarget: 0.82,
    draftMode: true,
    facts: facts(),
  });

  it("reproduces the hand-written pre-refactor CalcInput exactly", () => {
    expect(mapped).toEqual(CEMENT_GOLDEN_INPUT);
  });

  it("produces the same input hash as the hand-written input", () => {
    expect(hashInputs(mapped)).toBe(hashInputs(CEMENT_GOLDEN_INPUT));
  });

  it("matches the pinned golden hash and reported GEI", () => {
    expect(hashInputs(mapped)).toBe(CEMENT_GOLDEN_INPUT_HASH);
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
    expect(run.inputHash).toBe(CEMENT_GOLDEN_INPUT_HASH);
    expect(run.result.gei).toBe(0.024413);
    // Scope split pinned so a change to the GCV-to-NCV step or the grid factor
    // conversion cannot hide inside an unchanged total.
    expect(run.result.scope1.value).toBe(29_293_412.748);
    expect(run.result.scope2.value).toBe(15_871_314.24);
    expect(run.result.totalEmissions.value).toBeCloseTo(
      run.result.scope1.value + run.result.scope2.value,
      2
    );
  });

  it("still records the IPCC gross-to-net conversion in the derivation", () => {
    const run = executeRun({
      engagementId: "eng-rjk-cem-fy2526",
      organizationId: "org-demo",
      packId: "CCTS-CEMENT-v1",
      packVersion: "1.0.0",
      complianceYear: "FY2025-26",
      draftMode: true,
      facts: facts(),
    });
    const coal = run.result.streams.find((s) => s.streamId === "coal-kiln");
    expect(coal?.derivation).toContain("GCV converted to NCV");
    expect(coal?.factorsUsed[0]?.id).toBe("ef_coal_subbituminous");
  });
});

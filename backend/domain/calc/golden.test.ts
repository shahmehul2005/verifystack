import { describe, expect, it } from "vitest";
import { SEED_FACTS } from "@verifystack/backend/fixtures/seed";
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

/** Seed rows the pre-refactor pin actually bound, plus one process emission. */
function goldenFacts(): ProvenancedFact[] {
  const seen = new Set<string>();
  const out: ProvenancedFact[] = [];
  for (const fact of facts()) {
    if (!["quantity", "calorificValue", "activeEnergy", "production"].includes(fact.field_path)) {
      continue;
    }
    if (seen.has(fact.field_path)) continue;
    seen.add(fact.field_path);
    out.push(fact);
  }
  out.push({
    id: "fact-calcination",
    field_path: "process.calcinationEmissions",
    value_json: 1_000,
    unit: "tCO2e",
    document_id: "doc-process",
    page: 1,
    bbox: { x: 0.2, y: 0.3, width: 0.36, height: 0.04 },
    source_text: "1,000 tCO2e calcination",
  });
  return out;
}

/**
 * The Cement mapping used to be hardcoded field paths, stream ids, and factor ids
 * inside calc/run.ts. It is now declared in the pack record and walked
 * generically. Coal and imported electricity below are the pre-refactor CalcInput.
 *
 * Clinker calcination is required, so this file supplies its own single
 * process.calcinationEmissions fact (1,000 tCO2e). That number is not an
 * emission factor and is not in the shared seed. The seed's second calorific
 * value is omitted: a run will not choose between two accepted values.
 *
 * Do not change the coal or grid figures to make a hash match. If the binding
 * walk moves those figures, that needs a methodology decision, not a merge.
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
    {
      kind: "process_direct",
      streamId: "clinker-calcination",
      label: "Clinker calcination process CO2 (output-based method)",
      emissions: qty(1_000, "tCO2e"),
      methodologyRef:
        "BEE CCTS Detailed Procedure Annexure II.G.1 Equations IX–XIII: Output-based calcination from clinker CaO and MgO fractions, adjusted for CKD (Eq. X), bypass dust (Eq. XI), and raw meal organic carbon (Eq. XII). Applicable to Cement Integrated sub-sector.",
      provenance: {
        factIds: ["fact-calcination"],
        label: "1,000 tCO2e calcination",
      },
    },
  ],
  production: {
    quantity: qty(1_850_000, "t"),
    productUnitLabel: "tonne_equivalent_product",
    provenance: { factIds: ["fact-prod"], label: "Equivalent product 1,850,000 t" },
  },
};

/**
 * Hash of the hand-written input above. Coal and grid are the pre-refactor
 * figures; the process stream is this file's own 1,000 tCO2e fact. Do not
 * change the coal or grid numbers to make this match.
 */
const CEMENT_GOLDEN_INPUT_HASH =
  "e2fc25a8ddf6a51cfaee7cefbd2f34a34df1a6f8fd341acef624a70969297f95";

describe("Cement is byte-identical after the stream-binding refactor", () => {
  const mapped = mapFactsToCalcInput(loadPack("CCTS-CEMENT-v1"), {
    engagementId: "eng-rjk-cem-fy2526",
    complianceYear: "FY2025-26",
    geiTarget: 0.82,
    draftMode: true,
    facts: goldenFacts(),
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
      facts: goldenFacts(),
    });
    expect(run.inputHash).toBe(CEMENT_GOLDEN_INPUT_HASH);
    expect(run.result.gei).toBe(0.024954);
    // Scope split pinned so a change to the GCV-to-NCV step or the grid factor
    // conversion cannot hide inside an unchanged total.
    expect(run.result.scope1.value).toBe(30_293_412.748);
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
      facts: goldenFacts(),
    });
    const coal = run.result.streams.find((s) => s.streamId === "coal-kiln");
    expect(coal?.derivation).toContain("GCV converted to NCV");
    expect(coal?.factorsUsed[0]?.id).toBe("ef_coal_subbituminous");
  });
});

import { describe, expect, it } from "vitest";
import { ADEETIE_PACKS, ADEETIE_FOUNDRY_V1 } from "@verifystack/backend/domain/packs/adeetie";
import { CCTS_CEMENT_V1 } from "@verifystack/backend/domain/packs/cement";
import { adeetieSyntheticFacts, canSeedAdeetiePack } from "./adeetieFacts";
import { mapFactsToSecInput } from "@verifystack/backend/domain/calc/secRun";
import { calculateSec, assessSavings } from "@verifystack/backend/domain/calc/sec";
import { buildFactorSet } from "@verifystack/backend/domain/factors";
import type { ProvenancedFact } from "@verifystack/backend/domain/calc/run";
import type { SecPhase } from "@verifystack/backend/domain/calc/sec";
import type { MethodologyPack } from "@verifystack/backend/domain/packs/types";

/** The seed route writes facts with provenance; mirror that here. */
function provenanced(pack: MethodologyPack, phase: SecPhase): ProvenancedFact[] {
  return adeetieSyntheticFacts(pack, phase).map((f, i) => ({
    id: `${phase}-${i}`,
    field_path: f.field_path,
    value_json: f.value_json,
    unit: f.unit,
    document_id: `doc-${phase}`,
    page: 1,
    bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
    source_text: f.source_text,
  }));
}

function sec(pack: MethodologyPack, phase: SecPhase) {
  const input = mapFactsToSecInput(pack, {
    engagementId: "eng-synthetic",
    periodLabel: phase === "baseline" ? "FY2024-25" : "FY2026-27",
    phase,
    // The seeded engagement is in draft mode, which is what lets the registry
    // calorific default stand in for the one fuel with no lab certificate.
    draftMode: true,
    facts: provenanced(pack, phase),
  });
  return calculateSec(input, buildFactorSet("test-0.1.0"));
}

describe("canSeedAdeetiePack", () => {
  it("covers every ADEETIE sector pack", () => {
    const unseedable = ADEETIE_PACKS.filter((p) => !canSeedAdeetiePack(p)).map(
      (p) => p.pack_id
    );
    expect(unseedable).toEqual([]);
  });

  it("refuses a GEI pack", () => {
    expect(canSeedAdeetiePack(CCTS_CEMENT_V1)).toBe(false);
  });
});

describe("synthetic ADEETIE facts", () => {
  it("satisfies every required stream and the production denominator", () => {
    for (const pack of ADEETIE_PACKS) {
      const paths = new Set(adeetieSyntheticFacts(pack, "baseline").map((f) => f.field_path));
      for (const binding of pack.energy_bindings ?? []) {
        if (binding.required && !binding.onSiteGeneration) {
          expect(paths.has(binding.quantity.path), `${pack.pack_id} ${binding.streamId}`).toBe(
            true
          );
        }
      }
      expect(paths.has(pack.production_binding!.path), pack.pack_id).toBe(true);
    }
  });

  it("keeps a demand figure out of the energy total", () => {
    const result = sec(ADEETIE_FOUNDRY_V1, "baseline");
    const streamIds = result.streams.map((s) => s.streamId);
    expect(streamIds).not.toContain("contractedDemand");
    expect(streamIds).not.toContain("maximumDemand");
  });

  it("produces a Foundry SEC in a plausible GJ/t range", () => {
    const result = sec(ADEETIE_FOUNDRY_V1, "baseline");
    expect(result.secUnitLabel).toBe("GJ/t");
    // Cupola foundries run roughly 4-12 GJ per tonne of good castings.
    expect(result.sec).toBeGreaterThan(4);
    expect(result.sec).toBeLessThan(12);
  });

  it("clears the 10% savings gate for every sector", () => {
    for (const pack of ADEETIE_PACKS) {
      const baseline = sec(pack, "baseline");
      const post = sec(pack, "post_implementation");
      const savings = assessSavings(baseline, post, pack.sec_config?.minSavingsPct);
      expect(savings.meetsThreshold, `${pack.pack_id} at ${savings.savingsPct}%`).toBe(true);
    }
  });

  it("leaves the savings assessment free of comparability warnings", () => {
    const savings = assessSavings(
      sec(ADEETIE_FOUNDRY_V1, "baseline"),
      sec(ADEETIE_FOUNDRY_V1, "post_implementation")
    );
    expect(savings.comparabilityWarnings).toEqual([]);
  });
});

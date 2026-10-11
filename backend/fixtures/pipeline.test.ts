import { describe, expect, it } from "vitest";
import { runDemoPipeline } from "./pipeline";
import { CEMENT_DEMO_RUN_FACTS } from "./seed";
import { polishIsGrounded } from "@verifystack/backend/domain/ai/draftCar";
import { mapFactsToCalcInput, type ProvenancedFact } from "@verifystack/backend/domain/calc/run";
import { loadPack } from "@verifystack/backend/domain/packs";

describe("demo pipeline", () => {
  it("produces a GEI with provenance on every stream", () => {
    const d = runDemoPipeline();
    expect(d.calc.gei).toBeGreaterThan(0);
    expect(d.calc.streams.every((s) => s.provenance.factIds.length > 0)).toBe(true);
    expect(d.rules.blocks + d.rules.warns).toBeGreaterThan(0);
    expect(d.cars.length).toBe(d.rules.findings.length);
  });

  it("flags the planted GCV, NABL lapse, stock gap, missing months, and vintage issues", () => {
    const d = runDemoPipeline();
    const ids = new Set(d.rules.findings.map((f) => f.ruleId));
    // Invoice GCV is planted on the kiln stream (engine warning). CV001 itself
    // observes lab certificates that report GCV; the demo lab cert is NCV.
    expect(d.calc.warnings.some((w) => /GCV/i.test(w))).toBe(true);
    expect(ids.has("LB001")).toBe(true);
    expect(ids.has("MB001")).toBe(true);
    expect(ids.has("TS001")).toBe(true);
    expect(ids.has("EF001")).toBe(true);
  });
});

describe("CAR grounding check", () => {
  it("rejects empty polish", () => {
    const d = runDemoPipeline();
    const f = d.rules.findings[0]!;
    expect(polishIsGrounded(f, "")).toBe(false);
  });
});

describe("Aravalli synthetic facts", () => {
  it("bind onto CCTS-CEMENT-v1 without a Gemini extract", () => {
    const pack = loadPack("CCTS-CEMENT-v1");
    const facts: ProvenancedFact[] = CEMENT_DEMO_RUN_FACTS.map((f, i) => ({
      id: `demo-${i}`,
      field_path: f.field_path,
      value_json: f.value_json,
      unit: f.unit,
      document_id: "doc-demo",
      page: 1,
      bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
      source_text: f.source_text,
    }));
    const input = mapFactsToCalcInput(pack, {
      engagementId: "eng-demo",
      complianceYear: "FY2025-26",
      geiTarget: 0.82,
      draftMode: true,
      facts,
    });
    expect(input.streams).toHaveLength(2);
    expect(input.streams.map((s) => s.streamId)).toEqual(["coal-kiln", "grid-ht"]);
    expect(input.production.quantity.value).toBe(1_850_000);
  });
});

import { describe, expect, it } from "vitest";
import { runDemoPipeline } from "./pipeline";
import { polishIsGrounded } from "@/domain/ai/draftCar";

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
    expect(ids.has("CV001")).toBe(true);
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

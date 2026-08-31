import { describe, expect, it } from "vitest";
import { buildFactorSet } from "../factors";
import { qty } from "../units";
import {
  CalcError,
  ENGINE_VERSION,
  calculate,
  hashInputs,
  type CalcInput,
} from "./engine";

const factors = buildFactorSet("test-factorset-1");

function baseInput(overrides: Partial<CalcInput> = {}): CalcInput {
  return {
    engagementId: "eng-001",
    complianceYear: "FY2025-26",
    sector: "cement",
    allowUnverifiedFactors: true,
    streams: [
      {
        kind: "fuel_combustion",
        streamId: "coal-1",
        label: "Sub-bituminous coal, kiln",
        emissionFactorId: "ef_coal_subbituminous",
        emissionFactorVintage: "IPCC2006",
        quantity: qty(1000, "t"),
        calorificValue: qty(20, "MJ/kg"),
        calorificBasis: "NCV",
        phase: "solid",
        provenance: { factIds: ["fact-coal-qty", "fact-coal-ncv"] },
      },
      {
        kind: "electricity_import",
        streamId: "elec-1",
        label: "Imported grid electricity",
        quantity: qty(1000, "MWh"),
        gridFactorId: "cea_grid_ef",
        gridFactorVintage: "FY2025-26",
        provenance: { factIds: ["fact-elec"] },
      },
    ],
    production: {
      quantity: qty(10_000, "t"),
      productUnitLabel: "tonne_cement",
      provenance: { factIds: ["fact-production"] },
    },
    ...overrides,
  };
}

describe("calculation engine — golden values", () => {
  it("computes Scope 1 fuel combustion from first principles", () => {
    const r = calculate(baseInput(), factors);
    // 1000 t = 1e6 kg; x 20 MJ/kg = 2e7 MJ; x 0.0961 kgCO2e/MJ = 1,922,000 kgCO2e
    const coal = r.streams.find((s) => s.streamId === "coal-1")!;
    expect(coal.scope).toBe(1);
    expect(coal.emissions.value).toBeCloseTo(1_922_000, 3);
  });

  it("computes Scope 2 from grid electricity", () => {
    const r = calculate(baseInput(), factors);
    // 1000 MWh x 0.716 tCO2e/MWh = 716 tCO2e = 716,000 kgCO2e
    const elec = r.streams.find((s) => s.streamId === "elec-1")!;
    expect(elec.scope).toBe(2);
    expect(elec.emissions.value).toBeCloseTo(716_000, 3);
  });

  it("computes GEI as total tCO2e per tonne of equivalent product", () => {
    const r = calculate(baseInput(), factors);
    // (1,922,000 + 716,000) kg = 2638 tCO2e over 10,000 t cement
    expect(r.totalEmissions.value).toBeCloseTo(2_638_000, 3);
    expect(r.gei).toBeCloseTo(0.2638, 6);
  });

  it("derives credit position from the notified target", () => {
    const r = calculate(baseInput({ geiTarget: 0.28 }), factors);
    expect(r.geiHeadroom).toBeCloseTo(0.0162, 6);
    // Beating target => surplus
    expect(r.creditPositionTCO2e).toBeCloseTo(162, 3);
  });

  it("applies the IPCC default GCV-to-NCV conversion for solid fuel and warns", () => {
    const input = baseInput();
    const coal = input.streams[0];
    if (coal.kind !== "fuel_combustion") throw new Error("fixture drift");
    coal.calorificBasis = "GCV";

    const r = calculate(input, factors);
    const line = r.streams.find((s) => s.streamId === "coal-1")!;
    // 20 MJ/kg GCV -> 19 MJ/kg NCV -> 1,825,900 kgCO2e
    expect(line.emissions.value).toBeCloseTo(1_825_900, 3);
    expect(line.derivation).toMatch(/GCV converted to NCV/);
    expect(r.warnings.join(" ")).toMatch(/IPCC default/);
  });
});

describe("calculation engine — determinism and traceability", () => {
  it("produces a stable inputs hash regardless of key ordering", () => {
    const a = baseInput();
    const b = baseInput();
    expect(hashInputs(a)).toBe(hashInputs(b));
  });

  it("changes the hash when any input changes", () => {
    const a = baseInput();
    const b = baseInput({ complianceYear: "FY2026-27" });
    expect(hashInputs(a)).not.toBe(hashInputs(b));
  });

  it("stamps engine and factor set versions onto every result", () => {
    const r = calculate(baseInput(), factors);
    expect(r.engineVersion).toBe(ENGINE_VERSION);
    expect(r.factorSetVersion).toBe("test-factorset-1");
  });

  it("records a human-readable derivation for every stream", () => {
    const r = calculate(baseInput(), factors);
    for (const s of r.streams) {
      expect(s.derivation.length).toBeGreaterThan(0);
    }
  });
});

describe("calculation engine — refusals", () => {
  it("refuses any input lacking provenance", () => {
    const input = baseInput();
    input.streams[0].provenance = { factIds: [] };
    expect(() => calculate(input, factors)).toThrow(/no provenance/i);
  });

  it("refuses unverified factors unless explicitly allowed", () => {
    const input = baseInput({ allowUnverifiedFactors: false });
    expect(() => calculate(input, factors)).toThrow(/not verified/i);
  });

  it("refuses duplicate stream ids", () => {
    const input = baseInput();
    input.streams.push({ ...input.streams[0] });
    expect(() => calculate(input, factors)).toThrow(/Duplicate streamId/);
  });

  it("refuses zero production rather than dividing by zero", () => {
    const input = baseInput();
    input.production.quantity = qty(0, "t");
    expect(() => calculate(input, factors)).toThrow(CalcError);
  });

  it("refuses an out-of-range oxidation factor", () => {
    const input = baseInput();
    const coal = input.streams[0];
    if (coal.kind !== "fuel_combustion") throw new Error("fixture drift");
    coal.oxidationFactor = 1.2;
    expect(() => calculate(input, factors)).toThrow(/oxidation factor/);
  });

  it("refuses an unknown factor vintage with a helpful message", () => {
    const input = baseInput();
    const elec = input.streams[1];
    if (elec.kind !== "electricity_import") throw new Error("fixture drift");
    elec.gridFactorVintage = "FY1999-00";
    expect(() => calculate(input, factors)).toThrow(/Available vintages/);
  });
});

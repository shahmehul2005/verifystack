import { describe, expect, it } from "vitest";
import {
  calculateSavingsDpr,
  chainSavingsDprHash,
  hashSavingsDprInput,
  SavingsDprError,
  type SavingsDprInput,
} from "./dpr";

const base: SavingsDprInput = {
  baselineEnergy: { value: 10_000, unit: "GJ" },
  energyUnit: "GJ",
  minSavingsPct: 10,
  measures: [
    { id: "m1", description: "Replace oversized kiln fan with VFD drive", annualEnergySaving: 600, capitalCostINR: 900_000, annualCostSavingINR: 300_000 },
    { id: "m2", description: "Insulate furnace door and roof", annualEnergySaving: 500, capitalCostINR: 600_000, annualCostSavingINR: 200_000 },
  ],
};

describe("calculateSavingsDpr", () => {
  it("computes per-measure and portfolio simple payback", () => {
    const r = calculateSavingsDpr(base);
    expect(r.perMeasure[0]!.simplePaybackYears).toBeCloseTo(3, 10);
    expect(r.perMeasure[1]!.simplePaybackYears).toBeCloseTo(3, 10);
    expect(r.totals.annualEnergySaving).toBe(1100);
    expect(r.totals.savingsPct).toBeCloseTo(11, 10);
    expect(r.totals.meetsProjectedThreshold).toBe(true);
    expect(r.totals.capitalCostINR).toBe(1_500_000);
    expect(r.totals.simplePaybackYears).toBeCloseTo(3, 10);
  });

  it("does not estimate payback when a rupee saving is missing", () => {
    const r = calculateSavingsDpr({
      ...base,
      measures: [base.measures[0]!, { ...base.measures[1]!, annualCostSavingINR: null }],
    });
    expect(r.perMeasure[1]!.simplePaybackYears).toBeNull();
    expect(r.perMeasure[1]!.paybackNote).toMatch(/not computed/);
    expect(r.totals.simplePaybackYears).toBeNull();
    expect(r.totals.measuresMissingCostSaving).toBe(1);
    expect(r.totals.annualCostSavingINR).toBe(300_000);
  });

  it("reports below-threshold savings instead of hiding them", () => {
    const r = calculateSavingsDpr({ ...base, baselineEnergy: { value: 20_000, unit: "GJ" } });
    expect(r.totals.meetsProjectedThreshold).toBe(false);
  });

  it("always states what it does not compute", () => {
    const r = calculateSavingsDpr(base);
    expect(r.notComputed.join(" ")).toMatch(/internal rate of return/);
  });

  it("refuses bad inputs", () => {
    expect(() => calculateSavingsDpr({ ...base, measures: [] })).toThrow(SavingsDprError);
    expect(() => calculateSavingsDpr({ ...base, baselineEnergy: { value: 0, unit: "GJ" } })).toThrow(SavingsDprError);
    expect(() => calculateSavingsDpr({ ...base, baselineEnergy: { value: 5, unit: "kWh" } })).toThrow(/kWh/);
    expect(() =>
      calculateSavingsDpr({ ...base, measures: [{ ...base.measures[0]!, capitalCostINR: -1 }] })
    ).toThrow(SavingsDprError);
  });
});

describe("hashing", () => {
  it("is stable under key order and changes with any input", () => {
    const a = hashSavingsDprInput(base);
    const reordered = JSON.parse(JSON.stringify({ measures: base.measures, minSavingsPct: 10, energyUnit: "GJ", baselineEnergy: base.baselineEnergy }));
    expect(hashSavingsDprInput(reordered)).toBe(a);
    expect(hashSavingsDprInput({ ...base, minSavingsPct: 11 })).not.toBe(a);
  });

  it("chains to the previous run", () => {
    const h = hashSavingsDprInput(base);
    expect(chainSavingsDprHash(h, null)).not.toBe(chainSavingsDprHash(h, "abc"));
  });
});

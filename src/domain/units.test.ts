import { describe, expect, it } from "vitest";
import { convert, dimensionOf, parseUnit, qty, UnitError } from "./units";

describe("unit conversion", () => {
  it("converts kcal/kg to MJ/kg using the thermochemical kcal", () => {
    // 4200 kcal/kg is a typical Indian G-grade coal figure.
    const r = convert(qty(4200, "kcal/kg"), "MJ/kg");
    expect(r.value).toBeCloseTo(17.58456, 5);
  });

  it("treats GJ/t and MJ/kg as numerically identical", () => {
    expect(convert(qty(19.6, "GJ/t"), "MJ/kg").value).toBeCloseTo(19.6, 10);
  });

  it("converts tonnes to kilograms exactly", () => {
    expect(convert(qty(18_247, "t"), "kg").value).toBe(18_247_000);
  });

  it("converts MWh to MJ", () => {
    expect(convert(qty(1, "MWh"), "MJ").value).toBeCloseTo(3600, 10);
  });

  it("converts tCO2e/TJ to kgCO2e/MJ", () => {
    expect(convert(qty(96.1, "tCO2e/TJ"), "kgCO2e/MJ").value).toBeCloseTo(0.0961, 10);
  });

  it("refuses cross-dimension conversion instead of coercing", () => {
    expect(() => convert(qty(100, "kg"), "MJ")).toThrow(UnitError);
    expect(() => convert(qty(4200, "kcal/kg"), "kcal")).toThrow(/dimension mismatch/);
  });

  it("round-trips without drift", () => {
    const original = qty(4200, "kcal/kg");
    const back = convert(convert(original, "MJ/kg"), "kcal/kg");
    expect(back.value).toBeCloseTo(original.value, 9);
  });

  it("rejects non-finite values at construction", () => {
    expect(() => qty(Number.NaN, "kg")).toThrow(UnitError);
  });

  it("reports dimensions", () => {
    expect(dimensionOf("kcal/kg")).toBe("specific_energy");
    expect(dimensionOf("MWh")).toBe("energy");
  });
});

describe("parseUnit", () => {
  it("handles common Indian invoice spellings", () => {
    expect(parseUnit("MT")).toBe("t");
    expect(parseUnit("Tonnes")).toBe("t");
    expect(parseUnit("kcal / kg")).toBe("kcal/kg");
    expect(parseUnit("Units")).toBe("kWh");
  });

  it("returns null on anything unrecognised rather than guessing", () => {
    expect(parseUnit("bags")).toBeNull();
    expect(parseUnit("")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { convert, dimensionOf, parseUnit, qty, UnitError } from "./units";

/**
 * Units added for the ADEETIE SEC method. The dimensional separations asserted
 * here are the point: kVA must never become energy, and volume must never
 * become mass.
 */
describe("energy units for SEC", () => {
  it("converts toe to GJ using the IEA definition", () => {
    expect(convert(qty(1, "toe"), "GJ").value).toBeCloseTo(41.868, 6);
    expect(convert(qty(1, "ktoe"), "GJ").value).toBeCloseTo(41_868, 3);
  });

  it("converts electricity to GJ exactly", () => {
    expect(convert(qty(1, "MWh"), "GJ").value).toBeCloseTo(3.6, 12);
    expect(convert(qty(1_000, "kWh"), "GJ").value).toBeCloseTo(3.6, 12);
  });

  it("treats kL and m3 as the same volume", () => {
    expect(convert(qty(1, "kL"), "m3").value).toBeCloseTo(1, 12);
    expect(convert(qty(1, "kL"), "L").value).toBeCloseTo(1000, 9);
  });

  it("treats SCM as a volume at standard conditions", () => {
    expect(dimensionOf("SCM")).toBe("volume");
    expect(convert(qty(2_500, "SCM"), "m3").value).toBeCloseTo(2_500, 9);
  });

  it("converts volumetric calorific values against the m3 canonical", () => {
    // PNG is commonly quoted around 8,500 kcal/SCM.
    expect(convert(qty(8_500, "kcal/SCM"), "MJ/m3").value).toBeCloseTo(35.5878, 4);
    // 1 GJ/kL is 1 MJ/L is 1000 MJ/m3.
    expect(convert(qty(1, "GJ/kL"), "MJ/m3").value).toBeCloseTo(1_000, 9);
    expect(convert(qty(1, "MJ/L"), "GJ/kL").value).toBeCloseTo(1, 12);
  });

  it("keeps apparent power out of every other dimension", () => {
    expect(dimensionOf("kVA")).toBe("apparent_power");
    expect(convert(qty(1, "MVA"), "kVA").value).toBeCloseTo(1_000, 9);

    // Contracted demand is a rate, not a quantity of energy.
    expect(() => convert(qty(2_500, "kVA"), "kWh")).toThrow(UnitError);
    expect(() => convert(qty(2_500, "kVA"), "GJ")).toThrow(/dimension mismatch/);
    expect(() => convert(qty(2_500, "kVA"), "kW")).toThrow(/dimension mismatch/);
    expect(() => convert(qty(2_500, "kW"), "kWh")).toThrow(/dimension mismatch/);
  });

  it("refuses to turn a fuel volume into a fuel mass", () => {
    // Density is fuel-specific, so this conversion must not exist.
    expect(() => convert(qty(10, "kL"), "t")).toThrow(UnitError);
    expect(() => convert(qty(10, "t"), "kL")).toThrow(/dimension mismatch/);
  });

  it("refuses to mix mass-basis and volume-basis calorific values", () => {
    expect(() => convert(qty(10_000, "kcal/kg"), "MJ/m3")).toThrow(/dimension mismatch/);
    expect(() => convert(qty(35, "MJ/m3"), "MJ/kg")).toThrow(/dimension mismatch/);
  });

  it("parses the unit spellings that appear on ADEETIE evidence", () => {
    expect(parseUnit("SCM")).toBe("SCM");
    expect(parseUnit("kL")).toBe("kL");
    expect(parseUnit("Litres")).toBe("L");
    expect(parseUnit("kVA")).toBe("kVA");
    expect(parseUnit("TOE")).toBe("toe");
    expect(parseUnit("kcal/SCM")).toBe("kcal/SCM");
    expect(parseUnit("GJ / kL")).toBe("GJ/kL");
  });

  it("still refuses ambiguous units rather than guessing", () => {
    // Nm3 differs from SCM by reference temperature; kVAh differs from kWh by
    // power factor. Both must reach a human.
    expect(parseUnit("Nm3")).toBeNull();
    expect(parseUnit("kVAh")).toBeNull();
  });
});

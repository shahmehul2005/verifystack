import { describe, expect, it } from "vitest";
import { BASIS_LABEL, convertCalorificValue, isOnBasis, workbookBasis } from "./moistureBasis";

describe("convertCalorificValue", () => {
  it("returns a value that is already on the wanted basis unchanged", () => {
    expect(convertCalorificValue({ value: 4200, basis: "ARB", totalMoisturePct: 8, inherentMoisturePct: 2 }, "ARB")).toEqual({
      ok: true,
      value: 4200,
      from: "ARB",
      to: "ARB",
    });
  });

  it("lowers a dried-basis value when it is put on an as-received basis", () => {
    // Drying removes water and leaves the energy, so the wet figure is the smaller one.
    const out = convertCalorificValue({ value: 5000, basis: "ADB", totalMoisturePct: 10, inherentMoisturePct: 2 }, "ARB");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toBeCloseTo((5000 * 0.9) / 0.98, 6);
    expect(out.value).toBeLessThan(5000);
  });

  it("raises an as-received value when it is put on an air-dried basis", () => {
    // Drying removes water and leaves the energy, so the dried figure is the larger one.
    const out = convertCalorificValue({ value: 4500, basis: "ARB", totalMoisturePct: 10, inherentMoisturePct: 2 }, "ADB");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toBeCloseTo((4500 * 0.98) / 0.9, 6);
    expect(out.value).toBeGreaterThan(4500);
  });

  it("is the inverse of itself", () => {
    const down = convertCalorificValue({ value: 6000, basis: "DB", totalMoisturePct: 12, inherentMoisturePct: 3 }, "ARB");
    expect(down.ok).toBe(true);
    if (!down.ok) return;
    const up = convertCalorificValue({ value: down.value, basis: "ARB", totalMoisturePct: 12, inherentMoisturePct: 3 }, "ADB");
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const back = convertCalorificValue({ value: up.value, basis: "ADB", totalMoisturePct: 12, inherentMoisturePct: 3 }, "ARB");
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value).toBeCloseTo(down.value, 6);
  });

  it("refuses when the basis is not stated", () => {
    const out = convertCalorificValue({ value: 4200, basis: "NA", totalMoisturePct: 8, inherentMoisturePct: 2 }, "ARB");
    expect(out).toEqual({ ok: false, reason: "The document does not state the moisture basis of this calorific value." });
  });

  it("refuses to convert a dried value with no inherent moisture", () => {
    const out = convertCalorificValue({ value: 5000, basis: "ADB", totalMoisturePct: 10, inherentMoisturePct: null }, "ARB");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/Inherent moisture is not stated/);
  });

  it("refuses moisture figures that cannot describe one sample", () => {
    const out = convertCalorificValue({ value: 5000, basis: "ADB", totalMoisturePct: 2, inherentMoisturePct: 4 }, "ARB");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/not above inherent moisture/);
  });

  it("refuses impossible or missing values", () => {
    expect(convertCalorificValue({ value: 0, basis: "ARB", totalMoisturePct: 8, inherentMoisturePct: 2 }, "ADB").ok).toBe(false);
    expect(convertCalorificValue({ value: 4200, basis: "ARB", totalMoisturePct: null, inherentMoisturePct: 2 }, "ADB").ok).toBe(false);
    expect(convertCalorificValue({ value: 4200, basis: "ARB", totalMoisturePct: 120, inherentMoisturePct: 2 }, "ADB").ok).toBe(false);
  });

  it("lets a dry-basis value be compared with the as-received figure the workbook uses", () => {
    // The trap: a dry-basis value entered in an as-received GCV cell, with the moisture
    // deduction then applied to the tonnage as well, counts the water twice. The
    // conversion is what makes the two figures comparable: 5,436.9 on a dry basis is
    // 4,923.6 as-received at 10.8% total and 1.5% inherent moisture, so a workbook that
    // uses 5,436.9 as its as-received GCV is overstated by 10.4% of the energy.
    const wet = convertCalorificValue({ value: 5436.9, basis: "DB", totalMoisturePct: 10.8, inherentMoisturePct: 1.5 }, "ARB");
    expect(wet.ok).toBe(true);
    if (!wet.ok) return;
    expect(wet.value).toBeCloseTo(4923.57, 2);
    expect(wet.value).toBeLessThan(5436.9);
  });
});

describe("workbookBasis", () => {
  it("reads a workout that derives NCV through the GCV-to-NCV cell as as-received", () => {
    expect(workbookBasis(false, true)).toBe("ARB");
  });

  it("reads a workbook that prints moisture as as-received", () => {
    expect(workbookBasis(true, false)).toBe("ARB");
  });

  it("reports an unknown basis rather than assuming one", () => {
    expect(workbookBasis(false, false)).toBe("NA");
  });

  it("labels every basis", () => {
    expect(BASIS_LABEL.NA).toMatch(/no moisture basis/);
    expect(BASIS_LABEL.ARB).toMatch(/as-received/);
  });
});

describe("isOnBasis", () => {
  it("is true only for the basis asked for", () => {
    expect(isOnBasis("ARB", "ARB")).toBe(true);
    expect(isOnBasis("ADB", "ARB")).toBe(false);
    expect(isOnBasis("NA", "ARB")).toBe(false);
  });
});

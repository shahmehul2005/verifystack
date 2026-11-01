import { describe, expect, it } from "vitest";
import {
  PROXIMATE_TOLERANCE_PCT,
  WEIGHBRIDGE_TOLERANCE_T,
  checkProximateAnalysis,
  checkWeighbridgeSlip,
  sharesOneDecimalScale,
} from "./documentConsistency";

describe("checkWeighbridgeSlip", () => {
  it("accepts a slip whose own three weights agree", () => {
    const out = checkWeighbridgeSlip({ grossT: 42.68, tareT: 18.5, netT: 24.18 });
    expect(out.status).toBe("consistent");
    if (out.status !== "consistent") return;
    expect(out.computedNet).toBeCloseTo(24.18, 6);
    expect(out.difference).toBeCloseTo(0, 6);
  });

  it("allows the rounding of two printed weights", () => {
    expect(checkWeighbridgeSlip({ grossT: 42.68, tareT: 18.5, netT: 24.19 }).status).toBe("consistent");
  });

  it("rejects a slip where the printed net does not follow from gross and tare", () => {
    // The classic fabrication: net was typed, gross was not, and the difference is real.
    const out = checkWeighbridgeSlip({ grossT: 42.68, tareT: 18.5, netT: 26.4 });
    expect(out.status).toBe("inconsistent");
    if (out.status !== "inconsistent") return;
    expect(out.difference).toBeCloseTo(2.22, 6);
    expect(out.detail).toMatch(/does not agree with itself/);
  });

  it("rejects a tare heavier than the gross", () => {
    const out = checkWeighbridgeSlip({ grossT: 18.5, tareT: 42.68, netT: 24.18 });
    expect(out.status).toBe("inconsistent");
    if (out.status !== "inconsistent") return;
    expect(out.detail).toMatch(/not lighter than gross/);
  });

  it("does not judge a slip it cannot read", () => {
    expect(checkWeighbridgeSlip({ grossT: Number.NaN, tareT: 18.5, netT: 24.18 }).status).toBe("not_applicable");
    expect(checkWeighbridgeSlip({ grossT: 0, tareT: 18.5, netT: 0 }).status).toBe("not_applicable");
    expect(checkWeighbridgeSlip({ grossT: 42.68, tareT: -1, netT: 43.68 }).status).toBe("not_applicable");
  });

  it("applies the band it is given, not only the default", () => {
    // Net is 0.30 t off gross minus tare: inside a 0.50 t band, outside a 0.05 t band.
    const loose = checkWeighbridgeSlip({ grossT: 42.68, tareT: 18.5, netT: 24.48, toleranceT: 0.5 });
    const strict = checkWeighbridgeSlip({ grossT: 42.68, tareT: 18.5, netT: 24.48 });
    expect(loose.status).toBe("consistent");
    expect(strict.status).toBe("inconsistent");
    // The default band is 0.05 t, so the strict call above used it.
    expect(WEIGHBRIDGE_TOLERANCE_T).toBe(0.05);
  });
});

describe("checkProximateAnalysis", () => {
  it("accepts a row that closes to 100%", () => {
    // The fixture's November series: moisture, ash, hydrogen are printed; fixed carbon here closes the row.
    const out = checkProximateAnalysis({ moisturePct: 4.23, ashPct: 22.19, volatileMatterPct: 28.9, fixedCarbonPct: 44.68 });
    expect(out.status).toBe("consistent");
    if (out.status !== "consistent") return;
    expect(out.total).toBeCloseTo(100, 6);
  });

  it("rejects a row that does not close, and says by how much", () => {
    const out = checkProximateAnalysis({ moisturePct: 4.23, ashPct: 22.19, volatileMatterPct: 28.9, fixedCarbonPct: 40.68 });
    expect(out.status).toBe("inconsistent");
    if (out.status !== "inconsistent") return;
    expect(out.difference).toBeCloseTo(-4, 6);
    expect(out.detail).toMatch(/copied wrongly|not all on one basis/);
  });

  it("does not apply when fixed carbon is not printed", () => {
    const out = checkProximateAnalysis({ moisturePct: 4.23, ashPct: 22.19, volatileMatterPct: 28.9, fixedCarbonPct: null });
    expect(out.status).toBe("not_applicable");
  });

  it("does not judge results that are not percentages", () => {
    expect(checkProximateAnalysis({ moisturePct: 104, ashPct: 22, volatileMatterPct: 28, fixedCarbonPct: 44 }).status).toBe("not_applicable");
  });

  it("applies the band it is given, not only the default", () => {
    expect(PROXIMATE_TOLERANCE_PCT).toBe(0.5);
    // Sums to 100.30%: inside a 0.50 band, outside a 0.01 band.
    const inside = checkProximateAnalysis({ moisturePct: 4.23, ashPct: 22.19, volatileMatterPct: 28.9, fixedCarbonPct: 44.98 });
    const outside = checkProximateAnalysis({ moisturePct: 4.23, ashPct: 22.19, volatileMatterPct: 28.9, fixedCarbonPct: 44.98, tolerancePct: 0.01 });
    expect(inside.status).toBe("consistent");
    expect(outside.status).toBe("inconsistent");
  });
});

describe("sharesOneDecimalScale", () => {
  it("is true for a set all written to the same number of decimals", () => {
    expect(sharesOneDecimalScale([406.4, 389.5, 412.1, 399.9])).toBe(true);
    expect(sharesOneDecimalScale([1250, 1260, 1240])).toBe(true);
  });

  it("is false for a mixed set", () => {
    expect(sharesOneDecimalScale([406.4, 389, 412.15, 399.9])).toBe(false);
    expect(sharesOneDecimalScale([406.4])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  CO2_PER_CAO,
  CO2_PER_MGO,
  checkOxideFloor,
  impliedCalcinationFactor,
  stoichiometricCalcinationFloor,
} from "./calcinationChemistry";

describe("the stoichiometric constants come from the atomic masses", () => {
  it("gives about 0.785 kg CO2 per kg CaO", () => {
    expect(CO2_PER_CAO).toBeCloseTo(0.785, 3);
  });

  it("gives about 1.092 kg CO2 per kg MgO", () => {
    expect(CO2_PER_MGO).toBeCloseTo(1.092, 3);
  });

  it("matches the worked example in the brief to the published rounding", () => {
    // 64.5% CaO and 2.1% MgO. The brief's 0.5293 uses the rounded 0.785 and 1.092;
    // exact atomic masses give 0.52912. The difference is 0.03%.
    expect(stoichiometricCalcinationFloor(0.645, 0.021)).toBeCloseTo(0.5293, 3);
  });
});

describe("checkOxideFloor", () => {
  it("calls a declared factor below the floor impossible", () => {
    // The brief's example: 0.4820 declared against a floor of about 0.529.
    const out = checkOxideFloor({ caoFraction: 0.645, mgoFraction: 0.021, declaredFactor: 0.482 });
    expect(out.status).toBe("impossible");
    if (out.status !== "impossible") return;
    expect(out.floor).toBeCloseTo(0.5291, 3);
    expect(out.shortfall).toBeCloseTo(0.0471, 3);
    expect(out.detail).toMatch(/CaO 64\.50%/);
    expect(out.detail).toMatch(/MgO 2\.10%/);
  });

  it("accepts a factor at or above the floor", () => {
    expect(checkOxideFloor({ caoFraction: 0.645, mgoFraction: 0.021, declaredFactor: 0.5293 }).status).toBe("possible");
    expect(checkOxideFloor({ caoFraction: 0.645, mgoFraction: 0.021, declaredFactor: 0.55 }).status).toBe("possible");
  });

  it("allows the analytical tolerance but no more", () => {
    const floor = stoichiometricCalcinationFloor(0.645, 0.021);
    // Just inside 2% of the floor.
    expect(checkOxideFloor({ caoFraction: 0.645, mgoFraction: 0.021, declaredFactor: floor * 0.985 }).status).toBe("possible");
    // Just outside it.
    expect(checkOxideFloor({ caoFraction: 0.645, mgoFraction: 0.021, declaredFactor: floor * 0.97 }).status).toBe("impossible");
  });

  it("does not pretend to decide when the inputs are missing or not fractions", () => {
    expect(checkOxideFloor({ caoFraction: Number.NaN, mgoFraction: 0.021, declaredFactor: 0.5 }).status).toBe("not_applicable");
    expect(checkOxideFloor({ caoFraction: 64.5, mgoFraction: 2.1, declaredFactor: 0.5 }).status).toBe("not_applicable");
    expect(checkOxideFloor({ caoFraction: 0.645, mgoFraction: 0.021, declaredFactor: -1 }).status).toBe("not_applicable");
  });

  it("reports the factor an oxide analysis implies", () => {
    expect(impliedCalcinationFactor(0.645, 0.021)).toBeCloseTo(0.5291, 4);
  });
});

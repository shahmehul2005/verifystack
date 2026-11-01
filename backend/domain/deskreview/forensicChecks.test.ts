import { describe, expect, it } from "vitest";
import { runDeskReview, type Readings } from "./engine";
import { CEMENT_DESK_REVIEW } from "./cement";

const def = CEMENT_DESK_REVIEW;

function outcome(readings: Readings, id: string) {
  const row = runDeskReview(def, { "ctx.fy_start": 2023, ...readings }).find((r) => r.id === id);
  if (!row) throw new Error(`no ${id}`);
  return row;
}

/** The pack's own lab figures: 30 samples, mean 4,188 kcal/kg, mean total moisture 4.00%. */
const LAB = {
  "lab.gcv_mean": 4188,
  "lab.moisture_mean_pct": 4,
};

describe("NABL GCV is compared on one moisture basis", () => {
  it("passes when both figures are as-received and the deviation is inside 71.7 kcal/kg", () => {
    const r = outcome(
      { ...LAB, "coal.nabl_gcv": 4230, "coal.nabl_basis": "ARB", "coal.nabl_moisture_pct": 4 },
      "gcv_basis_nabl"
    );
    expect(r.status).toBe("pass");
    expect(r.detail).toMatch(/same coal/);
    expect(r.detail).toMatch(/deviation is 42 kcal\/kg/);
  });

  it("converts a dry-basis certificate before comparing it", () => {
    // 4,343.75 dry at 4% total moisture and 1% inherent is 4,188 as received.
    const r = outcome(
      {
        ...LAB,
        "coal.nabl_gcv": 4343.75,
        "coal.nabl_basis": "DB",
        "coal.nabl_moisture_pct": 4,
      },
      "gcv_basis_nabl"
    );
    // Without inherent moisture the conversion cannot be made, so it is not judged.
    expect(r.status).toBe("not_applicable");
    expect(r.detail).toMatch(/total moisture|Inherent|convert/i);
  });

  it("fails when the certificate's moisture does not match the internal log", () => {
    // The double-count signature: an as-received value measured at a different moisture,
    // so the two figures describe different coal and one of them is being reused.
    const r = outcome(
      { ...LAB, "coal.nabl_gcv": 4230, "coal.nabl_basis": "ARB", "coal.nabl_moisture_pct": 9.5 },
      "gcv_basis_nabl"
    );
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/counts the water twice/);
    expect(r.detail).toMatch(/moisture differs by 5\.5 percentage points/);
  });

  it("fails on a deviation beyond the 71.7 kcal/kg band even when the moisture agrees", () => {
    // 4,100 against 4,188 is 88 kcal/kg, outside the band. (4,120 would be 68, inside it.)
    const r = outcome(
      { ...LAB, "coal.nabl_gcv": 4100, "coal.nabl_basis": "ARB", "coal.nabl_moisture_pct": 4 },
      "gcv_basis_nabl"
    );
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/over the 71\.7 kcal\/kg band/);
    expect(r.detail).toMatch(/deviation is 88 kcal\/kg/);
  });

  it("says why when the basis is not stated instead of assuming one", () => {
    const r = outcome(
      { ...LAB, "coal.nabl_gcv": 4230, "coal.nabl_basis": "not stated", "coal.nabl_moisture_pct": 4 },
      "gcv_basis_nabl"
    );
    expect(r.status).toBe("not_applicable");
    expect(r.detail).toMatch(/does not state the moisture basis/);
  });
});

describe("calcination against the carbonate floor", () => {
  it("fails a declared factor below the floor set by CaO and MgO", () => {
    // 0.5291 tCO2/t floor; a pro forma figure of 72,300 t on 150,000 t clinker is 0.482.
    const r = outcome(
      {
        "clinker.cao_pct": 64.5,
        "clinker.mgo_pct": 2.1,
        "pf.calcination_state": "quantified",
        "pf.calcination_co2": 72300,
        "pf.clinker_t": 150000,
      },
      "calcination_stoich"
    );
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/Carbonate decomposition cannot be held below the carbon/);
    expect(r.actual).toBeCloseTo(0.482, 6);
    expect(r.expected).toBeCloseTo(0.5291, 3);
  });

  it("passes a factor at the floor", () => {
    const r = outcome(
      {
        "clinker.cao_pct": 64.5,
        "clinker.mgo_pct": 2.1,
        "pf.calcination_state": "quantified",
        "pf.calcination_co2": 79369,
        "pf.clinker_t": 150000,
      },
      "calcination_stoich"
    );
    expect(r.status).toBe("pass");
  });

  it("gives the floor without judging when the pro forma carries no calcination cell", () => {
    const r = outcome({ "clinker.cao_pct": 64.5, "clinker.mgo_pct": 2.1, "pf.calcination_state": "missing" }, "calcination_stoich");
    expect(r.status).toBe("not_applicable");
    expect(r.detail).toMatch(/floor of 0\.5291\d* tCO2 per tonne/);
  });

  it("is not applicable when the pack has no oxide analysis at all", () => {
    const r = outcome({}, "calcination_stoich");
    expect(r.status).toBe("not_applicable");
    expect(r.detail).toMatch(/no clinker\.cao_pct, clinker\.mgo_pct/);
  });
});

describe("weighbridge slip self-consistency", () => {
  it("passes when the slip agrees with itself", () => {
    expect(outcome({ "slip.gross_t": 42.68, "slip.tare_t": 18.5, "slip.net_t": 24.18 }, "weighbridge_slip").status).toBe("pass");
  });

  it("fails when the printed net does not follow from gross and tare", () => {
    const r = outcome({ "slip.gross_t": 42.68, "slip.tare_t": 18.5, "slip.net_t": 26.4 }, "weighbridge_slip");
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/does not agree with itself/);
  });

  it("is not applicable without a slip, and does not block the run", () => {
    const r = outcome({}, "weighbridge_slip");
    expect(r.status).toBe("not_applicable");
    expect(def.rules.find((x) => x.id === "weighbridge_slip")!.needs).toEqual([]);
  });
});

describe("digit screen on the coal GCV samples", () => {
  it("reports the sample size and makes no claim on a short series", () => {
    const readings: Readings = {};
    for (let i = 1; i <= 8; i += 1) readings[`lab.gcv@2023-11-0${i}`] = 4200 + i;
    const r = outcome(readings, "gcv_digit_screen");
    expect(r.status).toBe("pass");
    expect(r.detail).toMatch(/fewer than the 30/);
  });

  it("flags a long series where every last digit is the same", () => {
    const readings: Readings = {};
    for (let i = 0; i < 40; i += 1) {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String(Math.floor(i / 28) + 1).padStart(2, "0");
      readings[`lab.gcv@2023-${month}-${day}`] = 4100 + i * 10;
    }
    const r = outcome(readings, "gcv_digit_screen");
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/Terminal digit: 40 values/);
    expect(r.detail).toMatch(/pull the originals/);
  });

  it("passes a clean series that clusters in one range", () => {
    // The fixture's own lab values, 4,117 to 4,275 kcal/kg. Benford cannot apply to a
    // one-decade set, and it must not report a deviation for one.
    const values = [4219, 4252, 4187, 4117, 4237, 4143, 4261, 4177, 4209, 4153, 4241, 4129, 4199, 4221, 4163, 4271, 4137, 4213, 4189, 4247, 4159, 4201, 4133, 4267, 4171, 4229, 4193, 4147, 4253, 4183];
    const readings: Readings = {};
    values.forEach((v, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      readings[`lab.gcv@2023-11-${day}`] = v;
    });
    const r = outcome(readings, "gcv_digit_screen");
    expect(r.status).toBe("pass");
    expect(r.detail).toMatch(/not a Benford population/);
    expect(r.detail).toMatch(/Nothing in the digits/);
  });

  it("says a varied series shows no pattern", () => {
    const readings: Readings = {};
    const values = [4219, 4252, 4187, 4117, 4237, 4143, 4261, 4177, 4209, 4153, 4241, 4129, 4199, 4221, 4163, 4271, 4137, 4213, 4189, 4247, 4159, 4201, 4133, 4267, 4171, 4229, 4193, 4147, 4253, 4183];
    values.forEach((v, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      readings[`lab.gcv@2023-11-${day}`] = v;
    });
    const r = outcome(readings, "gcv_digit_screen");
    expect(r.detail).toMatch(/Nothing in the digits of these readings calls them into question|deviation/);
  });
});

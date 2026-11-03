import { describe, expect, it } from "vitest";
import { checkDailyAgreement, checkEvidenceCoverage, checkSumMatches } from "../crosscheck/tieout";
import type { XlsxSheet } from "../intake/xlsx";
import { deskReviewFor, runDeskReview, type Readings } from "./index";

const def = deskReviewFor("CCTS-CEMENT-v1")!;

const cell = (row: number, col: number, value: unknown) => ({ row, col, ref: `${String.fromCharCode(64 + col)}${row}`, value, formula: null });
const sheet = (rows: [string, unknown][]) =>
  ({
    name: "S",
    cells: [cell(1, 1, "Date"), cell(1, 2, "Clinker Production (t)"), ...rows.flatMap(([d, v], i) => [cell(i + 2, 1, d), cell(i + 2, 2, v)])],
  }) as unknown as XlsxSheet;
const readSheet = (s: XlsxSheet, notes: string[] = []) =>
  def.readers.find((r) => r.slot === "production_evidence")!.read(s, (m) => notes.push(m));

const outcome = (readings: Readings, id: string) => runDeskReview(def, readings).find((o) => o.id === id)!;

describe("a text cell in a numeric column", () => {
  it("is left out of the total, the daily series and the months, and is reported", () => {
    const notes: string[] = [];
    const got = readSheet(sheet([["2023-11-01", 100], ["2023-11-02", "-"], ["2023-11-03", 120]]), notes);
    expect(got["scada.clinker_sum"]).toBe(220);
    expect("scada.clinker@2023-11-02" in got).toBe(false);
    expect(got["scada.clinker@2023-11-03"]).toBe(120);
    expect(notes.join(" ")).toMatch(/1 cell\(s\) under "Clinker Production \(t\)" hold text/);
    expect(Object.values(got).some((v) => typeof v === "number" && Number.isNaN(v))).toBe(false);
  });

  it("reads a figure typed as text with a thousands comma", () => {
    const got = readSheet(sheet([["2023-11-01", "1,234.5"], ["2023-11-02", 10]]));
    expect(got["scada.clinker_sum"]).toBe(1244.5);
    expect(got["scada.clinker@2023-11-01"]).toBe(1234.5);
  });
});

describe("a figure that is not a number is never a pass", () => {
  it("coverage cannot be decided on a NaN total or annual cell", () => {
    const base = { id: "c", label: "c", monthsEvidenced: 12, periodMonths: 12, relTolerance: 0.01 };
    expect(checkEvidenceCoverage({ ...base, annualCell: 1000, monthlyReading: Number.NaN }).status).toBe("not_applicable");
    expect(checkEvidenceCoverage({ ...base, annualCell: Number.NaN, monthlyReading: 1000 }).status).toBe("not_applicable");
  });

  it("a day that cannot be compared stops a daily agreement passing", () => {
    const rows = [
      { date: "2023-11-01", a: 100, b: Number.NaN },
      { date: "2023-11-02", a: 100, b: 100 },
    ];
    const r = checkDailyAgreement({ id: "d", label: "d", rows, relTolerance: 0.01 });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/1 further day\(s\) had a figure that is not a number/);
  });

  it("a daily agreement with nothing comparable is not applicable, and an empty one does not crash", () => {
    expect(checkDailyAgreement({ id: "d", label: "d", rows: [{ date: "x", a: Number.NaN, b: 1 }], relTolerance: 0.01 }).status).toBe("not_applicable");
    expect(checkDailyAgreement({ id: "d", label: "d", rows: [], relTolerance: 0.01 }).status).toBe("not_applicable");
  });

  it("a sum with a NaN part is not applicable", () => {
    expect(checkSumMatches({ id: "s", label: "s", parts: [Number.NaN], target: 5, relTolerance: 0.01 }).status).toBe("not_applicable");
  });

  it("the engine does not decide a check whose reading is NaN", () => {
    const o = outcome({ "scada.clinker_sum": Number.NaN, "mpr.clinker_t": 100 }, "scada_clinker_vs_mpr");
    expect(o.status).toBe("not_applicable");
    expect(o.detail).toMatch(/scada\.clinker_sum is not a number/);
  });
});

describe("NABL certificate on a dried basis", () => {
  const base: Readings = {
    "pf.gcv_coal": 4200,
    "lab.gcv_mean": 4400,
    "lab.moisture_mean_pct": 12,
    "coal.nabl_gcv": 4900,
    "coal.nabl_basis": "ADB",
    "coal.nabl_moisture_pct": 12,
  };

  it("cannot be compared without the inherent moisture, and says so", () => {
    const o = outcome(base, "gcv_basis_nabl");
    expect(o.status).toBe("not_applicable");
    expect(o.detail).toMatch(/Inherent moisture is not stated/);
  });

  it("is converted to as-received and compared once the inherent moisture is entered", () => {
    // 4900 x (1 - 0.12) / (1 - 0.02) = 4400, the internal mean.
    const agree = outcome({ ...base, "coal.nabl_inherent_moisture_pct": 2 }, "gcv_basis_nabl");
    expect(agree.status).toBe("pass");
    expect(agree.actual).toBeCloseTo(4400, 0);
    const off = outcome({ ...base, "lab.gcv_mean": 4200, "coal.nabl_inherent_moisture_pct": 2 }, "gcv_basis_nabl");
    expect(off.status).toBe("fail");
  });

  it("is offered as a reading to enter", () => {
    expect(def.manual.some((m) => m.key === "coal.nabl_inherent_moisture_pct")).toBe(true);
  });

  it("is not failed by the plain corroboration screen for the water alone", () => {
    expect(outcome(base, "gcv_nabl_corroboration").status).toBe("not_applicable");
  });

  it("still compares directly when the certificate is as-received or states no basis", () => {
    const arb = outcome({ ...base, "coal.nabl_basis": "ARB", "lab.gcv_mean": 4200 }, "gcv_nabl_corroboration");
    expect(arb.status).toBe("fail");
    const { "coal.nabl_basis": _omitted, ...noBasis } = base;
    expect(outcome({ ...noBasis, "lab.gcv_mean": 4200 }, "gcv_nabl_corroboration").status).toBe("fail");
  });
});

import { describe, expect, it } from "vitest";
import {
  checkDailyAgreement,
  checkEvidenceCoverage,
  checkFormulaIntegrity,
  checkGcvRule,
  checkMassBalance,
  checkProductionDays,
  checkRenewableClaim,
  checkSumMatches,
  checkUnmappedFuel,
  clinkerConsumedForCement,
} from "./tieout";

describe("checkSumMatches", () => {
  it("fails an exact match that differs by rounding, and passes the same figures in a relative band", () => {
    const exact = checkSumMatches({ id: "x", label: "OPC", parts: [6058.2], target: 6058.3 });
    expect(exact.status).toBe("fail");
    const banded = checkSumMatches({
      id: "x",
      label: "OPC",
      parts: [6058.2],
      target: 6058.3,
      relTolerance: 0.005,
    });
    expect(banded.status).toBe("pass");
  });

  it("sums decimals without false differences", () => {
    const r = checkSumMatches({ id: "x", label: "t", parts: [0.1, 0.2], target: 0.3 });
    expect(r.status).toBe("pass");
    expect(r.diff).toBe(0);
  });
});

describe("checkDailyAgreement", () => {
  const rows = [
    { date: "2023-11-01", a: 400, b: 406.4 },
    { date: "2023-11-03", a: 391.1, b: 452.5 },
  ];

  it("fails when any sampled day is outside the band, and names the worst day", () => {
    const r = checkDailyAgreement({ id: "dpr", label: "DPR vs SCADA", rows, relTolerance: 0.005 });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/2023-11-03/);
  });

  it("passes when every day is inside the band", () => {
    const r = checkDailyAgreement({
      id: "dpr",
      label: "DPR vs SCADA",
      rows: [{ date: "d", a: 100, b: 100.2 }],
      relTolerance: 0.005,
    });
    expect(r.status).toBe("pass");
  });
});

describe("checkMassBalance", () => {
  const month = { opening: 2500, production: 12500, imports: 1666.7, exports: 833.3, closing: 1666.7 };

  it("is not applicable without a consumption figure, and reports the implied outflow", () => {
    const r = checkMassBalance(month);
    expect(r.status).toBe("not_applicable");
    expect(r.actual).toBe(14166.7);
  });

  it("passes when the outflow equals clinker consumed for cement, within rounding", () => {
    const consumed = clinkerConsumedForCement([
      { label: "OPC", tonnes: 6058.3, clinkerFactor: 0.96 },
      { label: "PPC", tonnes: 9516.7, clinkerFactor: 0.75 },
      { label: "PSC", tonnes: 1733.3, clinkerFactor: 0.7 },
    ]);
    const r = checkMassBalance({
      ...month,
      consumed: consumed.total,
      relTolerance: 0.005,
      thresholdSource: "Product comparison tolerance (DEFAULT_TOLERANCE)",
    });
    expect(r.status).toBe("pass");
  });
});

describe("checkEvidenceCoverage", () => {
  it("fails a twelve-month figure backed by one month, and says it is a scaled month", () => {
    const r = checkEvidenceCoverage({
      id: "cov",
      label: "Grid electricity",
      monthsEvidenced: 1,
      periodMonths: 12,
      annualCell: 30,
      monthlyReading: 2.5,
    });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/scaled up/);
  });

  it("passes with the full period evidenced", () => {
    const r = checkEvidenceCoverage({
      id: "cov",
      label: "Grid electricity",
      monthsEvidenced: 12,
      periodMonths: 12,
      annualCell: 30,
      monthlyReading: 2.5,
    });
    expect(r.status).toBe("pass");
  });
});

describe("checkGcvRule", () => {
  const base = { internal: 4200, external: 4230, thresholdKcal: 71.7, thresholdSource: "test brief, unconfirmed" };

  it("keeps the internal value when the deviation is inside the threshold", () => {
    expect(checkGcvRule({ ...base, cell: 4200 }).status).toBe("pass");
    expect(checkGcvRule({ ...base, cell: 4230 }).status).toBe("fail");
  });

  it("requires the NABL value in the workbook when the deviation exceeds the threshold", () => {
    const r = checkGcvRule({ ...base, external: 4300, cell: 4200 });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/must hold the NABL value/);
    expect(checkGcvRule({ ...base, external: 4300, cell: 4300 }).status).toBe("pass");
  });

  it("carries the threshold source on the result", () => {
    expect(checkGcvRule({ ...base, cell: 4200 }).thresholdSource).toBe("test brief, unconfirmed");
  });
});

describe("checkProductionDays", () => {
  it("passes when no day is zero without DOWN and no DOWN day has output", () => {
    expect(
      checkProductionDays([
        { date: "a", tonnes: 400, status: "RUN" },
        { date: "b", tonnes: 0, status: "DOWN (maint.)" },
      ]).status
    ).toBe("pass");
  });

  it("flags a zero day that is not marked DOWN, and output on a DOWN day", () => {
    const r = checkProductionDays([
      { date: "a", tonnes: 0, status: "RUN" },
      { date: "b", tonnes: 120, status: "DOWN (maint.)" },
    ]);
    expect(r.status).toBe("fail");
    expect(r.actual).toBe(2);
  });
});

describe("checkUnmappedFuel", () => {
  it("fails when fuel is logged but the workbook has no cell for it", () => {
    expect(checkUnmappedFuel({ id: "pc", label: "Petcoke", tonnes: 208.4, workbookHasCell: false }).status).toBe("fail");
  });

  it("passes when there is a cell, or nothing was logged", () => {
    expect(checkUnmappedFuel({ id: "pc", label: "Petcoke", tonnes: 208.4, workbookHasCell: true }).status).toBe("pass");
    expect(checkUnmappedFuel({ id: "pc", label: "Petcoke", tonnes: 0, workbookHasCell: false }).status).toBe("pass");
  });
});

describe("checkRenewableClaim", () => {
  it("passes REC purchases with no renewable claim, as the procedure says", () => {
    const r = checkRenewableClaim({ renewableClaimMwh: 0, recPurchasesMwh: 500, workbookHasExclusion: false });
    expect(r.status).toBe("pass");
    expect(r.detail).toMatch(/not a claim/);
  });

  it("fails a claim with no exclusion, and passes it once the workbook excludes it", () => {
    expect(checkRenewableClaim({ renewableClaimMwh: 100, recPurchasesMwh: 0, workbookHasExclusion: false }).status).toBe("fail");
    expect(checkRenewableClaim({ renewableClaimMwh: 100, recPurchasesMwh: 0, workbookHasExclusion: true }).status).toBe("pass");
  });
});

describe("checkFormulaIntegrity", () => {
  it("passes when every template formula is still a formula", () => {
    const template = new Map([["B17", "B9*B12/B13"]]);
    const submitted = new Map([["B17", { formula: "B9*B12/B13", value: 0 }]]);
    expect(checkFormulaIntegrity({ template, submitted }).status).toBe("pass");
  });

  it("flags a formula cell that was typed over, and a formula that changed", () => {
    const template = new Map([
      ["B17", "B9*B12/B13"],
      ["B18", "B10*B13/B13"],
    ]);
    const submitted = new Map([
      ["B17", { formula: null, value: 93056 }],
      ["B18", { formula: "B10*B13/B12", value: 0 }],
    ]);
    const r = checkFormulaIntegrity({ template, submitted });
    expect(r.status).toBe("fail");
    expect(r.actual).toBe(2);
    expect(r.detail).toMatch(/B17/);
  });
});

/**
 * Backtest: the Shyamrock Cement Works test set (do-res/shyamrock_cement_works.zip)
 * run through the cross-document checks.
 *
 * The workbooks are read from the zip with the product's own readers. The PDFs
 * are not parsed here (PDF text extraction is not in the backend). Their figures
 * are transcribed from the PDF text and marked with their source file. Each
 * expected status is what the checks return on this fixture today, so a change
 * to a check that alters a result fails this file on purpose.
 *
 * The test set is synthetic and most monthly figures are annual values divided
 * or multiplied by 12. Passing here shows the arithmetic works. It does not show
 * the checks catch real errors. That needs seeded errors (see the backtest report).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openZip } from "../archive/zip";
import { parseXlsx, type XlsxCell } from "../intake/xlsx";
import { DEFAULT_TOLERANCE } from "../compare/declared";
import {
  checkDailyAgreement,
  checkEvidenceCoverage,
  checkGcvRule,
  checkMassBalance,
  checkProductionDays,
  checkRecomputed,
  checkRenewableClaim,
  checkSumMatches,
  checkUnmappedFuel,
  clinkerConsumedForCement,
} from "./tieout";

const ZIP = path.resolve(process.cwd(), "do-res", "shyamrock_cement_works.zip");
const HAVE_ZIP = existsSync(ZIP);

function workbook(zip: ReturnType<typeof openZip>, name: string) {
  return parseXlsx(zip.read(name));
}

function cellsOf(zip: ReturnType<typeof openZip>, file: string): XlsxCell[] {
  return workbook(zip, file).sheets[0]!.cells;
}

/** Values of a column under a header, from date rows only (the TOTAL row and footers are excluded). */
function columnByHeader(cells: XlsxCell[], header: string): { date: string; value: unknown; row: number }[] {
  const h = cells.find((c) => c.value === header);
  if (!h) throw new Error(`header "${header}" not found`);
  const dateCol = cells.filter((c) => c.col === 1 && typeof c.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.value));
  return dateCol.map((d) => {
    const v = cells.find((c) => c.row === d.row && c.col === h.col);
    return { date: d.value as string, value: v?.value ?? null, row: d.row };
  });
}

const num = (v: unknown) => Number(v);

describe.skipIf(!HAVE_ZIP)("Shyamrock Cement Works test set: backtest", () => {
  const zip = HAVE_ZIP ? openZip(new Uint8Array(readFileSync(ZIP))) : (null as never);

  it("SCADA clinker, summed over the 30 date rows, equals the monthly report exactly", () => {
    const rows = columnByHeader(cellsOf(zip, "01_scada_production_trend.xlsx"), "Clinker Production (t)");
    expect(rows).toHaveLength(30);
    const r = checkSumMatches({
      id: "scada_clinker",
      label: "SCADA clinker vs MPR",
      parts: rows.map((x) => num(x.value)),
      target: 12500,
    });
    expect(r.status).toBe("pass");
    expect(r.actual).toBe(12500);
  });

  it("SCADA OPC fails an exact match to the MPR by 0.1 t, which is one-decimal rounding", () => {
    const rows = columnByHeader(cellsOf(zip, "01_scada_production_trend.xlsx"), "OPC Produced (t)");
    const exact = checkSumMatches({ id: "opc", label: "OPC", parts: rows.map((x) => num(x.value)), target: 6058.3 });
    expect(exact.status).toBe("fail");
    expect(exact.diff).toBeCloseTo(-0.1, 6);
    const banded = checkSumMatches({
      id: "opc",
      label: "OPC",
      parts: rows.map((x) => num(x.value)),
      target: 6058.3,
      relTolerance: DEFAULT_TOLERANCE,
      thresholdSource: "DEFAULT_TOLERANCE (product comparison tolerance)",
    });
    expect(banded.status).toBe("pass");
  });

  it("the DOWN day on 2023-11-26 carries 454.2 t of output, a contradiction the checks flag", () => {
    const cells = cellsOf(zip, "01_scada_production_trend.xlsx");
    const clinker = columnByHeader(cells, "Clinker Production (t)");
    const status = columnByHeader(cells, "Kiln Run Status");
    const rows = clinker.map((c, i) => ({
      date: c.date,
      tonnes: num(c.value),
      status: String(status[i]!.value ?? ""),
    }));
    const r = checkProductionDays(rows);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/2023-11-26/);
    expect(r.detail).toMatch(/454\.2/);
  });

  it("DPR and SCADA disagree on the five sampled days by more than the product tolerance", () => {
    // Transcribed from 02_daily_production_report.pdf, Nov 1-5 clinker (t).
    const dpr = [
      { date: "2023-11-01", t: 400.0 },
      { date: "2023-11-02", t: 435.4 },
      { date: "2023-11-03", t: 391.1 },
      { date: "2023-11-04", t: 408.8 },
      { date: "2023-11-05", t: 390.3 },
    ];
    const scada = columnByHeader(cellsOf(zip, "01_scada_production_trend.xlsx"), "Clinker Production (t)");
    const rows = dpr.map((d) => ({
      date: d.date,
      a: d.t,
      b: num(scada.find((s) => s.date === d.date)!.value),
    }));
    const r = checkDailyAgreement({
      id: "dpr_vs_scada",
      label: "DPR vs SCADA, sampled days",
      rows,
      relTolerance: DEFAULT_TOLERANCE,
      thresholdSource: "DEFAULT_TOLERANCE (product comparison tolerance)",
    });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/2023-11-03/);
  });

  it("the pro forma clinker, OPC, PPC and PSC inputs are the November MPR × 12, so the annual figure rests on one month", () => {
    // Pro forma Sheet 1 B6, B9, B10, B11 (Lakh t) → t. MPR Nov 2023 (03_monthly_production_report.pdf).
    const cov = checkEvidenceCoverage({
      id: "cov_clinker",
      label: "Clinker production, annual from one month",
      monthsEvidenced: 1,
      periodMonths: 12,
      annualCell: 150000,
      monthlyReading: 12500,
    });
    expect(cov.status).toBe("fail");
    expect(cov.detail).toMatch(/scaled up/);
  });

  it("clinker consumed for cement, from the MPR, closes the mass balance within the product tolerance", () => {
    const consumed = clinkerConsumedForCement([
      { label: "OPC", tonnes: 6058.3, clinkerFactor: 0.96 },
      { label: "PPC", tonnes: 9516.7, clinkerFactor: 0.75 },
      { label: "PSC", tonnes: 1733.3, clinkerFactor: 0.7 },
    ]);
    const r = checkMassBalance({
      // 03_monthly_production_report.pdf, Nov 2023
      opening: 2500,
      production: 12500,
      imports: 1666.7,
      exports: 833.3,
      closing: 1666.7,
      consumed: consumed.total,
      relTolerance: DEFAULT_TOLERANCE,
      thresholdSource: "DEFAULT_TOLERANCE (product comparison tolerance)",
    });
    expect(consumed.total).toBeCloseTo(14166.8, 1);
    expect(r.status).toBe("pass");
  });

  it("Form 1 total equivalent product (240,003 t) reproduces from the pro forma factors, export term included", () => {
    // 16_form1 Section B 5.1(a); pro forma Sheet 1 B9, B10, B11, B7, B12:B14.
    const opc = 72700 * 0.96 / 0.75;
    const ppc = 114200;
    const psc = (20800 * 0.7) / 0.75;
    const exportTerm = 10000 / 0.75;
    const recomputed = opc + ppc + psc + exportTerm;
    const r = checkRecomputed({
      id: "form1_eq_product",
      label: "Form 1 total equivalent product",
      claimed: 240003,
      recomputed,
      relTolerance: DEFAULT_TOLERANCE,
      thresholdSource: "DEFAULT_TOLERANCE (product comparison tolerance)",
    });
    expect(r.status).toBe("pass");
    // The export term adds 13,333 t of cement-equivalent output from clinker that was sold, not ground.
    expect(exportTerm).toBeGreaterThan(13000);
  });

  it("Form 1 direct energy CO2 reproduces from Sheet 3 coal and fuel oil with the sheet's own factors", () => {
    // Sheet 3: coal 34970 t, GCV 4200, GCV→NCV 0.95, EF coal 96.586; fuel oil 120 t, GCV 10000, EF 77.649.
    const TJ_PER_KCAL = 4.1868e-9;
    const coalTJ = 34970 * 1000 * 4200 * 0.95 * TJ_PER_KCAL;
    const oilTJ = 120 * 1000 * 10000 * 0.95 * TJ_PER_KCAL;
    const direct = coalTJ * 96.586 + oilTJ * 77.649;
    const r = checkRecomputed({
      id: "form1_direct_co2",
      label: "Form 1 direct energy CO2",
      claimed: 56794.8,
      recomputed: direct,
      relTolerance: DEFAULT_TOLERANCE,
      thresholdSource: "DEFAULT_TOLERANCE (product comparison tolerance)",
    });
    expect(r.status).toBe("pass");
    expect(Math.abs(r.diff ?? 0)).toBeLessThan(10);
  });

  it("Form 1 indirect CO2 is grid import × the sheet's grid factor (3.0 MU × 0.716)", () => {
    const r = checkRecomputed({
      id: "form1_indirect_co2",
      label: "Form 1 indirect energy CO2",
      claimed: 2148.0,
      recomputed: 3000000 * 0.716 / 1000,
      relTolerance: 0.0001,
      thresholdSource: "Sheet 3 grid factor, marked VERIFY in the fixture",
    });
    expect(r.status).toBe("pass");
  });

  it("CPP daily generation for November, annualised, equals the pro forma's 110.2 Lakh kWh", () => {
    const cpp = columnByHeader(cellsOf(zip, "06_cpp_daily_generation_report.xlsx"), "Gross Generation (kWh)");
    expect(cpp).toHaveLength(30);
    const monthlyLakh = cpp.reduce((a, c) => a + num(c.value), 0) / 100000;
    const annualised = monthlyLakh * 12;
    const r = checkRecomputed({
      id: "cpp_annualised",
      label: "CPP generation, annualised from November",
      claimed: 110.2,
      recomputed: annualised,
      relTolerance: 0.0005,
      thresholdSource: "Tight band, chosen to show the match; the procedure sets no band for this",
    });
    expect(r.status).toBe("pass");
    const cov = checkEvidenceCoverage({
      id: "cov_cpp",
      label: "CPP generation evidence",
      monthsEvidenced: 1,
      periodMonths: 12,
      annualCell: 110.2,
      monthlyReading: monthlyLakh,
    });
    expect(cov.status).toBe("fail");
  });

  it("the grid bill (250,000 kWh for November) ×12 equals the pro forma's 30 Lakh kWh, from one bill", () => {
    // 12_grid_electricity_bill.pdf: Units consumed 250,000 kWh, November 2023.
    const r = checkEvidenceCoverage({
      id: "cov_grid",
      label: "Grid electricity, annual from one bill",
      monthsEvidenced: 1,
      periodMonths: 12,
      annualCell: 30,
      monthlyReading: 2.5,
    });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/scaled up/);
  });

  it("coal: the purchase order for November × 12 matches the pro forma's 34,970 t, and the petcoke log's coal does not", () => {
    // 10_coal_purchase_order.pdf: 2,914.2 t ordered, Nov 2023.
    const po = checkSumMatches({
      id: "coal_po",
      label: "Coal: purchase order × 12 vs Sheet 3",
      parts: [2914.2 * 12],
      target: 34970,
      relTolerance: DEFAULT_TOLERANCE,
      thresholdSource: "DEFAULT_TOLERANCE (product comparison tolerance)",
    });
    expect(po.status).toBe("pass");

    const petcoke = columnByHeader(cellsOf(zip, "11_petcoke_consumption_log.xlsx"), "Coal Consumed (t)");
    const logCoal = petcoke.reduce((a, c) => a + num(c.value), 0);
    const logVsPo = checkSumMatches({
      id: "coal_log_vs_po",
      label: "Coal: petcoke log vs purchase order, November",
      parts: [logCoal],
      target: 2914.2,
      relTolerance: DEFAULT_TOLERANCE,
      thresholdSource: "DEFAULT_TOLERANCE (product comparison tolerance)",
    });
    expect(logVsPo.status).toBe("fail");
    expect(logCoal).toBeCloseTo(1875, 0);
  });

  it("petcoke is 208.4 t in November and has no pro forma cell, so it is a finding", () => {
    const pet = columnByHeader(cellsOf(zip, "11_petcoke_consumption_log.xlsx"), "Petcoke Consumed (t)");
    const tonnes = pet.reduce((a, c) => a + num(c.value), 0);
    const r = checkUnmappedFuel({ id: "petcoke", label: "Petcoke", tonnes, workbookHasCell: false });
    expect(r.status).toBe("fail");
    expect(tonnes).toBeCloseTo(208.4, 1);
  });

  it("the NABL certificate's 30 kcal/kg deviation is inside 71.7 kcal/kg, so the internal 4,200 stands in the workbook", () => {
    const r = checkGcvRule({
      internal: 4200,
      external: 4230,
      cell: 4200,
      thresholdKcal: 71.7,
      thresholdSource: "Test brief (71.7 kcal/kg). Not found in the procedure pages read; unconfirmed.",
    });
    expect(r.status).toBe("pass");
  });

  it("the REC declaration is nil, and REC purchases alone are not a renewable claim", () => {
    const r = checkRenewableClaim({ renewableClaimMwh: 0, recPurchasesMwh: 0, workbookHasExclusion: false });
    expect(r.status).toBe("pass");
  });
});

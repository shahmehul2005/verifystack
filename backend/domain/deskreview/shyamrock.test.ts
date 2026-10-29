/**
 * Desk review and pro forma inputs run on the real Shyamrock test set
 * (do-res/shyamrock_cement_works.zip). Workbooks go through the product's readers.
 * PDF figures are typed in as the auditor would, each transcribed from its PDF.
 * The seeded-error cases show the checks fail when a figure is wrong, which the
 * clean fixture alone cannot show.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openZip } from "../archive/zip";
import { parseXlsx } from "../intake/xlsx";
import { loadPack } from "../packs";
import { readProforma } from "../proforma/reader";
import { assessRunReadiness, executeRun, type ProvenancedFact } from "../calc/run";
import { deskReviewFor, readWorkbooks, runDeskReview, type DeskWorkbook, type Readings } from "./index";

const ZIP = path.resolve(process.cwd(), "do-res", "shyamrock_cement_works.zip");
const HAVE_ZIP = existsSync(ZIP);

const SLOTS: [string, string][] = [
  ["01_scada_production_trend.xlsx", "production_evidence"],
  ["06_cpp_daily_generation_report.xlsx", "cpp_generation"],
  ["08_coal_internal_lab_report.xlsx", "coal_quality"],
  ["11_petcoke_consumption_log.xlsx", "petcoke_log"],
  ["15_sector_specific_proforma.xlsx", "proforma_workbook"],
];

// Transcribed from the PDFs in the set (file named in each comment).
const PDF: Readings = {
  // 03_monthly_production_report.pdf
  "mpr.clinker_t": 12500,
  "mpr.opc_t": 6058.3,
  "mpr.ppc_t": 9516.7,
  "mpr.psc_t": 1733.3,
  "mpr.clinker_opening_t": 2500,
  "mpr.clinker_import_t": 1666.7,
  "mpr.clinker_export_t": 833.3,
  "mpr.clinker_closing_t": 1666.7,
  // 04_sap_pp_module_printout.pdf
  "sap.opc_t": 6058.3,
  "sap.ppc_t": 9516.7,
  "sap.psc_t": 1733.3,
  // 02_daily_production_report.pdf, Nov 1-5
  "dpr.clinker@2023-11-01": 400.0,
  "dpr.clinker@2023-11-02": 435.4,
  "dpr.clinker@2023-11-03": 391.1,
  "dpr.clinker@2023-11-04": 408.8,
  "dpr.clinker@2023-11-05": 390.3,
  // 07_cpp_monthly_generation_report.pdf
  "cpp.report_lakh_kwh": 110.2,
  // 12_grid_electricity_bill.pdf
  "grid.bill_kwh": 250000,
  "grid.bill_months": 1,
  // 10_coal_purchase_order.pdf
  "coal.po_t": 2914.2,
  "coal.po_months": 1,
  // 09_coal_nabl_external_certificate.pdf
  "coal.nabl_gcv": 4230,
  // 13_rec_certificate_status.pdf
  "rec.claim_mwh": 0,
  "rec.purchases_mwh": 0,
  // 16_form1_annual_energy_ghg.pdf
  "form1.eq_product_t": 240003,
  "form1.direct_co2_t": 56794.8,
  "form1.indirect_co2_t": 2148.0,
};

function files(): DeskWorkbook[] {
  const zip = openZip(new Uint8Array(readFileSync(ZIP)));
  return SLOTS.map(([name, slot]) => ({ slot, name, bytes: zip.read(name) }));
}

describe.skipIf(!HAVE_ZIP)("Shyamrock: pro forma inputs and desk review", () => {
  const pack = loadPack("CCTS-CEMENT-v1");
  const def = deskReviewFor("CCTS-CEMENT-v1")!;
  const wbs = files();
  const { readings: fromWorkbooks, notes, origins } = readWorkbooks(def, wbs, pack.proforma_inputs ?? []);
  const outcome = (manual: Readings) =>
    Object.fromEntries(runDeskReview(def, { ...fromWorkbooks, ...manual }).map((r) => [r.id, r]));

  it("reads the run's inputs from the pro forma, recomputing formulas the file stored as 0", () => {
    const proforma = parseXlsx(wbs.find((w) => w.slot === "proforma_workbook")!.bytes);
    const reading = readProforma(proforma, pack.proforma_inputs!);
    const by = Object.fromEntries(reading.drafts.map((d) => [d.fieldPath ?? "unmapped", d]));
    expect(by.production!.value).toBeCloseTo(240002.7, 0);
    expect(by.production!.cachedValue).toBe(0);
    expect(by.quantity!.value).toBe(34970);
    expect(by.calorificValue!.value).toBe(4200);
    expect(by.activeEnergy!.value).toBe(3_000_000);
    expect(by["furnaceOil.quantity"]!.value).toBe(120);
    expect(by["furnaceOil.calorificValue"]!.value).toBe(10000);
    expect(by.unmapped).toBeUndefined();
    expect(reading.staleFormulaCells).toBeGreaterThan(0);
    expect(reading.formulaErrors).toEqual([]);
  });

  it("does not run from pro forma facts alone, because calcination has no fact", () => {
    const proforma = parseXlsx(wbs.find((w) => w.slot === "proforma_workbook")!.bytes);
    const drafts = readProforma(proforma, pack.proforma_inputs!).drafts.filter((d) => d.fieldPath && d.value !== null);
    const facts: ProvenancedFact[] = drafts.map((d, i) => ({
      id: `f${i}`,
      field_path: d.fieldPath!,
      value_json: d.value!,
      unit: d.unit,
      document_id: "doc-proforma",
      page: null,
      bbox: null,
      source_text: null,
      provenance_type: "spreadsheet_cell",
      provenance: { type: "spreadsheet_cell", documentId: "doc-proforma", sheet: d.sheet!, cellRef: d.cellRef!, value: d.workbookValue!, label: d.label },
    }));
    const ready = assessRunReadiness(pack, facts, { draftMode: true });
    // Coal, grid electricity and furnace oil.
    expect(ready.boundStreamCount).toBe(3);
    expect(ready.streams.find((s) => s.streamId === "furnace-oil")?.bound).toBe(true);
    expect(ready.canRun).toBe(false);
    expect(ready.blockers.join(" ")).toMatch(/process\.calcinationEmissions/);
    expect(ready.warnings.join(" ")).toMatch(/counted as zero/i);
    expect(ready.warnings.join(" ")).not.toMatch(/Clinker calcination process CO2/i);
    expect(() =>
      executeRun({
        engagementId: "e",
        organizationId: "o",
        packId: "CCTS-CEMENT-v1",
        packVersion: pack.version,
        complianceYear: "FY2023-24",
        geiTarget: 1,
        draftMode: true,
        facts,
      })
    ).toThrow(/process\.calcinationEmissions/);
  });

  it("runs fuel oil as its own stream once calcination is supplied", () => {
    const proforma = parseXlsx(wbs.find((w) => w.slot === "proforma_workbook")!.bytes);
    const drafts = readProforma(proforma, pack.proforma_inputs!).drafts.filter((d) => d.fieldPath && d.value !== null);
    const facts: ProvenancedFact[] = drafts.map((d, i) => ({
      id: `f${i}`,
      field_path: d.fieldPath!,
      value_json: d.value!,
      unit: d.unit,
      document_id: "doc-proforma",
      page: null,
      bbox: null,
      source_text: null,
      provenance_type: "spreadsheet_cell",
      provenance: { type: "spreadsheet_cell", documentId: "doc-proforma", sheet: d.sheet!, cellRef: d.cellRef!, value: d.workbookValue!, label: d.label },
    }));
    // A stand-in calcination figure for the test only. The product never invents one.
    facts.push({
      id: "calc",
      field_path: "process.calcinationEmissions",
      value_json: 1000,
      unit: "tCO2e",
      document_id: "doc-calc",
      page: null,
      bbox: null,
      source_text: null,
      provenance_type: "spreadsheet_cell",
      provenance: { type: "spreadsheet_cell", documentId: "doc-calc", sheet: "t", cellRef: "A1", value: 1000, label: "test" },
    });
    const run = executeRun({
      engagementId: "e",
      organizationId: "o",
      packId: "CCTS-CEMENT-v1",
      packVersion: pack.version,
      complianceYear: "FY2023-24",
      geiTarget: 1,
      draftMode: true,
      facts,
    });
    const ids = run.result.streams.map((s) => s.streamId);
    expect(ids).toEqual(expect.arrayContaining(["coal-kiln", "grid-ht", "furnace-oil", "clinker-calcination"]));
    const oil = run.result.streams.find((s) => s.streamId === "furnace-oil")!;
    // 120 t, 10000 kcal/kg: the engine's own factor set prices it, so it is near but not equal to the workbook's 370.6 t.
    const tonnesCo2 = oil.emissions.unit === "kgCO2e" ? oil.emissions.value / 1000 : oil.emissions.value;
    expect(tonnesCo2).toBeGreaterThan(360);
    expect(tonnesCo2).toBeLessThan(375);
    expect(tonnesCo2).not.toBeCloseTo(370.6, 1);
  });

  it("reads the workbook figures by code and leaves the PDF figures to the auditor", () => {
    expect(fromWorkbooks["scada.clinker_sum"]).toBeCloseTo(12500, 6);
    expect(fromWorkbooks["scada.months"]).toBe(1);
    expect(fromWorkbooks["petcoke.petcoke_t_sum"]).toBeCloseTo(208.4, 1);
    expect(fromWorkbooks["pf.petcoke_t"]).toBeUndefined();
    expect(fromWorkbooks["pf.unmapped_count"]).toBe(0);
    expect(fromWorkbooks["lab.gcv_n"]).toBe(30);
    expect(fromWorkbooks["lab.gcv_months"]).toBe(1);
    expect(fromWorkbooks["pf.coal_t"]).toBe(34970);
    expect(Number(fromWorkbooks["pf.s2_process_coal_t"]) + Number(fromWorkbooks["pf.s2_power_coal_t"])).toBeCloseTo(34970, 3);
    expect(Number(fromWorkbooks["pf.s2_fuel_oil_t"])).toBeCloseTo(Number(fromWorkbooks["pf.fuel_oil_t"]), 3);
    expect(Number(fromWorkbooks["pf.s2_grid_import_kwh"])).toBeCloseTo(Number(fromWorkbooks["pf.grid_kwh"]), 3);
    expect(Number(fromWorkbooks["pf.s2_grid_export_kwh"])).toBeGreaterThan(0);
    expect(fromWorkbooks["pf.calcination_state"]).toBe("missing");
    expect(fromWorkbooks["pf.petcoke_has_emission"]).toBe(0);
    expect(fromWorkbooks["pf.gcv_ncv_ref"]).toBe("B10");
    expect(String(fromWorkbooks["pf.coal_energy_formula"])).toContain("B10");
    expect(fromWorkbooks["pf.formula@3_GHG_CCTS!B20"]).toBe("B18*B11+B19*B12");
    expect(notes.join(" ")).toMatch(/recomputed/);
    expect(fromWorkbooks["mpr.clinker_t"]).toBeUndefined();
  });

  it("with no PDF figures entered, checks that need a typed figure wait", () => {
    const o = outcome({});
    expect(o.scada_clinker_vs_mpr!.status).toBe("pending");
    expect(o.form1_direct!.status).toBe("pending");
    expect(o.coal_stock_balance!.status).toBe("pending");
    expect(o.coal_weighfeeder!.status).toBe("pending");
    expect(o.gcv_nabl_corroboration!.status).toBe("pending");
    expect(o.production_days!.status).toBe("fail");
    expect(o.engine_coverage!.status).toBe("pass");
    expect(o.coverage_coal!.status).toBe("fail");
    expect(o.gcv_samples!.status).toBe("fail");
  });

  it("on the clean set: agreements pass, and the known problems in the set are reported", () => {
    const o = outcome(PDF);
    const status = Object.fromEntries(Object.values(o).map((r) => [r.id, r.status]));
    expect(status).toMatchObject({
      scada_clinker_vs_mpr: "pass",
      scada_opc_vs_mpr: "pass",
      sap_opc_vs_scada: "pass",
      clinker_mass_balance: "pass",
      form1_eq_product: "pass",
      form1_direct: "pass",
      form1_indirect: "pass",
      workbook_vs_engine: "pass",
      engine_coverage: "pass",
      cpp_report_vs_proforma: "pass",
      gcv_ncv_used: "pass",
      gcv_nabl_corroboration: "not_applicable",
      renewable_claim: "pass",
      sheet2_coal_tie: "pass",
      sheet2_fuel_oil_tie: "pass",
      sheet2_grid_tie: "pass",
      formula_integrity: "pass",
      // problems the test set contains
      production_days: "fail",
      dpr_vs_scada: "fail",
      coverage_clinker: "fail",
      coverage_cpp: "fail",
      coverage_grid: "fail",
      coverage_coal: "fail",
      gcv_samples: "fail",
      sheet2_export: "fail",
      source_profile: "fail",
      materiality_aggregate: "fail",
      petcoke_cell: "fail",
      // stock PDFs are not typed in this test
      coal_stock_balance: "pending",
      coal_weighfeeder: "pending",
    });
    const pending = Object.values(o)
      .filter((r) => r.status === "pending")
      .map((r) => r.id)
      .sort();
    expect(pending).toEqual(["coal_stock_balance", "coal_weighfeeder"]);
    expect(o.coal_stock_balance!.missing).toEqual(expect.arrayContaining(["coal.opening_t", "coal.receipts_t", "coal.issues_t", "coal.closing_t"]));
    const fo = Number(fromWorkbooks["pf.fuel_oil_energy_tj"]) * Number(fromWorkbooks["pf.ef_fuel_oil"]);
    const total = Number(fromWorkbooks["pf.total_co2"]);
    expect(fo).toBeGreaterThan(0);
    // Fuel oil is a stream the engine takes, so it is not a misstatement any more.
    expect(o.workbook_vs_engine!.diff).toBeCloseTo(0, 3);
    expect(o.workbook_vs_engine!.detail).toMatch(/both streams the calculation takes/i);
    expect(o.workbook_vs_engine!.detail).toMatch(/Workbook indirect CO2/);
    expect(o.materiality_aggregate!.actual).toBe(0);
    expect(o.materiality_aggregate!.expected).toBeCloseTo(total * 0.02, 3);
    expect(o.materiality_aggregate!.actual!).toBeLessThan(o.materiality_aggregate!.expected!);
    expect(o.materiality_aggregate!.thresholdSource).toMatch(/2% of total reported emissions/);
    expect(o.materiality_aggregate!.detail).toMatch(/No calcination number was added/);
    expect(o.materiality_aggregate!.detail).toMatch(/cannot pass/);
    expect(o.source_profile!.detail).toMatch(/cannot be counted as zero because either is large enough to move a 2% materiality threshold/i);
    expect(o.source_profile!.detail).toMatch(/no factor was invented/i);
    expect(o.source_profile!.detail).toMatch(/unquantified/i);
    expect(o.source_profile!.detail).toMatch(/calcination is missing/i);
    expect(o.sheet2_export!.detail).toMatch(/not deducted/i);
    expect(o.sheet2_export!.detail).toMatch(/confirm whether the procedure requires deduction/i);
    expect(o.gcv_samples!.thresholdSource).toBe(
      "CCTS Detailed Procedure, solid fuel sampling (every 20,000 t or monthly, whichever is more often), as read from the ICAI-hosted copy."
    );
    expect(o.gcv_samples!.detail).toMatch(/fewer months than 12/);
    expect(o.gcv_nabl_corroboration!.detail).toMatch(/corroborat/i);
    expect(o.gcv_nabl_corroboration!.detail).not.toMatch(/71\.7/);
    expect(o.formula_integrity!.detail).toMatch(/not a BEE-issued blank file/);
    for (const row of Object.values(o)) {
      expect(row.detail).not.toMatch(/71\.7/);
      expect(row.thresholdSource ?? "").not.toMatch(/71\.7/);
    }
  });

  it("shows which document, cell or page each figure in a check came from", () => {
    const withOrigins = {
      ...origins,
      "form1.direct_co2_t": { slot: "form1", documentId: "doc-form1", filename: "16_form1_annual_energy_ghg.pdf", location: "p. 2" },
    };
    const rows = Object.fromEntries(runDeskReview(def, { ...fromWorkbooks, ...PDF }, withOrigins).map((r) => [r.id, r]));
    const form1 = Object.fromEntries(rows.form1_direct!.sources!.map((s) => [s.key, s]));
    expect(form1["pf.direct_co2"]).toMatchObject({
      slot: "proforma_workbook",
      filename: "15_sector_specific_proforma.xlsx",
      location: "3_GHG_CCTS!B20",
      unit: "tCO2e",
    });
    expect(form1["form1.direct_co2_t"]).toMatchObject({
      label: "Form 1: direct energy CO2",
      documentId: "doc-form1",
      location: "p. 2",
    });
    const scada = rows.scada_clinker_vs_mpr!.sources!.find((s) => s.key === "scada.clinker_sum");
    expect(scada).toMatchObject({ slot: "production_evidence", filename: "01_scada_production_trend.xlsx" });
    // A series is one source with a count, not one line a day.
    const days = rows.production_days!.sources!.find((s) => s.key === "scada.clinker@*");
    expect(String(days!.value)).toMatch(/dated reading/);
    // A check that is waiting lists only what it has; the rest is in `missing`.
    const waiting = rows.coal_stock_balance!;
    expect(waiting.status).toBe("pending");
    expect(waiting.sources!.map((s) => s.key)).toEqual(["petcoke.coal_t_sum"]);
  });

  it("seeded errors: a wrong monthly report, Form 1 and REC claim are caught", () => {
    const o = outcome({
      ...PDF,
      "mpr.clinker_t": 12000,
      "form1.direct_co2_t": 50000,
      "rec.claim_mwh": 40,
    });
    expect(o.scada_clinker_vs_mpr!.status).toBe("fail");
    expect(o.form1_direct!.status).toBe("fail");
    expect(o.renewable_claim!.status).toBe("fail");
  });
});

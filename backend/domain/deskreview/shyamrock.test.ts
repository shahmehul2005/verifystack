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
  const { readings: fromWorkbooks, notes } = readWorkbooks(def, wbs, pack.proforma_inputs ?? []);
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
    expect(by.unmapped!.status).toBe("unmapped");
    expect(reading.staleFormulaCells).toBeGreaterThan(0);
    expect(reading.formulaErrors).toEqual([]);
  });

  it("runs the calculation from pro forma facts alone", () => {
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
    expect(ready.canRun).toBe(true);
    expect(ready.boundStreamCount).toBe(2);
    expect(ready.warnings.join(" ")).toMatch(/counted as zero/i);
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
    expect(run.result.gei).toBeGreaterThan(0);
  });

  it("reads the workbook figures by code and leaves the PDF figures to the auditor", () => {
    expect(fromWorkbooks["scada.clinker_sum"]).toBeCloseTo(12500, 6);
    expect(fromWorkbooks["scada.months"]).toBe(1);
    expect(fromWorkbooks["petcoke.petcoke_t_sum"]).toBeCloseTo(208.4, 1);
    expect(fromWorkbooks["pf.petcoke_t"]).toBeUndefined();
    expect(fromWorkbooks["pf.unmapped_count"]).toBe(1);
    expect(notes.join(" ")).toMatch(/recomputed/);
    expect(fromWorkbooks["mpr.clinker_t"]).toBeUndefined();
  });

  it("with no PDF figures entered, every check that needs one waits and none passes by default", () => {
    const o = outcome({});
    expect(o.scada_clinker_vs_mpr!.status).toBe("pending");
    expect(o.form1_direct!.status).toBe("pending");
    expect(o.production_days!.status).toBe("fail");
    expect(o.engine_coverage!.status).toBe("fail");
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
      cpp_report_vs_proforma: "pass",
      gcv_rule: "pass",
      renewable_claim: "pass",
      // problems the test set contains
      production_days: "fail",
      dpr_vs_scada: "fail",
      coverage_clinker: "fail",
      coverage_cpp: "fail",
      coverage_grid: "fail",
      coverage_coal: "fail",
      coal_log_vs_po: "fail",
      petcoke_cell: "fail",
      engine_coverage: "fail",
    });
    expect(Object.values(status)).not.toContain("pending");
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

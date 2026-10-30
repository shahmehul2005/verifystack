import { describe, expect, it } from "vitest";
import { CEMENT_DESK_REVIEW } from "./cement";
import { printedPeriodMonths, proposeFromDocuments, proposeReadings, type EvidenceDocumentCandidate } from "./propose";
import type { PdfPageText } from "../extraction/pdfText";

const page = (lines: string[], n = 1): PdfPageText[] => [{ page: n, lines }];

const MPR = (clinker = "12,500.0") =>
  page([
    "Monthly Production Report (MPR)",
    "Document No: MPR/2023-24/11 | Period: November 2023",
    "Item Qty (t)",
    `Clinker Production ${clinker}`,
    "Clinker Opening Stock 2,500.0",
    "Clinker Closing Stock 1,666.7",
    "Clinker Export 833.3",
    "Clinker Import 1,666.7",
    "OPC Produced 6,058.3",
    "PPC Produced 9,516.7",
    "PSC Produced 1,733.3",
    "Note: Clinker Factors — OPC 0.96, PPC 0.75, PSC 0.70",
  ]);

const NABL = (internal = "4200", external = "4230", dev = "+30") =>
  page([
    "NABL Accredited Laboratory — Coal Test Certificate",
    "Document No: NABL-CERT/2023-24/Q3 | Period: Q3 2023-24",
    "Parameter Internal Lab Result Deviation",
    `GCV (kcal/kg, as fired) ${internal} ${external} ${dev} WITHIN THRESHOLD`,
    "Ash (%) 22.00 22.16 — ±2% material threshold",
  ]);

const doc = (id: string, name: string, slot: string, pages: PdfPageText[] | null): EvidenceDocumentCandidate => ({
  id,
  name,
  slot,
  pages,
});

describe("Desk Review proposeReadings reads the printed text", () => {
  it("proposes the figures the monthly report prints, with page and the exact line", () => {
    const out = proposeReadings(CEMENT_DESK_REVIEW, [doc("d1", "mpr.pdf", "production_evidence", MPR())]);
    const by = Object.fromEntries(out.map((p) => [p.key, p]));
    expect(by["mpr.clinker_t"]).toMatchObject({ value: 12500, page: 1, documentId: "d1", sourceText: "Clinker Production 12,500.0" });
    expect(by["mpr.opc_t"]?.value).toBe(6058.3);
    expect(by["mpr.ppc_t"]?.value).toBe(9516.7);
    expect(by["mpr.psc_t"]?.value).toBe(1733.3);
    expect(by["mpr.clinker_opening_t"]?.value).toBe(2500);
    expect(by["mpr.clinker_closing_t"]?.value).toBe(1666.7);
    expect(by["mpr.clinker_export_t"]?.value).toBe(833.3);
    expect(by["mpr.clinker_import_t"]?.value).toBe(1666.7);
  });

  it("returns the edited figure when the document was edited, never a remembered one", () => {
    const out = proposeReadings(CEMENT_DESK_REVIEW, [doc("d1", "03_monthly_production_report.pdf", "production_evidence", MPR("13,500.0"))]);
    expect(out.find((p) => p.key === "mpr.clinker_t")?.value).toBe(13500);
  });

  it("does not depend on the file name", () => {
    const a = proposeReadings(CEMENT_DESK_REVIEW, [doc("x", "scan_0001.pdf", "production_evidence", MPR())]);
    const b = proposeReadings(CEMENT_DESK_REVIEW, [doc("y", "03_monthly_production_report.pdf", "production_evidence", MPR())]);
    expect(a.map((p) => [p.key, p.value])).toEqual(b.map((p) => [p.key, p.value]));
  });

  it("reads the NABL result as the external column, not the internal one", () => {
    const out = proposeReadings(CEMENT_DESK_REVIEW, [doc("n", "cert.pdf", "coal_quality", NABL("4200", "4480", "+280"))]);
    const gcv = out.find((p) => p.key === "coal.nabl_gcv");
    expect(gcv?.value).toBe(4480);
    expect(gcv?.unit).toBe("kcal/kg");
  });

  it("reads SAP confirmed quantity, not the order quantity", () => {
    const sap = page([
      "Material Material Code Order Qty (t) Confirmed Qty (t) Plant",
      "Clinker (OPC grade) FG-CLK-OPC 6,100.0 6,058.3 1000",
      "Cement - PPC 43 Grade FG-CEM-PPC43 9,600.0 9,516.7 1000",
      "Cement - PSC FG-CEM-PSC 1,800.0 1,733.3 1000",
    ]);
    const out = proposeReadings(CEMENT_DESK_REVIEW, [doc("s", "sap.pdf", "production_evidence", sap)]);
    const by = Object.fromEntries(out.map((p) => [p.key, p.value]));
    expect(by["sap.opc_t"]).toBe(6058.3);
    expect(by["sap.ppc_t"]).toBe(9516.7);
    expect(by["sap.psc_t"]).toBe(1733.3);
  });

  it("reads the Form 1 figures and ignores digits inside unit text such as CO2eq", () => {
    const form1 = page([
      "Total Equivalent Product Tonne 240,003",
      "Direct GHG Emissions (Energy related) t CO2eq 56,794.8",
      "Indirect GHG Emissions (Energy related) t CO2eq 2,148.0",
      "Total Direct & Indirect Emissions t CO2eq 58,942.8",
    ]);
    const by = Object.fromEntries(proposeReadings(CEMENT_DESK_REVIEW, [doc("f", "form1.pdf", "form1", form1)]).map((p) => [p.key, p.value]));
    expect(by["form1.eq_product_t"]).toBe(240003);
    expect(by["form1.direct_co2_t"]).toBe(56794.8);
    expect(by["form1.indirect_co2_t"]).toBe(2148);
  });

  it("reads the printed daily table as a dated series and stops at the end of the table", () => {
    const dpr = page([
      "Date Clinker (t) Thermal Energy (Mkcal) Electrical Energy (MWh) Remarks",
      "2023-11-01 400.0 280.0 22.0 Normal ops",
      "2023-11-02 435.4 304.8 23.9 Normal ops",
      "Prepared by: Shift Production Engineer",
      "2023-11-09 999.0 1 1 stray line after the table",
    ]);
    const out = proposeReadings(CEMENT_DESK_REVIEW, [doc("p", "dpr.pdf", "production_evidence", dpr)]);
    const series = out.find((p) => p.key === "dpr.clinker");
    expect(series?.rawText).toBe("2023-11-01 400\n2023-11-02 435.4");
    expect(series?.rawText).not.toContain("999");
  });

  it("proposes zero only when every row of a REC declaration prints nil", () => {
    const nil = page([
      "Onsite Renewable Generation Capacity (MW) Nil",
      "RECs purchased/obtained this compliance cycle Nil",
      "Open Access / dedicated PPA renewable procurement Nil",
    ]);
    const claimed = page([
      "Onsite Renewable Generation Capacity (MW) 12",
      "RECs purchased/obtained this compliance cycle Nil",
      "Open Access / dedicated PPA renewable procurement Nil",
    ]);
    const a = proposeReadings(CEMENT_DESK_REVIEW, [doc("r", "rec.pdf", "rec_declaration", nil)]);
    expect(a.find((p) => p.key === "rec.claim_mwh")?.value).toBe(0);
    expect(a.find((p) => p.key === "rec.purchases_mwh")?.value).toBe(0);
    const b = proposeReadings(CEMENT_DESK_REVIEW, [doc("r", "rec.pdf", "rec_declaration", claimed)]);
    expect(b.find((p) => p.key === "rec.claim_mwh")).toBeUndefined();
    expect(b.find((p) => p.key === "rec.purchases_mwh")?.value).toBe(0);
  });

  it("proposes nothing from a PDF with no text layer and says so", () => {
    const { suggestions, unreadable } = proposeFromDocuments(CEMENT_DESK_REVIEW, [
      doc("scan", "03_monthly_production_report.pdf", "production_evidence", [{ page: 1, lines: [] }]),
    ]);
    expect(suggestions).toEqual([]);
    expect(unreadable).toEqual([{ documentId: "scan", documentName: "03_monthly_production_report.pdf", reason: "no_text_layer" }]);
  });

  it("does not reach across slots", () => {
    const out = proposeReadings(CEMENT_DESK_REVIEW, [doc("m", "mpr.pdf", "coal_quality", MPR())]);
    expect(out.find((p) => p.key === "mpr.clinker_t")).toBeUndefined();
  });

  it("surfaces two documents that disagree instead of choosing quietly", () => {
    const out = proposeReadings(CEMENT_DESK_REVIEW, [
      doc("a", "mpr_a.pdf", "production_evidence", MPR("12,500.0")),
      doc("b", "mpr_b.pdf", "production_evidence", MPR("13,500.0")),
    ]);
    const hit = out.find((p) => p.key === "mpr.clinker_t")!;
    expect(hit.note).toContain("mpr_b.pdf 13500");
    expect(hit.confidence).toBeLessThanOrEqual(0.5);
  });

  it("derives months covered from the printed period", () => {
    expect(printedPeriodMonths(["Document No: BILL/2023-24/11 | Period: November 2023"])).toBe(1);
    expect(printedPeriodMonths(["Billing Period November 2023"])).toBe(1);
    expect(printedPeriodMonths(["Document No: FORM1/2023-24 | Period: 01-Apr-2023 to 31-Mar-2024"])).toBe(12);
    expect(printedPeriodMonths(["Document No: X | Period: Q3 2023-24"])).toBe(3);
    expect(printedPeriodMonths(["Period: 6 Months"])).toBe(6);
    expect(printedPeriodMonths(["No period here"])).toBeNull();
  });

  it("proposes grid bill months from the printed billing period", () => {
    const bill = page([
      "Document No: BILL/2023-24/11 | Period: November 2023",
      "Particulars Value",
      "Billing Period November 2023",
      "Units Consumed (kWh) 250,000",
    ]);
    const by = Object.fromEntries(proposeReadings(CEMENT_DESK_REVIEW, [doc("g", "bill.pdf", "grid_electricity", bill)]).map((p) => [p.key, p.value]));
    expect(by["grid.bill_kwh"]).toBe(250000);
    expect(by["grid.bill_months"]).toBe(1);
  });
});

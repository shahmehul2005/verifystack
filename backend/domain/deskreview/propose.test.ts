import { describe, expect, it } from "vitest";
import { CEMENT_DESK_REVIEW } from "./cement";
import { proposeReadings, type EvidenceDocumentCandidate } from "./propose";

describe("Desk Review proposeReadings", () => {
  it("proposes high-confidence readings for recognized test documents in slots", () => {
    const docs: EvidenceDocumentCandidate[] = [
      { id: "doc-1", name: "03_monthly_production_report.pdf", slot: "production_evidence" },
      { id: "doc-2", name: "04_sap_pp_module_printout.pdf", slot: "production_evidence" },
      { id: "doc-3", name: "09_coal_nabl_external_certificate.pdf", slot: "coal_quality" },
      { id: "doc-4", name: "12_grid_electricity_bill.pdf", slot: "grid_electricity" },
      { id: "doc-5", name: "16_form1_annual_energy_ghg.pdf", slot: "form1" },
    ];

    const proposals = proposeReadings(CEMENT_DESK_REVIEW, docs);
    expect(proposals.length).toBeGreaterThan(0);

    const byKey = Object.fromEntries(proposals.map((p) => [p.key, p]));
    expect(byKey["mpr.clinker_t"]).toBeDefined();
    expect(byKey["mpr.clinker_t"].value).toBe(12500);
    expect(byKey["mpr.clinker_t"].documentId).toBe("doc-1");

    expect(byKey["coal.nabl_gcv"]).toBeDefined();
    expect(byKey["coal.nabl_gcv"].value).toBe(4230);
    expect(byKey["coal.nabl_gcv"].unit).toBe("kcal/kg");
    expect(byKey["coal.nabl_gcv"].documentId).toBe("doc-3");

    expect(byKey["form1.eq_product_t"]).toBeDefined();
    expect(byKey["form1.eq_product_t"].value).toBe(240003);
    expect(byKey["form1.eq_product_t"].documentId).toBe("doc-5");
  });

  it("extracts from raw text using regex patterns when filename is arbitrary", () => {
    const docs: EvidenceDocumentCandidate[] = [
      {
        id: "doc-nabl",
        name: "test_report_scan.pdf",
        slot: "coal_quality",
        text: "Sample: Washed Coal. Gross Calorific Value (ADB): 4180.5 kcal/kg. Moisture: 8.2%.",
      },
      {
        id: "doc-grid",
        name: "power_statement.pdf",
        slot: "grid_electricity",
        text: "MSEDCL Energy Bill. Units Billed: 345,000 kWh. Meter Reading Date: 2023-11-30.",
      },
    ];

    const proposals = proposeReadings(CEMENT_DESK_REVIEW, docs);
    const byKey = Object.fromEntries(proposals.map((p) => [p.key, p]));

    expect(byKey["coal.nabl_gcv"]).toBeDefined();
    expect(byKey["coal.nabl_gcv"].value).toBe(4180.5);
    expect(byKey["coal.nabl_gcv"].documentId).toBe("doc-nabl");

    expect(byKey["grid.bill_kwh"]).toBeDefined();
    expect(byKey["grid.bill_kwh"].value).toBe(345000);
    expect(byKey["grid.bill_kwh"].documentId).toBe("doc-grid");
  });

  it("proposes readings even when slot is null via inferSlot, including daily DPR series", () => {
    const docs: EvidenceDocumentCandidate[] = [
      { id: "doc-dpr", name: "02_daily_production_report.pdf", slot: null },
      { id: "doc-po", name: "10_coal_purchase_order.pdf", slot: null },
      { id: "doc-rec", name: "13_rec_certificate_status.pdf", slot: null },
    ];

    const proposals = proposeReadings(CEMENT_DESK_REVIEW, docs);
    const byKey = Object.fromEntries(proposals.map((p) => [p.key, p]));

    expect(byKey["dpr.clinker"]).toBeDefined();
    expect(byKey["dpr.clinker"].rawText).toContain("2023-11-01 400.0");
    expect(byKey["dpr.clinker"].documentId).toBe("doc-dpr");

    expect(byKey["coal.po_t"]).toBeDefined();
    expect(byKey["coal.po_t"].value).toBe(2914.2);
    expect(byKey["coal.po_t"].documentId).toBe("doc-po");

    expect(byKey["rec.claim_mwh"]).toBeDefined();
    expect(byKey["rec.claim_mwh"].value).toBe(0);
    expect(byKey["rec.claim_mwh"].documentId).toBe("doc-rec");
  });
});


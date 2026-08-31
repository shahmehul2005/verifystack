import { describe, expect, it } from "vitest";
import { executeRun } from "../calc/run";
import { SEED_FACTS } from "../../demo/seed";
import type { ProvenancedFact } from "../calc/run";
import { fyMonths, reconciliationContextFromFacts } from "./fromFacts";
import { runRules } from "./rules";

function seedFacts(): ProvenancedFact[] {
  return SEED_FACTS.map((f) => ({
    id: f.id,
    field_path: f.field,
    value_json: f.value,
    unit: f.unit ?? null,
    document_id: f.documentId,
    page: f.page,
    bbox: f.bbox,
    source_text: f.sourceText,
  }));
}

describe("fyMonths", () => {
  it("expands an Indian financial year to twelve ISO months", () => {
    expect(fyMonths("FY2025-26")).toEqual([
      "2025-04",
      "2025-05",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });
});

describe("reconciliationContextFromFacts", () => {
  it("does not invent Aravalli stock, sampling, or monthly gaps", () => {
    const run = executeRun({
      engagementId: "eng-rjk-cem-fy2526",
      organizationId: "org-demo",
      packId: "CCTS-CEMENT-v1",
      packVersion: "1.0.0",
      complianceYear: "FY2025-26",
      geiTarget: 0.82,
      draftMode: true,
      facts: seedFacts(),
    });
    const ctx = reconciliationContextFromFacts({
      complianceYear: "FY2025-26",
      calc: run.result,
      facts: seedFacts(),
    });
    expect(ctx.stockMovements).toEqual([]);
    expect(ctx.samplingRecords).toEqual([]);
    expect(ctx.monthlySeries).toEqual({});
    expect(ctx.gridFactorVintageUsed).toBe("FY2024-25");

    const rules = runRules(ctx);
    expect(rules.findings.some((f) => f.ruleId === "MB001")).toBe(false);
    expect(rules.findings.some((f) => f.ruleId === "TS001")).toBe(false);
    expect(rules.findings.some((f) => f.ruleId === "SM001")).toBe(false);
    expect(rules.findings.some((f) => f.ruleId === "EF001")).toBe(true);
  });

  it("reads a lab certificate from this engagement's facts", () => {
    const facts = seedFacts();
    const run = executeRun({
      engagementId: "eng-rjk-cem-fy2526",
      organizationId: "org-demo",
      packId: "CCTS-CEMENT-v1",
      packVersion: "1.0.0",
      complianceYear: "FY2025-26",
      draftMode: true,
      facts,
    });
    const ctx = reconciliationContextFromFacts({
      complianceYear: "FY2025-26",
      calc: run.result,
      facts,
    });
    expect(ctx.labCertificates).toHaveLength(1);
    expect(ctx.labCertificates[0]?.testDate).toBe("2025-08-15");
    expect(ctx.labCertificates[0]?.nablAccreditationNo).toBeUndefined();
    expect(runRules(ctx).findings.some((f) => f.ruleId === "LB001")).toBe(true);
  });

  it("records a monthly point only when a document carries a period date", () => {
    const facts = seedFacts();
    facts.push({
      id: "fact-elec-period",
      field_path: "billingPeriodStart",
      value_json: "2025-10-01",
      unit: null,
      document_id: "doc-elec",
      page: 1,
      bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.04 },
      source_text: "01-10-2025 to 31-10-2025",
    });
    const run = executeRun({
      engagementId: "eng-rjk-cem-fy2526",
      organizationId: "org-demo",
      packId: "CCTS-CEMENT-v1",
      packVersion: "1.0.0",
      complianceYear: "FY2025-26",
      draftMode: true,
      facts,
    });
    const ctx = reconciliationContextFromFacts({
      complianceYear: "FY2025-26",
      calc: run.result,
      facts,
    });
    expect(ctx.monthlySeries["grid-ht"]?.map((p) => p.month)).toEqual(["2025-10"]);
    expect(runRules(ctx).findings.some((f) => f.ruleId === "TS001")).toBe(true);
  });
});

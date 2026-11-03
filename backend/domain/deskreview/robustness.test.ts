import { describe, expect, it } from "vitest";
import { dailyColumn, isoDate, headerMatches } from "./engine";
import type { XlsxSheet } from "../intake/xlsx";
import { calorificPlausibilityRule, nablValidityRule, seriesCompletenessRule, cumulativeMaterialityRule } from "../rules/rules";
import { qty } from "../units";
import { calculate, type CalcInput } from "../calc/engine";
import { buildFactorSet, CCTS_MATERIALITY_PCT } from "../factors";
import type { ReconciliationContext } from "../rules/types";

describe("Robustness: Date parsing (isoDate)", () => {
  it("parses ISO YYYY-MM-DD", () => {
    expect(isoDate("2024-04-01")).toBe("2024-04-01");
    expect(isoDate("2023-11-30")).toBe("2023-11-30");
  });

  it("parses Indian format DD/MM/YYYY and DD-MM-YYYY", () => {
    expect(isoDate("01/04/2024")).toBe("2024-04-01");
    expect(isoDate("15-11-2023")).toBe("2023-11-15");
    expect(isoDate("5/6/2025")).toBe("2025-06-05");
  });

  it("parses DD-MMM-YYYY (e.g. 01-Nov-2023, 15-Apr-2024)", () => {
    expect(isoDate("01-Nov-2023")).toBe("2023-11-01");
    expect(isoDate("15-Apr-2024")).toBe("2024-04-15");
    expect(isoDate("25-DEC-23")).toBe("2023-12-25");
  });

  it("parses Excel serial date numbers", () => {
    // 45231 = 2023-11-01
    expect(isoDate(45231)).toBe("2023-11-01");
  });

  it("returns null for non-date values", () => {
    expect(isoDate("RUN")).toBeNull();
    expect(isoDate("DOWN")).toBeNull();
    expect(isoDate("Total")).toBeNull();
    expect(isoDate(null)).toBeNull();
    expect(isoDate(100)).toBeNull();
  });
});

describe("Robustness: Header matching (headerMatches)", () => {
  it("matches exact headers case-insensitively", () => {
    expect(headerMatches("Clinker Production (t)", "Clinker Production (t)")).toBe(true);
    expect(headerMatches("clinker production (t)", "Clinker Production (t)")).toBe(true);
  });

  it("matches headers with variations in units and punctuation", () => {
    expect(headerMatches("Clinker Production", "Clinker Production (t)")).toBe(true);
    expect(headerMatches("Clinker Production (MT)", "Clinker Production (t)")).toBe(true);
    expect(headerMatches("Gross Generation", "Gross Generation (kWh)")).toBe(true);
    expect(headerMatches("Petcoke Consumed", "Petcoke Consumed (t)")).toBe(true);
  });
});

describe("Robustness: Daily column parsing with arbitrary column positioning", () => {
  it("extracts data when Date is in Column B and Column A is S.No.", () => {
    const sheet: XlsxSheet = {
      name: "Daily SCADA",
      rowCount: 3,
      colCount: 4,
      truncated: false,
      cells: [
        // Header row (row 1)
        { ref: "A1", row: 1, col: 1, value: "S.No." },
        { ref: "B1", row: 1, col: 2, value: "Date" },
        { ref: "C1", row: 1, col: 3, value: "Clinker Production (MT)" },
        { ref: "D1", row: 1, col: 4, value: "Kiln Status" },
        // Data row 1
        { ref: "A2", row: 2, col: 1, value: 1 },
        { ref: "B2", row: 2, col: 2, value: "01/11/2023" },
        { ref: "C2", row: 2, col: 3, value: 450.5 },
        { ref: "D2", row: 2, col: 4, value: "RUN" },
        // Data row 2
        { ref: "A3", row: 3, col: 1, value: 2 },
        { ref: "B3", row: 3, col: 2, value: "02/11/2023" },
        { ref: "C3", row: 3, col: 3, value: 462.0 },
        { ref: "D3", row: 3, col: 4, value: "RUN" },
      ],
    };

    const col = dailyColumn(sheet, "Clinker Production (t)");
    expect(col).not.toBeNull();
    expect(col).toHaveLength(2);
    expect(col![0]).toEqual({ date: "2023-11-01", value: 450.5 });
    expect(col![1]).toEqual({ date: "2023-11-02", value: 462.0 });
  });
});

describe("Robustness: Real-world error scenarios & statutory guardrails", () => {
  const factors = buildFactorSet("test-factorset");
  const baseCalcInput: CalcInput = {
    engagementId: "eng-test",
    complianceYear: "FY2024-25",
    sector: "cement",
    allowUnverifiedFactors: true,
    streams: [
      {
        kind: "fuel_combustion",
        streamId: "coal-kiln",
        label: "Kiln coal",
        emissionFactorId: "ef_coal_subbituminous",
        emissionFactorVintage: "IPCC2006",
        quantity: qty(20_000, "t"),
        calorificValue: qty(4_200, "kcal/kg"),
        calorificBasis: "NCV",
        phase: "solid",
        provenance: { factIds: ["f1"] },
      },
    ],
    production: {
      quantity: qty(100_000, "t"),
      productUnitLabel: "tonne_equivalent_product",
      provenance: { factIds: ["f-prod"] },
    },
  };

  const calcResult = calculate(baseCalcInput, factors);

  function createCtx(overrides: Partial<ReconciliationContext> = {}): ReconciliationContext {
    return {
      complianceYear: "FY2024-25",
      expectedMonths: [
        "2024-04", "2024-05", "2024-06", "2024-07", "2024-08", "2024-09",
        "2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03",
      ],
      calc: calcResult,
      monthlySeries: {},
      stockMovements: [],
      labCertificates: [],
      samplingRecords: [],
      ...overrides,
    };
  }

  it("catches incomplete data when months are missing (TS001)", () => {
    const ctx = createCtx({
      monthlySeries: {
        "coal-kiln": [
          { month: "2024-04", quantity: qty(1000, "t"), factIds: ["f1"] },
          { month: "2024-05", quantity: qty(1000, "t"), factIds: ["f2"] },
          // Missing months June to March
        ],
      },
    });
    const findings = seriesCompletenessRule.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("block");
    expect(findings[0]!.detail).toContain("10 month(s)");
  });

  it("blocks expired NABL lab accreditation (LB001)", () => {
    const ctx = createCtx({
      labCertificates: [
        {
          certificateId: "CERT-999",
          labName: "GeoChem NABL Lab",
          nablAccreditationNo: "TC-8899",
          nablValidUntil: "2024-05-31",
          testDate: "2024-09-15", // After expiration
          fuelKey: "coal_subbituminous",
          calorificValue: qty(4200, "kcal/kg"),
          calorificBasis: "NCV",
          factIds: ["f-cert"],
        },
      ],
    });
    const findings = nablValidityRule.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("block");
    expect(findings[0]!.detail).toMatch(/expired/);
  });

  it("blocks unit confusion (e.g. kcal/kg recorded as MJ/kg) (CV002)", () => {
    const ctx = createCtx({
      labCertificates: [
        {
          certificateId: "CERT-001",
          labName: "Valid Lab",
          nablAccreditationNo: "TC-1234",
          nablValidUntil: "2026-12-31",
          testDate: "2024-06-15",
          fuelKey: "coal_indian",
          calorificValue: qty(4200, "MJ/kg"), // Implausibly high: should be kcal/kg
          calorificBasis: "NCV",
          factIds: ["f-cv"],
        },
      ],
    });
    const findings = calorificPlausibilityRule.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("block");
    expect(findings[0]!.detail).toContain("unit error");
  });

  it("enforces CCTS 2% statutory materiality threshold (MT001)", () => {
    // 3% mass discrepancy against 2% CCTS threshold
    const ctx = createCtx({
      materialityPct: CCTS_MATERIALITY_PCT, // 2%
      stockMovements: [
        {
          streamId: "coal-kiln",
          openingStock: qty(10_000, "t"),
          purchases: qty(20_000, "t"),
          closingStock: qty(10_000, "t"),
          reportedConsumption: qty(19_400, "t"), // 600 t discrepancy = 3% of 20,000 t
          factIds: ["f-stock"],
        },
      ],
    });
    const findings = cumulativeMaterialityRule.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("block");
    expect(findings[0]!.detail).toContain("3.09%");
    expect(findings[0]!.detail).toContain("materiality threshold of 2%");
  });
});

import { describe, expect, it } from "vitest";
import { buildFactorSet } from "../factors";
import { qty } from "../units";
import { calculate, type CalcInput } from "../calc/engine";
import { runRules } from "./rules";
import type { ReconciliationContext } from "./types";

const factors = buildFactorSet("test-factorset-1");

const FY_MONTHS = [
  "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09",
  "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
];

const calcInput: CalcInput = {
  engagementId: "eng-001",
  complianceYear: "FY2025-26",
  sector: "cement",
  allowUnverifiedFactors: true,
  streams: [
    {
      kind: "fuel_combustion",
      streamId: "coal-1",
      label: "Coal",
      emissionFactorId: "ef_coal_subbituminous",
      emissionFactorVintage: "IPCC2006",
      quantity: qty(1000, "t"),
      calorificValue: qty(20, "MJ/kg"),
      calorificBasis: "NCV",
      phase: "solid",
      provenance: { factIds: ["f1"] },
    },
  ],
  production: {
    quantity: qty(10_000, "t"),
    productUnitLabel: "tonne_cement",
    provenance: { factIds: ["f-prod"] },
  },
};

function ctx(overrides: Partial<ReconciliationContext> = {}): ReconciliationContext {
  return {
    complianceYear: "FY2025-26",
    expectedMonths: FY_MONTHS,
    calc: calculate(calcInput, factors),
    monthlySeries: {},
    stockMovements: [],
    labCertificates: [],
    samplingRecords: [],
    ...overrides,
  };
}

describe("MB001 stock balance", () => {
  it("passes when movement reconciles", () => {
    const r = runRules(
      ctx({
        stockMovements: [
          {
            streamId: "coal-1",
            openingStock: qty(500, "t"),
            purchases: qty(1000, "t"),
            closingStock: qty(500, "t"),
            reportedConsumption: qty(1000, "t"),
            factIds: ["f-stock"],
          },
        ],
      })
    );
    expect(r.findings.filter((f) => f.ruleId === "MB001")).toHaveLength(0);
  });

  it("flags a material shortfall between implied and reported consumption", () => {
    const r = runRules(
      ctx({
        stockMovements: [
          {
            streamId: "coal-1",
            openingStock: qty(500, "t"),
            purchases: qty(1000, "t"),
            closingStock: qty(500, "t"),
            reportedConsumption: qty(900, "t"),
            factIds: ["f-stock"],
          },
        ],
      })
    );
    const f = r.findings.find((x) => x.ruleId === "MB001");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("block");
    expect(f!.magnitude?.value).toBeCloseTo(-100_000, 0);
  });
});

describe("CV002 calorific plausibility", () => {
  it("catches a kcal/kg value mistakenly recorded as MJ/kg", () => {
    const r = runRules(
      ctx({
        labCertificates: [
          {
            certificateId: "LAB-001",
            labName: "Test Lab",
            nablAccreditationNo: "TC-1234",
            nablValidUntil: "2027-01-01",
            testDate: "2025-06-01",
            fuelKey: "coal_indian",
            calorificValue: qty(4200, "MJ/kg"), // should have been kcal/kg
            calorificBasis: "NCV",
            factIds: ["f-lab"],
          },
        ],
      })
    );
    const f = r.findings.find((x) => x.ruleId === "CV002");
    expect(f?.severity).toBe("block");
    expect(f?.detail).toMatch(/unit error/i);
  });

  it("accepts a correctly expressed Indian coal NCV", () => {
    const r = runRules(
      ctx({
        labCertificates: [
          {
            certificateId: "LAB-002",
            labName: "Test Lab",
            nablAccreditationNo: "TC-1234",
            nablValidUntil: "2027-01-01",
            testDate: "2025-06-01",
            fuelKey: "coal_indian",
            calorificValue: qty(4200, "kcal/kg"),
            calorificBasis: "NCV",
            factIds: ["f-lab"],
          },
        ],
      })
    );
    expect(r.findings.filter((f) => f.ruleId === "CV002")).toHaveLength(0);
  });
});

describe("LB001 NABL validity", () => {
  it("flags a test performed after accreditation lapsed", () => {
    const r = runRules(
      ctx({
        labCertificates: [
          {
            certificateId: "LAB-003",
            labName: "Test Lab",
            nablAccreditationNo: "TC-9999",
            nablValidUntil: "2025-05-31",
            testDate: "2025-08-15",
            fuelKey: "coal_indian",
            calorificValue: qty(4200, "kcal/kg"),
            calorificBasis: "NCV",
            factIds: ["f-lab"],
          },
        ],
      })
    );
    const f = r.findings.find((x) => x.ruleId === "LB001");
    expect(f?.severity).toBe("block");
    expect(f?.detail).toMatch(/expired/);
  });

  it("flags a missing accreditation number", () => {
    const r = runRules(
      ctx({
        labCertificates: [
          {
            certificateId: "LAB-004",
            labName: "Unaccredited Lab",
            testDate: "2025-08-15",
            fuelKey: "coal_indian",
            calorificValue: qty(4200, "kcal/kg"),
            calorificBasis: "NCV",
            factIds: ["f-lab"],
          },
        ],
      })
    );
    expect(r.findings.some((f) => f.ruleId === "LB001")).toBe(true);
  });
});

describe("TS001 series completeness", () => {
  it("flags missing months", () => {
    const r = runRules(
      ctx({
        monthlySeries: {
          "coal-1": FY_MONTHS.slice(0, 10).map((month) => ({
            month,
            quantity: qty(100, "t"),
            factIds: [`f-${month}`],
          })),
        },
      })
    );
    const f = r.findings.find((x) => x.ruleId === "TS001");
    expect(f?.magnitude?.value).toBe(2);
    expect(f?.detail).toMatch(/2026-02/);
  });
});

describe("EF001 grid factor vintage", () => {
  it("flags a mismatched vintage", () => {
    const r = runRules(ctx({ gridFactorVintageUsed: "FY2023-24" }));
    expect(r.findings.some((f) => f.ruleId === "EF001")).toBe(true);
  });

  it("stays quiet when the vintage matches", () => {
    const r = runRules(ctx({ gridFactorVintageUsed: "FY2025-26" }));
    expect(r.findings.some((f) => f.ruleId === "EF001")).toBe(false);
  });
});

describe("SM001 sampling frequency", () => {
  it("flags under-sampling against throughput", () => {
    const r = runRules(
      ctx({
        samplingRecords: [
          {
            materialKind: "coal",
            month: "2025-06",
            samplesTaken: 1,
            throughput: qty(65_000, "t"), // needs ceil(65000/20000) = 4
            factIds: ["f-sample"],
          },
        ],
      })
    );
    const f = r.findings.find((x) => x.ruleId === "SM001");
    expect(f?.magnitude?.value).toBe(3);
  });

  it("accepts compliant sampling", () => {
    const r = runRules(
      ctx({
        samplingRecords: [
          {
            materialKind: "coal",
            month: "2025-06",
            samplesTaken: 4,
            throughput: qty(65_000, "t"),
            factIds: ["f-sample"],
          },
        ],
      })
    );
    expect(r.findings.some((f) => f.ruleId === "SM001")).toBe(false);
  });
});

describe("runRules summary", () => {
  it("counts blocks and warns and lists evaluated rules", () => {
    const r = runRules(ctx());
    expect(r.rulesEvaluated).toContain("MB001");
    expect(r.blocks).toBe(0);
    expect(r.warns).toBe(0);
  });
});

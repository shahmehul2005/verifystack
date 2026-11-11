import { describe, it, expect } from "vitest";
import {
  getFiscalMonths,
  matchDateToMonthKey,
  getStreamDefinition,
  normalizeStreamValue,
  computeCellVariance,
  computeAnnualRollup,
  type CalendarReading,
  type MonthCell,
} from "./index";

describe("Calendar Domain - Months & Streams", () => {
  it("generates exactly 12 fiscal months for FY2023-24 starting with April 2023 and ending March 2024", () => {
    const months = getFiscalMonths("FY2023-24");
    expect(months).toHaveLength(12);
    expect(months[0].key).toBe("2023-04");
    expect(months[0].label).toBe("Apr 2023");
    expect(months[0].startDate).toBe("2023-04-01");
    expect(months[0].endDate).toBe("2023-04-30");

    expect(months[8].key).toBe("2023-12");
    expect(months[8].label).toBe("Dec 2023");

    expect(months[9].key).toBe("2024-01");
    expect(months[9].label).toBe("Jan 2024");

    expect(months[11].key).toBe("2024-03");
    expect(months[11].label).toBe("Mar 2024");
    expect(months[11].endDate).toBe("2024-03-31");
  });

  it("matches date strings to correct month keys", () => {
    expect(matchDateToMonthKey("2023-08-15")).toBe("2023-08");
    expect(matchDateToMonthKey("2024/02/01")).toBe("2024-02");
  });

  it("finds stream definitions for key Cement streams from PAT-2 Proforma", () => {
    const clinker = getStreamDefinition("clinker_production");
    expect(clinker).toBeDefined();
    expect(clinker?.category).toBe("production");
    expect(clinker?.standardUnit).toBe("t");
    expect(clinker?.calcBindingPath).toBe("clinker.production");

    const coal = getStreamDefinition("coal_quantity");
    expect(coal).toBeDefined();
    expect(coal?.category).toBe("solid_fuel");
    expect(coal?.calcBindingPath).toBe("quantity");

    const gcv = getStreamDefinition("coal_gcv");
    expect(gcv).toBeDefined();
    expect(gcv?.aggregation).toBe("weighted_mean");
    expect(gcv?.weightStreamKey).toBe("coal_quantity");

    const grid = getStreamDefinition("grid_electricity");
    expect(grid).toBeDefined();
    expect(grid?.category).toBe("electricity");
    expect(grid?.standardUnit).toBe("kWh");
  });

  it("normalizes units deterministically", () => {
    // Lakh kWh -> kWh
    expect(normalizeStreamValue(15, "Lakh kWh", "kWh")).toBe(1500000);
    // kg -> t
    expect(normalizeStreamValue(5000, "kg", "t")).toBe(5);
    // MJ/kg -> kcal/kg (1 MJ/kg ~ 239.0057 kcal/kg)
    const kcal = normalizeStreamValue(17.5, "MJ/kg", "kcal/kg");
    expect(Math.round(kcal)).toBe(4183);
  });
});

describe("Calendar Domain - Rollup & Variance Calculation", () => {
  const dummyReading = (standardValue: number, sourceType: "sourcing" | "corroboration" | "proforma"): CalendarReading => ({
    id: "r1",
    engagementId: "eng-1",
    streamKey: "coal_quantity",
    monthKey: "2023-04",
    startDate: "2023-04-01",
    endDate: "2023-04-30",
    sourceType,
    valueNumeric: standardValue,
    unit: "t",
    standardValue,
    standardUnit: "t",
    state: "accepted",
  });

  it("computes cell variance between sourcing and corroboration", () => {
    const sourcing = dummyReading(21500, "sourcing");
    const corroboration = dummyReading(21480, "corroboration");

    const variance = computeCellVariance({ sourcing, corroboration });
    expect(variance.variancePercent).toBeDefined();
    expect(variance.variancePercent).toBeLessThan(1); // < 1% difference
    expect(variance.hasVarianceAlert).toBe(false);

    // Large discrepancy > 5% triggers alert
    const badCorroboration = dummyReading(25000, "corroboration");
    const alertVariance = computeCellVariance({ sourcing, corroboration: badCorroboration });
    expect(alertVariance.variancePercent).toBeGreaterThan(5);
    expect(alertVariance.hasVarianceAlert).toBe(true);
  });

  it("sums monthly additive streams (e.g. coal quantity) into verified annual rollup", () => {
    const coalStream = getStreamDefinition("coal_quantity")!;
    const months = getFiscalMonths("FY2023-24");

    const cells: MonthCell[] = months.map((m) => ({
      monthKey: m.key,
      label: m.label,
      startDate: m.startDate,
      endDate: m.endDate,
      sourcing: {
        ...dummyReading(20000, "sourcing"),
        monthKey: m.key,
      },
      isComplete: true,
    }));

    const proformaAnnual = dummyReading(240000, "proforma");
    const rollup = computeAnnualRollup(coalStream, cells, proformaAnnual);

    expect(rollup.value).toBe(240000); // 12 * 20000
    expect(rollup.completedMonthsCount).toBe(12);
    expect(rollup.isComplete).toBe(true);
    expect(rollup.varianceToProformaPercent).toBe(0);
  });

  it("computes weighted mean for GCV based on monthly quantities", () => {
    const gcvStream = getStreamDefinition("coal_gcv")!;

    // Month 1: 10,000 t at 4000 kcal/kg
    // Month 2: 30,000 t at 4400 kcal/kg
    // Expected weighted average: (10000*4000 + 30000*4400) / 40000 = (40M + 132M)/40k = 172M/40k = 4300 kcal/kg
    const weights = new Map<string, number>([
      ["2023-04", 10000],
      ["2023-05", 30000],
    ]);

    const cells: MonthCell[] = [
      {
        monthKey: "2023-04",
        label: "Apr 2023",
        startDate: "2023-04-01",
        endDate: "2023-04-30",
        sourcing: { ...dummyReading(4000, "sourcing"), monthKey: "2023-04" },
        isComplete: true,
      },
      {
        monthKey: "2023-05",
        label: "May 2023",
        startDate: "2023-05-01",
        endDate: "2023-05-31",
        sourcing: { ...dummyReading(4400, "sourcing"), monthKey: "2023-05" },
        isComplete: true,
      },
    ];

    const rollup = computeAnnualRollup(gcvStream, cells, undefined, weights);
    expect(rollup.value).toBe(4300);
  });
});

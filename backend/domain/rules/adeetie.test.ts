import { describe, expect, it } from "vitest";
import { buildFactorSet } from "../factors";
import { qty } from "../units";
import { assessSavings, calculateSec, type SecInput } from "../calc/sec";
import {
  computeSubvention,
  isNotifiedCluster,
  LOAN_MAX_INR,
  LOAN_MIN_INR,
  NOTIFIED_CLUSTERS,
  EXPECTED_CLUSTER_COUNT,
  ADEETIE_SECTORS,
  CLUSTERS_VERIFIED,
} from "../packs/adeetie";
import {
  runAdeetieRules,
  ADEETIE_RULES,
  type AdeetieContext,
  type AdeetieEligibilityInput,
} from "./adeetie";

const factors = buildFactorSet("test-0.1.0");

function secResult(sec: number, phase: SecInput["phase"]) {
  const output = 1_000;
  return calculateSec(
    {
      engagementId: "eng-foundry",
      periodLabel: "FY2024-25",
      phase,
      reportingEnergyUnit: "GJ",
      secUnitLabel: "GJ/t",
      allowUnverifiedFactors: true,
      streams: [
        {
          kind: "thermal_direct",
          streamId: "total",
          label: "Total energy input",
          quantity: qty(sec * output, "GJ"),
          methodologyRef: "Test fixture",
          provenance: { factIds: ["f-total"] },
        },
      ],
      production: {
        quantity: qty(output, "t"),
        productUnitLabel: "tonne_good_castings",
        provenance: { factIds: ["f-prod"] },
      },
    },
    factors
  );
}

const FY_MONTHS = [
  "2024-04", "2024-05", "2024-06", "2024-07", "2024-08", "2024-09",
  "2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03",
];

function eligible(
  overrides: Partial<AdeetieEligibilityInput> = {}
): AdeetieEligibilityInput {
  return {
    enterpriseName: "Demo Castings Pvt Ltd",
    category: "Small",
    udyamRegistrationNo: "UDYAM-PB-05-1234567",
    sector: "Foundry",
    cluster: "Batala, Jalandhar & Ludhiana",
    loanAmountINR: 2_00_00_000,
    projectCostINR: 3_00_00_000,
    sanctionedRatePct: 10,
    factIds: ["f-udyam", "f-loan"],
    ...overrides,
  };
}

function ctx(overrides: Partial<AdeetieContext> = {}): AdeetieContext {
  return {
    baselinePeriodLabel: "FY2024-25",
    expectedMonths: FY_MONTHS,
    energyBalance: FY_MONTHS.map((month) => ({
      month,
      billedEnergyMJ: 100_000,
      meteredEnergyMJ: 100_000,
      factIds: [`f-${month}`],
    })),
    meterCalibrations: [],
    eligibility: eligible(),
    ...overrides,
  };
}

function ids(findings: { ruleId: string }[]) {
  return findings.map((f) => f.ruleId);
}

describe("ADEETIE cluster reference data", () => {
  it("holds 60 notified clusters across the 14 Phase 1 sectors", () => {
    expect(NOTIFIED_CLUSTERS).toHaveLength(EXPECTED_CLUSTER_COUNT);
    expect(new Set(NOTIFIED_CLUSTERS.map((c) => c.sector)).size).toBe(
      ADEETIE_SECTORS.length
    );
  });

  it("is flagged unverified until the official BEE list is read back", () => {
    expect(CLUSTERS_VERIFIED).toBe(false);
  });

  it("matches on the notified name and refuses a near miss", () => {
    expect(isNotifiedCluster("Foundry", "Howrah")).toBe(true);
    expect(isNotifiedCluster("Foundry", "  howrah ")).toBe(true);
    expect(isNotifiedCluster("Foundry", "Haora")).toBe(false);
    // The same town under a different sector is a different eligibility question.
    expect(isNotifiedCluster("Leather", "Howrah")).toBe(false);
  });
});

describe("ADEETIE eligibility rules", () => {
  it("raises nothing blocking for a clean application", () => {
    const r = runAdeetieRules(ctx());
    expect(r.blocks).toBe(0);
    expect(r.rulesEvaluated).toHaveLength(ADEETIE_RULES.length);
  });

  it("AD-ELG001 blocks when no Udyam number is held", () => {
    const r = runAdeetieRules(
      ctx({ eligibility: eligible({ udyamRegistrationNo: undefined }) })
    );
    const f = r.findings.filter((x) => x.ruleId === "AD-ELG001");
    expect(f[0]?.severity).toBe("block");
    expect(f[0]?.detail).toMatch(/Udyam/);
  });

  it("AD-ELG001 warns rather than blocks on a malformed Udyam number", () => {
    const r = runAdeetieRules(
      ctx({ eligibility: eligible({ udyamRegistrationNo: "UDYAM/PB/1234" }) })
    );
    const f = r.findings.filter((x) => x.ruleId === "AD-ELG001");
    expect(f[0]?.severity).toBe("warn");
    // The system must not imply it checked the registry.
    expect(f[0]?.detail).toMatch(/does not verify registrations/);
  });

  it("AD-ELG002 blocks a cluster that is not notified and claims no proximity", () => {
    const r = runAdeetieRules(
      ctx({ eligibility: eligible({ cluster: "Somewhere Else" }) })
    );
    const f = r.findings.filter((x) => x.ruleId === "AD-ELG002");
    expect(f[0]?.severity).toBe("block");
  });

  it("AD-ELG002 treats the 200 km provision as a reviewable exception, not a pass", () => {
    const r = runAdeetieRules(
      ctx({
        eligibility: eligible({
          cluster: "Somewhere Else",
          claimedDistanceToClusterKm: 150,
        }),
      })
    );
    const f = r.findings.filter((x) => x.ruleId === "AD-ELG002");
    expect(f[0]?.severity).toBe("warn");
    expect(f[0]?.detail).toMatch(/does not pass automatically/);
    expect(f[0]?.magnitude).toEqual({ value: 150, unit: "km" });
  });

  it("AD-ELG002 blocks beyond 200 km", () => {
    const r = runAdeetieRules(
      ctx({
        eligibility: eligible({
          cluster: "Somewhere Else",
          claimedDistanceToClusterKm: 250,
        }),
      })
    );
    expect(
      r.findings.find((x) => x.ruleId === "AD-ELG002")?.severity
    ).toBe("block");
  });

  it("AD-ELG002 notes that a matched cluster came from an unverified list", () => {
    const r = runAdeetieRules(ctx());
    const f = r.findings.filter((x) => x.ruleId === "AD-ELG002");
    expect(f[0]?.severity).toBe("info");
    expect(f[0]?.detail).toMatch(/unverified/);
  });

  it("AD-ELG002 blocks a sector outside ADEETIE Phase 1", () => {
    const r = runAdeetieRules(ctx({ eligibility: eligible({ sector: "Cement" }) }));
    const f = r.findings.filter((x) => x.ruleId === "AD-ELG002");
    expect(f[0]?.severity).toBe("block");
    expect(f[0]?.detail).toMatch(/14 sectors/);
  });

  it("AD-ELG003 enforces both ends of the loan window", () => {
    for (const loanAmountINR of [LOAN_MIN_INR - 1, LOAN_MAX_INR + 1]) {
      const r = runAdeetieRules(ctx({ eligibility: eligible({ loanAmountINR }) }));
      expect(
        r.findings.find((x) => x.ruleId === "AD-ELG003")?.severity
      ).toBe("block");
    }
    for (const loanAmountINR of [LOAN_MIN_INR, LOAN_MAX_INR]) {
      const r = runAdeetieRules(
        ctx({
          eligibility: eligible({
            loanAmountINR,
            projectCostINR: loanAmountINR * 2,
          }),
        })
      );
      expect(ids(r.findings)).not.toContain("AD-ELG003");
    }
  });

  it("AD-ELG004 blocks debt funding above 75% of project cost", () => {
    const r = runAdeetieRules(
      ctx({
        eligibility: eligible({
          loanAmountINR: 8_00_00_000,
          projectCostINR: 10_00_00_000,
        }),
      })
    );
    const f = r.findings.filter((x) => x.ruleId === "AD-ELG004");
    expect(f[0]?.severity).toBe("block");
    expect(f[0]?.magnitude?.value).toBe(80);
  });

  it("AD-ELG004 permits exactly 75%", () => {
    const r = runAdeetieRules(
      ctx({
        eligibility: eligible({
          loanAmountINR: 7_50_00_000,
          projectCostINR: 10_00_00_000,
        }),
      })
    );
    expect(ids(r.findings)).not.toContain("AD-ELG004");
  });

  it("AD-ELG005 blocks a subvention claim above the category entitlement", () => {
    const r = runAdeetieRules(
      ctx({
        eligibility: eligible({ category: "Medium", claimedSubventionPct: 5 }),
      })
    );
    const f = r.findings.filter((x) => x.ruleId === "AD-ELG005");
    expect(f[0]?.severity).toBe("block");
    expect(f[0]?.detail).toMatch(/entitled to 3%/);
  });

  it("AD-ELG005 warns when the net borrowing rate floor caps the subvention", () => {
    const r = runAdeetieRules(
      ctx({ eligibility: eligible({ category: "Micro", sanctionedRatePct: 5 }) })
    );
    const f = r.findings.filter((x) => x.ruleId === "AD-ELG005");
    expect(f[0]?.severity).toBe("warn");
    expect(f[0]?.detail).toMatch(/not the headline 5%/);
  });
});

describe("interest subvention computation", () => {
  it("applies the headline rate when there is headroom above the 2% floor", () => {
    const r = computeSubvention({
      category: "Small",
      sanctionedRatePct: 11,
      principalINR: 1_00_00_000,
    });
    expect(r.appliedSubventionPct).toBe(5);
    expect(r.netBorrowingRatePct).toBe(6);
    expect(r.annualReliefINR).toBe(5_00_000);
    expect(r.cappedByNetRateFloor).toBe(false);
  });

  it("caps the subvention at the 2% minimum net borrowing rate", () => {
    const r = computeSubvention({
      category: "Micro",
      sanctionedRatePct: 5,
      principalINR: 1_00_00_000,
    });
    expect(r.appliedSubventionPct).toBe(3);
    expect(r.netBorrowingRatePct).toBe(2);
    expect(r.cappedByNetRateFloor).toBe(true);
  });

  it("pays nothing when the sanctioned rate is already at the floor", () => {
    const r = computeSubvention({
      category: "Medium",
      sanctionedRatePct: 2,
      principalINR: 1_00_00_000,
    });
    expect(r.appliedSubventionPct).toBe(0);
    expect(r.annualReliefINR).toBe(0);
  });
});

describe("ADEETIE baseline data quality rules", () => {
  it("AD-TS001 blocks an incomplete baseline year", () => {
    const c = ctx();
    c.energyBalance = c.energyBalance.slice(0, 10);
    const r = runAdeetieRules(c);
    const f = r.findings.filter((x) => x.ruleId === "AD-TS001");
    expect(f[0]?.severity).toBe("block");
    expect(f[0]?.magnitude).toEqual({ value: 2, unit: "months" });
  });

  it("AD-EB001 flags an energy balance that does not close", () => {
    const c = ctx();
    c.energyBalance = c.energyBalance.map((m) => ({ ...m, meteredEnergyMJ: 80_000 }));
    const r = runAdeetieRules(c);
    const f = r.findings.filter((x) => x.ruleId === "AD-EB001");
    expect(f[0]?.severity).toBe("block");
    expect(f[0]?.magnitude?.value).toBeCloseTo(-20, 3);
  });

  it("AD-EB001 warns when nothing was metered at all", () => {
    const c = ctx();
    c.energyBalance = c.energyBalance.map(({ month, billedEnergyMJ, factIds }) => ({
      month,
      billedEnergyMJ,
      factIds,
    }));
    const r = runAdeetieRules(c);
    const f = r.findings.filter((x) => x.ruleId === "AD-EB001");
    expect(f[0]?.severity).toBe("warn");
    expect(f[0]?.detail).toMatch(/no month carries a metered figure/);
  });

  it("AD-CAL001 blocks readings relied on past the calibration expiry", () => {
    const r = runAdeetieRules(
      ctx({
        meterCalibrations: [
          {
            meterId: "EM-01",
            description: "Main incomer energy meter",
            calibratedOn: "2023-04-01",
            validUntil: "2024-09-30",
            reliedOnFrom: "2024-04-01",
            reliedOnTo: "2025-03-31",
            factIds: ["f-cal"],
          },
        ],
      })
    );
    const f = r.findings.filter((x) => x.ruleId === "AD-CAL001");
    expect(f[0]?.severity).toBe("block");
  });

  it("AD-CAL001 blocks a meter with no calibration record at all", () => {
    const r = runAdeetieRules(
      ctx({
        meterCalibrations: [
          {
            meterId: "EM-02",
            description: "Furnace sub-meter",
            reliedOnFrom: "2024-04-01",
            reliedOnTo: "2025-03-31",
            factIds: ["f-cal2"],
          },
        ],
      })
    );
    expect(
      runAdeetieRules(ctx()).findings.filter((x) => x.ruleId === "AD-CAL001")
    ).toHaveLength(0);
    expect(r.findings.find((x) => x.ruleId === "AD-CAL001")?.severity).toBe("block");
  });

  it("AD-SEC001 is skipped when no plausible band is declared", () => {
    const r = runAdeetieRules(ctx({ baselineSec: secResult(1_000, "baseline") }));
    expect(ids(r.findings)).not.toContain("AD-SEC001");
  });

  it("AD-SEC001 blocks an implausible SEC when a band is declared", () => {
    const r = runAdeetieRules(
      ctx({
        baselineSec: secResult(1_000, "baseline"),
        secPlausibleRange: { min: 5, max: 40 },
      })
    );
    const f = r.findings.filter((x) => x.ruleId === "AD-SEC001");
    expect(f[0]?.severity).toBe("block");
    expect(f[0]?.detail).toMatch(/unit/);
  });
});

describe("AD-SAV001 the 10% savings gate", () => {
  const baseline = secResult(20, "baseline");

  it("stays silent when savings clear the threshold", () => {
    const post = secResult(17, "post_implementation");
    const r = runAdeetieRules(
      ctx({ baselineSec: baseline, postSec: post, savings: assessSavings(baseline, post) })
    );
    expect(ids(r.findings)).not.toContain("AD-SAV001");
  });

  it("blocks just below the threshold and states the measured percentage", () => {
    const post = secResult(18.1, "post_implementation");
    const savings = assessSavings(baseline, post);
    const r = runAdeetieRules({
      ...ctx(),
      baselineSec: baseline,
      postSec: post,
      savings,
    });
    const f = r.findings.filter((x) => x.ruleId === "AD-SAV001");
    expect(f[0]?.severity).toBe("block");
    expect(f[0]?.detail).toMatch(/9\.50%/);
    expect(f[0]?.detail).toMatch(/achieved and sustained/);
    expect(f[0]?.magnitude?.unit).toBe("%");
  });

  it("blocks a saving that clears the arithmetic but is not comparable", () => {
    const post = calculateSec(
      {
        engagementId: "eng-foundry",
        periodLabel: "FY2026-27",
        phase: "post_implementation",
        reportingEnergyUnit: "GJ",
        secUnitLabel: "GJ/t",
        allowUnverifiedFactors: true,
        streams: [
          {
            kind: "thermal_direct",
            streamId: "different-boundary",
            label: "Total energy input",
            quantity: qty(10_000, "GJ"),
            methodologyRef: "Test fixture",
            provenance: { factIds: ["f-total"] },
          },
        ],
        production: {
          quantity: qty(1_000, "t"),
          productUnitLabel: "tonne_liquid_metal",
          provenance: { factIds: ["f-prod"] },
        },
      },
      factors
    );
    const savings = assessSavings(baseline, post);
    expect(savings.meetsThreshold).toBe(true);

    const r = runAdeetieRules({
      ...ctx(),
      baselineSec: baseline,
      postSec: post,
      savings,
    });
    const f = r.findings.filter((x) => x.ruleId === "AD-SAV001");
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.severity === "block")).toBe(true);
    expect(f[0]?.title).toMatch(/not comparable/);
  });

  it("is skipped entirely when no M&V comparison exists yet", () => {
    const r = runAdeetieRules(ctx({ baselineSec: baseline }));
    expect(ids(r.findings)).not.toContain("AD-SAV001");
  });
});

describe("every ADEETIE rule cites a clause", () => {
  it("carries a clauseRef on the rule and on every finding it emits", () => {
    for (const rule of ADEETIE_RULES) {
      expect(rule.clauseRef.length).toBeGreaterThan(10);
    }
    const r = runAdeetieRules(
      ctx({ eligibility: eligible({ cluster: "Nowhere", udyamRegistrationNo: undefined }) })
    );
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) {
      expect(f.clauseRef.length).toBeGreaterThan(10);
    }
  });
});

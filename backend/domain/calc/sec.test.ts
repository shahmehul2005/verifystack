import { describe, expect, it } from "vitest";
import { buildFactorSet, applyVerifications } from "../factors";
import { qty } from "../units";
import {
  ADEETIE_MIN_SAVINGS_PCT,
  assessSavings,
  calculateSec,
  hashSecInputs,
  SEC_ENGINE_VERSION,
  SecError,
  type SecInput,
} from "./sec";

const factors = buildFactorSet("test-0.1.0");

function baseInput(overrides: Partial<SecInput> = {}): SecInput {
  return {
    engagementId: "eng-foundry-demo",
    periodLabel: "FY2024-25",
    phase: "baseline",
    reportingEnergyUnit: "GJ",
    secUnitLabel: "GJ/t",
    allowUnverifiedFactors: true,
    streams: [
      {
        kind: "electricity",
        streamId: "grid-electricity",
        label: "Purchased electricity",
        quantity: qty(1_200_000, "kWh"),
        provenance: { factIds: ["f-elec"] },
      },
      {
        kind: "fuel_mass",
        streamId: "coke",
        label: "Hard coke",
        quantity: qty(400, "t"),
        energyContent: qty(6_500, "kcal/kg"),
        energyContentBasis: "GCV",
        phase: "solid",
        provenance: { factIds: ["f-coke"] },
      },
    ],
    production: {
      quantity: qty(2_000, "t"),
      productUnitLabel: "tonne_good_castings",
      provenance: { factIds: ["f-prod"] },
    },
    ...overrides,
  };
}

describe("SEC engine determinism", () => {
  it("produces identical results for identical inputs", () => {
    const a = calculateSec(baseInput(), factors);
    const b = calculateSec(baseInput(), factors);
    expect(a).toEqual(b);
    expect(a.inputsHash).toBe(b.inputsHash);
    expect(a.inputsHash).toHaveLength(64);
    expect(a.secEngineVersion).toBe(SEC_ENGINE_VERSION);
  });

  it("hashes independently of object construction order", () => {
    const ordered = baseInput();
    const reordered: SecInput = {
      production: ordered.production,
      streams: ordered.streams,
      secUnitLabel: ordered.secUnitLabel,
      reportingEnergyUnit: ordered.reportingEnergyUnit,
      phase: ordered.phase,
      periodLabel: ordered.periodLabel,
      engagementId: ordered.engagementId,
      allowUnverifiedFactors: ordered.allowUnverifiedFactors,
    };
    expect(hashSecInputs(reordered)).toBe(hashSecInputs(ordered));
  });

  it("changes the hash when any input changes", () => {
    const a = hashSecInputs(baseInput());
    const b = hashSecInputs(
      baseInput({
        production: {
          quantity: qty(2_001, "t"),
          productUnitLabel: "tonne_good_castings",
          provenance: { factIds: ["f-prod"] },
        },
      })
    );
    expect(a).not.toBe(b);
  });

  it("divides normalised energy by output and records the derivations", () => {
    const r = calculateSec(baseInput(), factors);

    // 1,200,000 kWh = 4,320 GJ. 400 t coke at 6,500 kcal/kg GCV, x 0.95 to NCV.
    const cokeGJ = 400_000 * ((6_500 * 4.1868) / 1000) * 0.95 / 1000;
    const expectedTotalGJ = 4_320 + cokeGJ;

    expect(r.totalEnergy.unit).toBe("GJ");
    expect(r.totalEnergy.value).toBeCloseTo(expectedTotalGJ, 3);
    expect(r.sec).toBeCloseTo(expectedTotalGJ / 2_000, 5);
    expect(r.secUnitLabel).toBe("GJ/t");

    const shares = r.streams.reduce((a, s) => a + s.sharePct, 0);
    expect(shares).toBeCloseTo(100, 2);
    for (const s of r.streams) {
      expect(s.derivation.length).toBeGreaterThan(0);
    }
  });

  it("refuses a stream with no provenance", () => {
    expect(() =>
      calculateSec(
        baseInput({
          streams: [
            {
              kind: "electricity",
              streamId: "grid-electricity",
              label: "Purchased electricity",
              quantity: qty(1_000, "kWh"),
              provenance: { factIds: [] },
            },
          ],
        }),
        factors
      )
    ).toThrow(/provenance/i);
  });

  it("refuses duplicate stream ids and empty stream sets", () => {
    const s = baseInput().streams[0]!;
    expect(() => calculateSec(baseInput({ streams: [s, s] }), factors)).toThrow(
      /Duplicate streamId/
    );
    expect(() => calculateSec(baseInput({ streams: [] }), factors)).toThrow(
      /at least one energy stream/
    );
  });

  it("refuses a demand figure where a consumption is expected", () => {
    expect(() =>
      calculateSec(
        baseInput({
          streams: [
            {
              kind: "electricity",
              streamId: "grid-electricity",
              label: "Purchased electricity",
              // kVA is apparent power, not energy.
              quantity: qty(2_500, "kVA"),
              provenance: { factIds: ["f-elec"] },
            },
          ],
        }),
        factors
      )
    ).toThrow(SecError);
  });

  it("refuses a mass-basis calorific value against a volume activity", () => {
    expect(() =>
      calculateSec(
        baseInput({
          streams: [
            {
              kind: "fuel_volume",
              streamId: "diesel",
              label: "Diesel",
              quantity: qty(5_000, "L"),
              // Per-kg value against a per-litre activity.
              energyContent: qty(8_800, "kcal/kg"),
              energyContentBasis: "GCV",
              phase: "liquid",
              provenance: { factIds: ["f-diesel"] },
            },
          ],
        }),
        factors
      )
    ).toThrow(/energy_density/);
  });

  it("keeps kVA demand out of the energy total but still reports it", () => {
    const r = calculateSec(
      baseInput({
        demand: {
          contractedDemand: qty(2_500, "kVA"),
          maximumDemand: qty(2_100, "kVA"),
          provenance: { factIds: ["f-demand"] },
        },
      }),
      factors
    );
    const withoutDemand = calculateSec(baseInput(), factors);

    expect(r.demand?.contractedDemandKVA).toBe(2_500);
    expect(r.demand?.maximumDemandKVA).toBe(2_100);
    expect(r.demand?.demandUtilisationPct).toBe(84);
    // Demand did not touch the energy total.
    expect(r.totalEnergyMJ.value).toBe(withoutDemand.totalEnergyMJ.value);
  });

  it("handles volumetric fuels against a volumetric calorific value", () => {
    const r = calculateSec(
      baseInput({
        streams: [
          {
            kind: "fuel_volume",
            streamId: "png",
            label: "Piped natural gas",
            quantity: qty(100_000, "SCM"),
            energyContent: qty(8_500, "kcal/SCM"),
            energyContentBasis: "GCV",
            phase: "gaseous",
            provenance: { factIds: ["f-png"] },
          },
        ],
      }),
      factors
    );
    // 100,000 SCM x 35.5878 MJ/SCM x 0.9 gaseous GCV-to-NCV.
    expect(r.totalEnergyMJ.value).toBeCloseTo(100_000 * 35.5878 * 0.9, 0);
  });
});

describe("factor verification gate on SEC runs", () => {
  const registryDefaultInput = baseInput({
    allowUnverifiedFactors: false,
    streams: [
      {
        kind: "fuel_mass",
        streamId: "coke",
        label: "Hard coke",
        quantity: qty(400, "t"),
        energyFactorId: "ec_coke",
        energyFactorVintage: "TO-VERIFY",
        energyContentBasis: "GCV",
        phase: "solid",
        provenance: { factIds: ["f-coke"] },
      },
    ],
  });

  it("refuses an unverified registry factor outside draft mode", () => {
    expect(() => calculateSec(registryDefaultInput, factors)).toThrow(
      /not verified against its published source/
    );
  });

  it("allows it in draft mode but warns loudly", () => {
    const r = calculateSec(
      { ...registryDefaultInput, allowUnverifiedFactors: true },
      factors
    );
    expect(r.warnings.some((w) => w.includes("UNVERIFIED"))).toBe(true);
    expect(r.streams[0]?.factorsUsed[0]?.verified).toBe(false);
  });

  it("runs outside draft mode once a human has cited a source", () => {
    const verified = applyVerifications(
      factors,
      [
        {
          factorId: "ec_coke",
          vintage: "TO-VERIFY",
          citedSource:
            "BEE General Guidelines for Energy Audit, Table of energy conversion factors, page 14",
          correctedValue: 6_800,
          verifiedBy: "lead-verifier@example.org",
          verifiedAt: "2026-08-30T10:00:00.000Z",
        },
      ],
      "test-0.2.0"
    );
    const r = calculateSec(registryDefaultInput, verified);
    expect(r.factorSetVersion).toBe("test-0.2.0");
    expect(r.streams[0]?.factorsUsed[0]?.verified).toBe(true);
    expect(r.streams[0]?.factorsUsed[0]?.value).toBe(6_800);
    expect(r.warnings.some((w) => w.includes("UNVERIFIED"))).toBe(false);
  });

  it("refuses a verification with no real cited source", () => {
    for (const citedSource of ["", "IPCC", "IPCC 2006 — TO VERIFY"]) {
      expect(() =>
        applyVerifications(
          factors,
          [
            {
              factorId: "ec_coke",
              vintage: "TO-VERIFY",
              citedSource,
              verifiedBy: "someone",
              verifiedAt: "2026-08-30T10:00:00.000Z",
            },
          ],
          "test-0.3.0"
        )
      ).toThrow(/cited source|TO VERIFY marker/i);
    }
  });

  it("does not mutate the original factor set", () => {
    applyVerifications(
      factors,
      [
        {
          factorId: "ec_coke",
          vintage: "TO-VERIFY",
          citedSource: "BEE General Guidelines for Energy Audit, page 14",
          verifiedBy: "someone",
          verifiedAt: "2026-08-30T10:00:00.000Z",
        },
      ],
      "test-0.4.0"
    );
    expect(() => calculateSec(registryDefaultInput, factors)).toThrow(/not verified/);
  });
});

describe("the 10% savings gate", () => {
  function post(sec: number) {
    // Scale energy to land on a chosen SEC at fixed output.
    const output = 2_000;
    return calculateSec(
      baseInput({
        phase: "post_implementation",
        streams: [
          {
            kind: "thermal_direct",
            streamId: "grid-electricity",
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
      }),
      factors
    );
  }

  const baseline = calculateSec(
    baseInput({
      streams: [
        {
          kind: "thermal_direct",
          streamId: "grid-electricity",
          label: "Total energy input",
          quantity: qty(20_000, "GJ"),
          methodologyRef: "Test fixture",
          provenance: { factIds: ["f-total"] },
        },
      ],
    }),
    factors
  );

  it("uses 10% as the scheme minimum", () => {
    expect(ADEETIE_MIN_SAVINGS_PCT).toBe(10);
    expect(baseline.sec).toBe(10);
  });

  it("clears the gate at exactly 10%", () => {
    const s = assessSavings(baseline, post(9));
    expect(s.savingsPct).toBe(10);
    expect(s.meetsThreshold).toBe(true);
  });

  it("fails the gate just below 10%", () => {
    const s = assessSavings(baseline, post(9.01));
    expect(s.savingsPct).toBeCloseTo(9.9, 4);
    expect(s.meetsThreshold).toBe(false);
  });

  it("reports a negative saving when SEC worsened", () => {
    const s = assessSavings(baseline, post(11));
    expect(s.savingsPct).toBe(-10);
    expect(s.meetsThreshold).toBe(false);
  });

  it("quantifies the energy saved at post-implementation output", () => {
    const s = assessSavings(baseline, post(8));
    expect(s.savingsPct).toBe(20);
    // 2 GJ/t saved across 2,000 t.
    expect(s.energySavedAtPostOutput.value).toBeCloseTo(4_000, 3);
    expect(s.energySavedAtPostOutput.unit).toBe("GJ");
  });

  it("refuses to compare results from the wrong phases", () => {
    expect(() => assessSavings(post(9), post(8))).toThrow(/needs a baseline/);
    expect(() => assessSavings(baseline, baseline)).toThrow(
      /needs a post-implementation/
    );
  });

  it("flags a comparison that is not like-for-like instead of normalising it", () => {
    const other = calculateSec(
      baseInput({
        phase: "post_implementation",
        streams: [
          {
            kind: "thermal_direct",
            // Different stream id: the baseline stream disappeared.
            streamId: "different-boundary",
            label: "Total energy input",
            quantity: qty(16_000, "GJ"),
            methodologyRef: "Test fixture",
            provenance: { factIds: ["f-total"] },
          },
        ],
        production: {
          quantity: qty(2_000, "t"),
          // Different output basis.
          productUnitLabel: "tonne_liquid_metal",
          provenance: { factIds: ["f-prod"] },
        },
      }),
      factors
    );
    const s = assessSavings(baseline, other);
    expect(s.savingsPct).toBe(20);
    expect(s.meetsThreshold).toBe(true);
    // Clears the arithmetic gate, but is not a defensible saving.
    expect(s.comparabilityWarnings.length).toBeGreaterThanOrEqual(2);
    expect(s.comparabilityWarnings.join(" ")).toMatch(/tonne_liquid_metal/);
    expect(s.comparabilityWarnings.join(" ")).toMatch(/grid-electricity/);
  });

  it("carries both input hashes so the comparison is reproducible", () => {
    const s = assessSavings(baseline, post(8));
    expect(s.baselineInputHash).toBe(baseline.inputsHash);
    expect(s.postInputHash).toBe(post(8).inputsHash);
  });
});

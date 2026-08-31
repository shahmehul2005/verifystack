import { describe, expect, it } from "vitest";
import {
  AdeetieLifecycleError,
  allowedSecPhases,
  assertMeasureDraft,
  assertPhaseAdvanceReady,
  assertSecPhaseAllowed,
  documentFeedsSecPhase,
  filterFactsForSecPhase,
  phaseAdvanceBlockers,
  projectSavingsFromMeasures,
  secPhaseForAdeetiePhase,
  signoffsForPass,
} from "./lifecycle";

describe("ADEETIE pass → SEC phase", () => {
  it("locks baseline to IGEA/DPR and post-implementation to M&V", () => {
    expect(secPhaseForAdeetiePhase("IGEA")).toBe("baseline");
    expect(secPhaseForAdeetiePhase("DPR")).toBe("baseline");
    expect(secPhaseForAdeetiePhase("MV")).toBe("post_implementation");
    expect(allowedSecPhases("IGEA")).toEqual(["baseline"]);
    expect(allowedSecPhases("MV")).toEqual(["post_implementation"]);
    expect(() => assertSecPhaseAllowed("IGEA", "post_implementation")).toThrow(
      AdeetieLifecycleError
    );
    expect(() => assertSecPhaseAllowed("MV", "baseline")).toThrow(/locked at IGEA/);
  });

  it("lets untagged and IGEA documents feed the baseline, and only MV feed post", () => {
    expect(documentFeedsSecPhase(null, "baseline")).toBe(true);
    expect(documentFeedsSecPhase("IGEA", "baseline")).toBe(true);
    expect(documentFeedsSecPhase("DPR", "baseline")).toBe(false);
    expect(documentFeedsSecPhase("MV", "baseline")).toBe(false);
    expect(documentFeedsSecPhase("MV", "post_implementation")).toBe(true);
    expect(documentFeedsSecPhase("IGEA", "post_implementation")).toBe(false);
  });

  it("filters facts by the document's ADEETIE pass", () => {
    const facts = [
      { document_id: "igea-bill", field: "a" },
      { document_id: "mv-bill", field: "b" },
      { document_id: "legacy", field: "c" },
    ];
    const phases = new Map([
      ["igea-bill", "IGEA" as const],
      ["mv-bill", "MV" as const],
      ["legacy", null],
    ]);
    expect(filterFactsForSecPhase(facts, phases, "baseline").map((f) => f.document_id)).toEqual([
      "igea-bill",
      "legacy",
    ]);
    expect(filterFactsForSecPhase(facts, phases, "post_implementation").map((f) => f.document_id)).toEqual([
      "mv-bill",
    ]);
  });
});

describe("measures and projected savings", () => {
  it("refuses an empty description or a negative cost", () => {
    expect(() =>
      assertMeasureDraft({
        description: "x",
        projectedAnnualSaving: 10,
        savingUnit: "GJ",
        capitalCostINR: 1,
        basis: "quote",
      })
    ).toThrow(/description/);
    expect(() =>
      assertMeasureDraft({
        description: "Induction furnace replacement",
        projectedAnnualSaving: 10,
        savingUnit: "GJ",
        capitalCostINR: -1,
        basis: "vendor quote",
      })
    ).toThrow(/Capital cost/);
  });

  it("projects a percentage against baseline energy in the same unit", () => {
    const p = projectSavingsFromMeasures(
      { value: 1000, unit: "GJ" },
      [
        { projectedAnnualSaving: 80, savingUnit: "GJ" },
        { projectedAnnualSaving: 40, savingUnit: "GJ" },
      ],
      10
    );
    expect(p.projectedSaving).toBe(120);
    expect(p.projectedPostEnergy).toBe(880);
    expect(p.projectedSavingsPct).toBeCloseTo(12, 5);
    expect(p.meetsProjectedThreshold).toBe(true);
  });

  it("refuses a unit mismatch rather than converting silently", () => {
    expect(() =>
      projectSavingsFromMeasures({ value: 1000, unit: "GJ" }, [
        { projectedAnnualSaving: 10, savingUnit: "toe" },
      ])
    ).toThrow(/toe/);
  });
});

describe("phase advance gates", () => {
  const igeaSubmitted = { status: "submitted" as const, phase: "IGEA" as const };

  it("blocks IGEA → DPR without a baseline SEC", () => {
    const blockers = phaseAdvanceBlockers({
      position: igeaSubmitted,
      hasBaselineSec: false,
      openBlockCount: 0,
      measureCount: 0,
      loanAmountINR: null,
      projectCostINR: null,
      projected: null,
    });
    expect(blockers.join(" ")).toMatch(/baseline SEC/);
  });

  it("advances IGEA → DPR when the pass is submitted and a baseline exists", () => {
    const next = assertPhaseAdvanceReady({
      position: igeaSubmitted,
      hasBaselineSec: true,
      openBlockCount: 0,
      measureCount: 0,
      loanAmountINR: null,
      projectCostINR: null,
      projected: null,
    });
    expect(next).toEqual({ status: "setup", phase: "DPR" });
  });

  it("blocks DPR → M&V without measures, loan, and a projection that clears the floor", () => {
    const dpr = { status: "submitted" as const, phase: "DPR" as const };
    const blockers = phaseAdvanceBlockers({
      position: dpr,
      hasBaselineSec: true,
      openBlockCount: 0,
      measureCount: 0,
      loanAmountINR: null,
      projectCostINR: null,
      projected: null,
    });
    expect(blockers.join(" ")).toMatch(/measure/);
    expect(blockers.join(" ")).toMatch(/loan/);

    expect(() =>
      assertPhaseAdvanceReady({
        position: dpr,
        hasBaselineSec: true,
        openBlockCount: 0,
        measureCount: 1,
        loanAmountINR: 5_00_000,
        projectCostINR: 10_00_000,
        projected: {
          baselineEnergy: 1000,
          energyUnit: "GJ",
          projectedSaving: 50,
          projectedPostEnergy: 950,
          projectedSavingsPct: 5,
          minSavingsPct: 10,
          meetsProjectedThreshold: false,
        },
      })
    ).toThrow(/below the 10%/);
  });

  it("scopes maker-checker to the current pass", () => {
    const rows = [
      { role: "lead_verifier", adeetie_phase: "IGEA" as const },
      { role: "independent_reviewer", adeetie_phase: "IGEA" as const },
      { role: "lead_verifier", adeetie_phase: "DPR" as const },
    ];
    expect(signoffsForPass(rows, "DPR")).toHaveLength(1);
    expect(signoffsForPass(rows, "IGEA")).toHaveLength(2);
  });
});

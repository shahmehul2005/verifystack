import { describe, expect, it } from "vitest";
import {
  ENGAGEMENT_STATUSES,
  ADEETIE_PHASES,
  advanceAdeetiePhase,
  assertTransition,
  canAdvanceAdeetiePhase,
  canTransition,
  nextAdeetiePhase,
  positionLabel,
  walkStatus,
  type EngagementPosition,
} from "./status";
import { ADEETIE_PHASE_SPECS } from "../packs/adeetie/phases";

describe("the CCTS status machine is unchanged", () => {
  it("still advances one step at a time and refuses skips and reversals", () => {
    expect(ENGAGEMENT_STATUSES).toEqual([
      "setup",
      "intake",
      "review",
      "calc",
      "findings",
      "signoff",
      "submitted",
    ]);
    expect(canTransition("setup", "intake")).toBe(true);
    expect(canTransition("setup", "calc")).toBe(false);
    expect(canTransition("review", "intake")).toBe(false);
    expect(() => assertTransition("intake", "review")).not.toThrow();
    expect(() => assertTransition("intake", "signoff")).toThrow(/Illegal status/);
    expect(walkStatus("setup", "findings")).toEqual([
      "intake",
      "review",
      "calc",
      "findings",
    ]);
    expect(walkStatus("findings", "findings")).toEqual([]);
    expect(walkStatus("signoff", "intake")).toEqual([]);
  });

  it("labels a CCTS engagement without a phase prefix", () => {
    expect(positionLabel({ status: "calc" })).toBe("Calculation");
  });

  it("offers no phase advance to an engagement that has no phase", () => {
    expect(canAdvanceAdeetiePhase({ status: "submitted" })).toBe(false);
    expect(() => advanceAdeetiePhase({ status: "submitted" })).toThrow(
      /no ADEETIE phase/
    );
  });
});

describe("the ADEETIE phase axis", () => {
  it("runs IGEA then DPR then M&V", () => {
    expect(ADEETIE_PHASES).toEqual(["IGEA", "DPR", "MV"]);
    expect(nextAdeetiePhase("IGEA")).toBe("DPR");
    expect(nextAdeetiePhase("DPR")).toBe("MV");
    expect(nextAdeetiePhase("MV")).toBeNull();
  });

  it("requires the current pass to complete before the next phase opens", () => {
    const midPass: EngagementPosition = { status: "findings", phase: "IGEA" };
    expect(canAdvanceAdeetiePhase(midPass)).toBe(false);
    expect(() => advanceAdeetiePhase(midPass)).toThrow(/must reach "submitted"/);
  });

  it("restarts the status axis when a phase advances", () => {
    const done: EngagementPosition = { status: "submitted", phase: "IGEA" };
    expect(canAdvanceAdeetiePhase(done)).toBe(true);
    expect(advanceAdeetiePhase(done)).toEqual({ status: "setup", phase: "DPR" });
  });

  it("refuses to advance past the final phase", () => {
    const done: EngagementPosition = { status: "submitted", phase: "MV" };
    expect(canAdvanceAdeetiePhase(done)).toBe(false);
    expect(() => advanceAdeetiePhase(done)).toThrow(/final ADEETIE phase/);
  });

  it("labels both axes together", () => {
    expect(positionLabel({ status: "calc", phase: "MV" })).toBe("M&V · Calculation");
    expect(positionLabel({ status: "setup", phase: "IGEA" })).toBe("IGEA · Setup");
  });

  it("describes every phase with inputs, outputs and exit gates", () => {
    for (const phase of ADEETIE_PHASES) {
      const spec = ADEETIE_PHASE_SPECS[phase];
      expect(spec.inputs.length).toBeGreaterThan(0);
      expect(spec.outputs.length).toBeGreaterThan(0);
      expect(spec.exitGates.length).toBeGreaterThan(0);
    }
    // The savings gate belongs to M&V, not to the earlier phases.
    expect(ADEETIE_PHASE_SPECS.MV.exitGates.join(" ")).toMatch(/sustained/);
  });
});

import { describe, expect, it } from "vitest";
import { ADEETIE_STAGES, assertStageMove, initialStage, stageLabel, stagePhaseMismatch, StageError } from "./stages";

describe("stage manager", () => {
  it("starts at the first stage and has the DFD's eight in order", () => {
    expect(initialStage(ADEETIE_STAGES)).toBe("EOI");
    expect(ADEETIE_STAGES.map((s) => s.id)).toEqual([
      "EOI", "IGEA", "DPR_DRAFT", "DPR_REVIEW", "DPR_FINAL", "LOAN", "MV", "CLOSED",
    ]);
    expect(initialStage(undefined)).toBeNull();
  });

  it("moves forward one step and refuses to skip", () => {
    expect(assertStageMove(ADEETIE_STAGES, "EOI", "IGEA")).toBe("forward");
    expect(() => assertStageMove(ADEETIE_STAGES, "EOI", "DPR_DRAFT")).toThrow(/one step at a time/);
    expect(assertStageMove(ADEETIE_STAGES, null, "EOI")).toBe("forward");
  });

  it("needs a reason to move back", () => {
    expect(() => assertStageMove(ADEETIE_STAGES, "DPR_REVIEW", "DPR_DRAFT")).toThrow(/why/);
    expect(assertStageMove(ADEETIE_STAGES, "DPR_REVIEW", "DPR_DRAFT", "Reviewer asked for a revised cost estimate")).toBe("back");
  });

  it("treats closed as final and rejects unknown or repeated stages", () => {
    expect(() => assertStageMove(ADEETIE_STAGES, "CLOSED", "MV", "reopen please")).toThrow(/closed/);
    expect(() => assertStageMove(ADEETIE_STAGES, "EOI", "NOPE")).toThrow(StageError);
    expect(() => assertStageMove(ADEETIE_STAGES, "EOI", "EOI")).toThrow(/already/);
  });

  it("labels stages and hints at a stage/phase mismatch without enforcing it", () => {
    expect(stageLabel(ADEETIE_STAGES, "LOAN")).toBe("Loan");
    expect(stageLabel(ADEETIE_STAGES, null)).toBe("Not set");
    expect(stagePhaseMismatch(ADEETIE_STAGES, "MV", "IGEA")).toMatch(/Measurement and verification.*IGEA phase/);
    expect(stagePhaseMismatch(ADEETIE_STAGES, "DPR_REVIEW", "DPR")).toBeNull();
    expect(stagePhaseMismatch(ADEETIE_STAGES, "LOAN", "IGEA")).toBeNull();
  });
});

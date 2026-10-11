/**
 * Engagement stage manager (DFD 1.5).
 *
 * A stage is where an engagement sits in the scheme's commercial and review
 * journey. It is a coarse tracker for the firm, separate from two things that
 * already exist and are not changed by it: the engagement status (setup to
 * submitted) and the ADEETIE phase (IGEA, DPR, M&V), which gate calculation and
 * sign-off. Moving a stage never unlocks or locks anything.
 *
 * The stage list comes from the pack. ADEETIE's is listed in the DFD. CCTS's
 * annual cycle is marked "to define" there, so CCTS packs carry no stage list
 * and the tracker does not appear for them; the register records it as open.
 */

export interface StageDef {
  id: string;
  label: string;
  /** The ADEETIE phase this stage is part of, for display grouping only. */
  phase?: "IGEA" | "DPR" | "MV";
}

export const ADEETIE_STAGES: readonly StageDef[] = [
  { id: "EOI", label: "Expression of interest" },
  { id: "IGEA", label: "Investment grade energy audit", phase: "IGEA" },
  { id: "DPR_DRAFT", label: "DPR draft", phase: "DPR" },
  { id: "DPR_REVIEW", label: "DPR review", phase: "DPR" },
  { id: "DPR_FINAL", label: "DPR final", phase: "DPR" },
  { id: "LOAN", label: "Loan" },
  { id: "MV", label: "Measurement and verification", phase: "MV" },
  { id: "CLOSED", label: "Closed" },
];

export class StageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageError";
  }
}

export function stageIndex(stages: readonly StageDef[], id: string): number {
  return stages.findIndex((s) => s.id === id);
}

export function stageLabel(stages: readonly StageDef[], id: string | null | undefined): string {
  if (!id) return "Not set";
  return stages.find((s) => s.id === id)?.label ?? id;
}

/** The stage a new engagement starts in: the first of the list. */
export function initialStage(stages: readonly StageDef[] | undefined): string | null {
  return stages && stages.length > 0 ? stages[0]!.id : null;
}

/**
 * Forward moves go one stage at a time so nothing is skipped silently. A move
 * back needs a reason on the record. Closed is final.
 */
export function assertStageMove(
  stages: readonly StageDef[],
  from: string | null,
  to: string,
  note?: string
): "forward" | "back" {
  const toIdx = stageIndex(stages, to);
  if (toIdx < 0) throw new StageError(`"${to}" is not a stage of this scheme.`);
  const fromIdx = from === null ? -1 : stageIndex(stages, from);
  if (from !== null && fromIdx < 0) throw new StageError(`The current stage "${from}" is not in this scheme's list.`);
  if (toIdx === fromIdx) throw new StageError("The engagement is already in that stage.");
  if (from !== null && from === stages[stages.length - 1]!.id) {
    throw new StageError("A closed engagement cannot change stage.");
  }
  if (toIdx === fromIdx + 1) return "forward";
  if (toIdx < fromIdx) {
    if (!note || note.trim().length < 5) {
      throw new StageError("Say why the engagement is moving back a stage.");
    }
    return "back";
  }
  throw new StageError(
    `Stages move one step at a time. Next is "${stages[fromIdx + 1]!.label}".`
  );
}

/** Whether the stage and the ADEETIE phase tell the same story. Shown as a hint, never enforced. */
export function stagePhaseMismatch(
  stages: readonly StageDef[],
  stage: string | null,
  phase: "IGEA" | "DPR" | "MV" | null
): string | null {
  const def = stages.find((s) => s.id === stage);
  if (!def?.phase || !phase || def.phase === phase) return null;
  return `The stage is "${def.label}" but the engagement is in the ${phase} phase.`;
}

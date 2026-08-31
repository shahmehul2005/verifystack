/**
 * ADEETIE lifecycle orchestration.
 *
 * Process 5.0 still does not branch on sector. This module sits in Process 1.0 /
 * 7.0: which pass the engagement is on, which evidence that pass may consume, and
 * whether the pass may close. The SEC engine only ever sees a filtered fact list
 * and a `baseline` | `post_implementation` label.
 */

import {
  advanceAdeetiePhase,
  canAdvanceAdeetiePhase,
  type EngagementPosition,
} from "../engagements/status";
import type { AdeetiePhase } from "../packs/adeetie/phases";
import type { SecPhase } from "../calc/sec";
import { MIN_ENERGY_SAVINGS_PCT } from "../packs/adeetie/scheme";

export class AdeetieLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdeetieLifecycleError";
  }
}

/** Which SEC run this ADEETIE pass is allowed to write. */
export function secPhaseForAdeetiePhase(phase: AdeetiePhase): SecPhase | null {
  if (phase === "MV") return "post_implementation";
  if (phase === "IGEA" || phase === "DPR") return "baseline";
  return null;
}

export function allowedSecPhases(phase: AdeetiePhase): SecPhase[] {
  if (phase === "MV") return ["post_implementation"];
  return ["baseline"];
}

export function assertSecPhaseAllowed(phase: AdeetiePhase, secPhase: SecPhase): void {
  if (!allowedSecPhases(phase).includes(secPhase)) {
    throw new AdeetieLifecycleError(
      phase === "MV"
        ? "M&V runs the post-implementation SEC. The baseline was locked at IGEA."
        : "Post-implementation SEC is an M&V activity. This pass may only run a baseline SEC."
    );
  }
}

/**
 * Whether a document uploaded in `docPhase` may feed a given SEC run.
 *
 * Untagged (legacy / CCTS) documents count as IGEA so a baseline can still be
 * formed. Post-implementation never silently reuses the baseline packet.
 */
export function documentFeedsSecPhase(
  docPhase: AdeetiePhase | null | undefined,
  secPhase: SecPhase
): boolean {
  if (secPhase === "baseline") return docPhase === "IGEA" || docPhase == null;
  return docPhase === "MV";
}

export interface PhaseTagged {
  document_id: string;
}

export function filterFactsForSecPhase<T extends PhaseTagged>(
  facts: T[],
  documentPhaseById: Map<string, AdeetiePhase | null>,
  secPhase: SecPhase
): T[] {
  return facts.filter((f) =>
    documentFeedsSecPhase(documentPhaseById.get(f.document_id) ?? null, secPhase)
  );
}

export interface AdeetieMeasureDraft {
  description: string;
  projectedAnnualSaving: number;
  savingUnit: string;
  capitalCostINR: number;
  basis: string;
}

export function assertMeasureDraft(draft: AdeetieMeasureDraft): void {
  if (draft.description.trim().length < 8) {
    throw new AdeetieLifecycleError(
      "A measure needs a description of what will change, not a label."
    );
  }
  if (!Number.isFinite(draft.projectedAnnualSaving) || draft.projectedAnnualSaving < 0) {
    throw new AdeetieLifecycleError("Projected annual saving must be a non-negative number.");
  }
  if (!draft.savingUnit.trim()) {
    throw new AdeetieLifecycleError("Projected saving must name its energy unit.");
  }
  if (!Number.isFinite(draft.capitalCostINR) || draft.capitalCostINR < 0) {
    throw new AdeetieLifecycleError("Capital cost must be a non-negative rupee amount.");
  }
  if (draft.basis.trim().length < 4) {
    throw new AdeetieLifecycleError(
      "Record the basis for the projection (quotation, vendor guarantee, audit estimate)."
    );
  }
}

export interface ProjectedSavings {
  baselineEnergy: number;
  energyUnit: string;
  projectedSaving: number;
  projectedPostEnergy: number;
  projectedSavingsPct: number;
  minSavingsPct: number;
  meetsProjectedThreshold: boolean;
}

/**
 * DPR projection: sum of measure savings against baseline energy, assuming
 * unchanged output. This is not the scheme gate — M&V compares two measured SECs.
 */
export function projectSavingsFromMeasures(
  baselineEnergy: { value: number; unit: string },
  measures: Pick<AdeetieMeasureDraft, "projectedAnnualSaving" | "savingUnit">[],
  minSavingsPct = MIN_ENERGY_SAVINGS_PCT
): ProjectedSavings {
  if (!(baselineEnergy.value > 0)) {
    throw new AdeetieLifecycleError("Baseline energy must be greater than zero to project a saving.");
  }
  let projectedSaving = 0;
  for (const m of measures) {
    if (m.savingUnit !== baselineEnergy.unit) {
      throw new AdeetieLifecycleError(
        `Measure saving is in ${m.savingUnit} but baseline energy is in ${baselineEnergy.unit}.`
      );
    }
    projectedSaving += m.projectedAnnualSaving;
  }
  const projectedPostEnergy = baselineEnergy.value - projectedSaving;
  const projectedSavingsPct = (projectedSaving / baselineEnergy.value) * 100;
  return {
    baselineEnergy: baselineEnergy.value,
    energyUnit: baselineEnergy.unit,
    projectedSaving,
    projectedPostEnergy,
    projectedSavingsPct,
    minSavingsPct,
    meetsProjectedThreshold: projectedSavingsPct >= minSavingsPct,
  };
}

export interface PhaseAdvanceContext {
  position: EngagementPosition;
  hasBaselineSec: boolean;
  openBlockCount: number;
  measureCount: number;
  loanAmountINR: number | null;
  projectCostINR: number | null;
  projected: ProjectedSavings | null;
}

export function phaseAdvanceBlockers(ctx: PhaseAdvanceContext): string[] {
  const blockers: string[] = [];
  if (!ctx.position.phase) {
    blockers.push("This engagement has no ADEETIE phase.");
    return blockers;
  }
  if (!canAdvanceAdeetiePhase(ctx.position)) {
    if (ctx.position.status !== "submitted") {
      blockers.push(
        `The ${ctx.position.phase} pass must reach submitted (lead + independent reviewer) before the next phase opens.`
      );
    } else if (ctx.position.phase === "MV") {
      blockers.push("M&V is the final ADEETIE phase.");
    }
  }
  if (ctx.openBlockCount > 0) {
    blockers.push(`${ctx.openBlockCount} open block finding(s) must be closed or rejected.`);
  }

  const from = ctx.position.phase;
  if (from === "IGEA") {
    if (!ctx.hasBaselineSec) {
      blockers.push("IGEA cannot close without a baseline SEC run.");
    }
  }
  if (from === "DPR") {
    if (ctx.measureCount < 1) {
      blockers.push("DPR cannot close without at least one recorded energy conservation measure.");
    }
    if (ctx.loanAmountINR == null || ctx.loanAmountINR <= 0) {
      blockers.push("DPR cannot close without a loan amount.");
    }
    if (ctx.projectCostINR == null || ctx.projectCostINR <= 0) {
      blockers.push("DPR cannot close without a project cost.");
    }
    if (ctx.projected && !ctx.projected.meetsProjectedThreshold) {
      blockers.push(
        `Projected savings ${ctx.projected.projectedSavingsPct.toFixed(2)}% are below the ${ctx.projected.minSavingsPct}% scheme minimum (TO VERIFY). The 10% gate is decided at M&V; DPR still requires a projection that clears it.`
      );
    }
    if (!ctx.projected && ctx.measureCount > 0 && ctx.hasBaselineSec) {
      blockers.push("Projected savings could not be computed from the recorded measures.");
    }
  }
  return blockers;
}

export function assertPhaseAdvanceReady(ctx: PhaseAdvanceContext): EngagementPosition {
  const blockers = phaseAdvanceBlockers(ctx);
  if (blockers.length > 0) {
    throw new AdeetieLifecycleError(blockers.join(" "));
  }
  return advanceAdeetiePhase(ctx.position);
}

export function signoffsForPass<T extends { adeetie_phase?: AdeetiePhase | null }>(
  rows: T[],
  phase: AdeetiePhase | null | undefined
): T[] {
  if (!phase) return rows;
  return rows.filter((r) => (r.adeetie_phase ?? null) === phase);
}

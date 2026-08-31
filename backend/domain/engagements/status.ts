import {
  ADEETIE_PHASES,
  ADEETIE_PHASE_LABEL,
  ADEETIE_PHASE_SHORT_LABEL,
  canAdvancePhase,
  type AdeetiePhase,
} from "../packs/adeetie/phases";

export const ENGAGEMENT_STATUSES = [
  "setup",
  "intake",
  "review",
  "calc",
  "findings",
  "signoff",
  "submitted",
] as const;

export type Status = (typeof ENGAGEMENT_STATUSES)[number];

const ORDER = ENGAGEMENT_STATUSES;

export function canTransition(from: Status, to: Status) {
  const a = ORDER.indexOf(from);
  const b = ORDER.indexOf(to);
  return b === a + 1;
}

/**
 * Statuses to walk through to reach `target` from `from`, exclusive of `from`.
 * Empty if already there or if `target` is behind (never reverse).
 */
export function walkStatus(from: Status, target: Status): Status[] {
  const a = ORDER.indexOf(from);
  const b = ORDER.indexOf(target);
  if (a < 0 || b < 0 || b <= a) return [];
  return ORDER.slice(a + 1, b + 1);
}

export function assertTransition(from: Status, to: Status) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal status transition ${from} → ${to}`);
  }
}

export const STATUS_LABEL: Record<Status, string> = {
  setup: "Setup",
  intake: "Intake",
  review: "Review",
  calc: "Calculation",
  findings: "Findings",
  signoff: "Sign-off",
  submitted: "Submitted",
};

/**
 * ADEETIE support.
 *
 * The seven statuses above describe one pass of verification work: take evidence
 * in, review it, calculate, raise findings, sign off. An ADEETIE engagement does
 * that three times — once for the IGEA, once for the DPR, once for M&V — with a
 * savings gate between the second and third.
 *
 * So the phase is modelled as a second axis rather than as more statuses. A CCTS
 * engagement has no phase and every function below leaves it alone; nothing in the
 * status machine changes for CCTS.
 */

export {
  ADEETIE_PHASES,
  ADEETIE_PHASE_LABEL,
  ADEETIE_PHASE_SHORT_LABEL,
  type AdeetiePhase,
};

/** Where an engagement is, on both axes. */
export interface EngagementPosition {
  status: Status;
  /** Absent for CCTS engagements. */
  phase?: AdeetiePhase;
}

/** Terminal status of a single pass. Reaching it opens the next phase. */
const PASS_COMPLETE: Status = "submitted";

export function isPassComplete(position: EngagementPosition): boolean {
  return position.status === PASS_COMPLETE;
}

/**
 * Whether the engagement can move to the next ADEETIE phase.
 *
 * Requires the current pass to be complete and requires there to be a next phase.
 * It deliberately does not consult findings or savings — the phase-specific gates
 * live in the rule set and are evaluated there, so this function stays a pure
 * statement about position.
 */
export function canAdvanceAdeetiePhase(position: EngagementPosition): boolean {
  if (!position.phase) return false;
  if (!isPassComplete(position)) return false;
  return nextAdeetiePhase(position.phase) !== null;
}

export function nextAdeetiePhase(phase: AdeetiePhase): AdeetiePhase | null {
  const i = ADEETIE_PHASES.indexOf(phase);
  const next = ADEETIE_PHASES[i + 1];
  return next ?? null;
}

/**
 * Advance to the next phase, resetting the status axis so the new phase starts a
 * fresh pass. Throws rather than silently no-opping, because a caller that thinks
 * it advanced a phase and did not would show the wrong gate to a reviewer.
 */
export function advanceAdeetiePhase(
  position: EngagementPosition
): EngagementPosition {
  if (!position.phase) {
    throw new Error("Engagement has no ADEETIE phase to advance.");
  }
  if (!isPassComplete(position)) {
    throw new Error(
      `Cannot leave phase ${position.phase} from status "${position.status}": ` +
        `the current pass must reach "${PASS_COMPLETE}" first.`
    );
  }
  const next = nextAdeetiePhase(position.phase);
  if (!next) {
    throw new Error(`Phase ${position.phase} is the final ADEETIE phase.`);
  }
  if (!canAdvancePhase(position.phase, next)) {
    throw new Error(`Illegal ADEETIE phase transition ${position.phase} → ${next}`);
  }
  return { status: "setup", phase: next };
}

/** Display label covering both axes. */
export function positionLabel(position: EngagementPosition): string {
  const status = STATUS_LABEL[position.status];
  if (!position.phase) return status;
  return `${ADEETIE_PHASE_SHORT_LABEL[position.phase]} · ${status}`;
}

/**
 * The ADEETIE engagement lifecycle.
 *
 * An ADEETIE engagement is three sequential pieces of work with a money gate
 * between the second and the third:
 *
 *   IGEA — Investment Grade Energy Audit. Evidence intake, a baseline SEC, an
 *          energy balance, and the measures the audit identifies.
 *   DPR  — Detailed Project Report on the BEE template. Proposed measures,
 *          projected savings, project cost, loan structure, subvention.
 *   M&V  — Post-implementation Monitoring & Verification. A second SEC, the
 *          savings percentage against the baseline, and the 10% gate.
 *
 * This is orthogonal to the verification status machine in
 * domain/engagements/status.ts: each phase runs the full setup → sign-off cycle.
 */

export const ADEETIE_PHASES = ["IGEA", "DPR", "MV"] as const;
export type AdeetiePhase = (typeof ADEETIE_PHASES)[number];

export const ADEETIE_PHASE_LABEL: Record<AdeetiePhase, string> = {
  IGEA: "Investment Grade Energy Audit",
  DPR: "Detailed Project Report",
  MV: "Monitoring & Verification",
};

export const ADEETIE_PHASE_SHORT_LABEL: Record<AdeetiePhase, string> = {
  IGEA: "IGEA",
  DPR: "DPR",
  MV: "M&V",
};

export interface AdeetiePhaseSpec {
  phase: AdeetiePhase;
  label: string;
  /** What the phase consumes. */
  inputs: string[];
  /** What the phase must produce before the next one can open. */
  outputs: string[];
  /** Conditions that must hold to leave the phase. */
  exitGates: string[];
}

export const ADEETIE_PHASE_SPECS: Record<AdeetiePhase, AdeetiePhaseSpec> = {
  IGEA: {
    phase: "IGEA",
    label: ADEETIE_PHASE_LABEL.IGEA,
    inputs: [
      "Electricity bills for the complete baseline year",
      "Fuel consumption records for every fuel used",
      "Production log for the baseline year",
      "Udyam Registration Certificate",
      "Measuring instrument calibration certificates",
    ],
    outputs: [
      "Baseline SEC with per-stream derivations",
      "Energy balance for the baseline year",
      "Identified energy conservation measures",
    ],
    exitGates: [
      "Baseline year is complete — no missing months in any stream",
      "Energy balance closes within tolerance",
      "No open block findings",
    ],
  },
  DPR: {
    phase: "DPR",
    label: ADEETIE_PHASE_LABEL.DPR,
    inputs: [
      "Baseline SEC from the IGEA phase",
      "Equipment quotations and purchase orders",
      "Loan sanction letter from a Registered FI",
      "Audited financial statements",
    ],
    outputs: [
      "Proposed measures with projected savings",
      "Project cost build-up",
      "Loan structure and interest subvention computation",
      "DPR document",
    ],
    exitGates: [
      "Projected savings are at least the scheme minimum",
      "Loan amount is within the eligible range",
      "Debt funding does not exceed the permitted share of project cost",
      "Enterprise category matches the subvention rate claimed",
      "No open block findings",
    ],
  },
  MV: {
    phase: "MV",
    label: ADEETIE_PHASE_LABEL.MV,
    inputs: [
      "Installation & commissioning certificate",
      "Post-implementation electricity bills and fuel records",
      "Post-implementation production log",
    ],
    outputs: [
      "Post-implementation SEC",
      "Savings percentage against the baseline SEC",
      "M&V report",
    ],
    exitGates: [
      "Savings are at least the scheme minimum, achieved and sustained",
      "Post-implementation period is comparable to the baseline",
      "No open block findings",
    ],
  },
};

export function canAdvancePhase(from: AdeetiePhase, to: AdeetiePhase): boolean {
  const a = ADEETIE_PHASES.indexOf(from);
  const b = ADEETIE_PHASES.indexOf(to);
  return b === a + 1;
}

export function assertPhaseAdvance(from: AdeetiePhase, to: AdeetiePhase): void {
  if (!canAdvancePhase(from, to)) {
    throw new Error(`Illegal ADEETIE phase transition ${from} → ${to}`);
  }
}

export function isAdeetiePhase(value: string): value is AdeetiePhase {
  return (ADEETIE_PHASES as readonly string[]).includes(value);
}

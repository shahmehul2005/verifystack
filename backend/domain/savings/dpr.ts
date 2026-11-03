/**
 * SAVINGS_DPR: the simple-payback layer over an ADEETIE engagement (DFD 5.0).
 *
 * This is deliberately separate from the SEC engine. SEC runs, phases and the
 * M&V gate stay exactly as they were; this layer takes the energy conservation
 * measures a DPR already records and reports what they would save and how fast
 * they pay back. It is versioned and hashed like a run so a figure on a DPR
 * review can be reproduced.
 *
 * What it does not do: no NPV, IRR, DSCR, debt-equity or any other financial
 * ratio. The scheme's DPR ratios and their thresholds have not been sourced, so
 * they are listed as open items in the regulatory register and the result says
 * so explicitly instead of returning a number that looks authoritative.
 *
 * Code computes; no model output reaches this file. Every input is a recorded
 * measure with a stated basis.
 */

import { hashCanonical } from "../canonical";

export const SAVINGS_DPR_ENGINE_VERSION = "savings-dpr-1.0.0";

export class SavingsDprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavingsDprError";
  }
}

export interface DprMeasureInput {
  id: string;
  description: string;
  /** Annual energy saving in `energyUnit`. */
  annualEnergySaving: number;
  capitalCostINR: number;
  /**
   * Rupee value of the annual saving, stated by the applicant or auditor with
   * its basis (tariff, fuel price). Null when it has not been recorded; payback
   * is then not computed rather than estimated.
   */
  annualCostSavingINR: number | null;
}

export interface SavingsDprInput {
  baselineEnergy: { value: number; unit: string };
  energyUnit: string;
  minSavingsPct: number;
  measures: DprMeasureInput[];
}

export interface DprMeasureResult {
  id: string;
  description: string;
  annualEnergySaving: number;
  capitalCostINR: number;
  annualCostSavingINR: number | null;
  /** Capital cost over annual rupee saving, in years. Null when the saving is unknown or zero. */
  simplePaybackYears: number | null;
  paybackNote: string | null;
}

export interface SavingsDprResult {
  engineVersion: string;
  perMeasure: DprMeasureResult[];
  totals: {
    annualEnergySaving: number;
    energyUnit: string;
    savingsPct: number;
    meetsProjectedThreshold: boolean;
    minSavingsPct: number;
    capitalCostINR: number;
    /** Sum over measures that have a recorded rupee saving. */
    annualCostSavingINR: number | null;
    /** Portfolio payback, only when every measure has a recorded rupee saving. */
    simplePaybackYears: number | null;
    measuresMissingCostSaving: number;
  };
  /** What this layer does not compute, shown wherever the result is shown. */
  notComputed: string[];
}

export const SAVINGS_DPR_NOT_COMPUTED = [
  "Net present value, internal rate of return and debt service coverage are not computed. The scheme's DPR ratios and thresholds are an open item in the regulatory register.",
  "Savings are projections from recorded measures. The scheme gate is decided on measured M&V, not on these figures.",
];

function assertFiniteNonNegative(value: number, what: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new SavingsDprError(`${what} must be a non-negative number.`);
  }
}

export function calculateSavingsDpr(input: SavingsDprInput): SavingsDprResult {
  if (!(input.baselineEnergy.value > 0)) {
    throw new SavingsDprError("Baseline energy must be greater than zero.");
  }
  if (input.baselineEnergy.unit !== input.energyUnit) {
    throw new SavingsDprError(
      `Baseline energy is in ${input.baselineEnergy.unit} but measures are in ${input.energyUnit}.`
    );
  }
  if (input.measures.length === 0) {
    throw new SavingsDprError("Record at least one measure before computing savings.");
  }

  const perMeasure: DprMeasureResult[] = input.measures.map((m) => {
    assertFiniteNonNegative(m.annualEnergySaving, `Energy saving for "${m.id}"`);
    assertFiniteNonNegative(m.capitalCostINR, `Capital cost for "${m.id}"`);
    if (m.annualCostSavingINR !== null) {
      assertFiniteNonNegative(m.annualCostSavingINR, `Rupee saving for "${m.id}"`);
    }
    let payback: number | null = null;
    let note: string | null = null;
    if (m.annualCostSavingINR === null) {
      note = "No rupee saving recorded, so payback is not computed.";
    } else if (m.annualCostSavingINR === 0) {
      note = "Recorded rupee saving is zero, so there is no payback.";
    } else {
      payback = m.capitalCostINR / m.annualCostSavingINR;
    }
    return {
      id: m.id,
      description: m.description,
      annualEnergySaving: m.annualEnergySaving,
      capitalCostINR: m.capitalCostINR,
      annualCostSavingINR: m.annualCostSavingINR,
      simplePaybackYears: payback,
      paybackNote: note,
    };
  });

  const annualEnergySaving = perMeasure.reduce((s, m) => s + m.annualEnergySaving, 0);
  const capitalCostINR = perMeasure.reduce((s, m) => s + m.capitalCostINR, 0);
  const withSaving = perMeasure.filter((m) => m.annualCostSavingINR !== null);
  const annualCostSavingINR =
    withSaving.length > 0 ? withSaving.reduce((s, m) => s + (m.annualCostSavingINR ?? 0), 0) : null;
  const missing = perMeasure.length - withSaving.length;
  const portfolioPayback =
    missing === 0 && annualCostSavingINR !== null && annualCostSavingINR > 0
      ? capitalCostINR / annualCostSavingINR
      : null;
  const savingsPct = (annualEnergySaving / input.baselineEnergy.value) * 100;

  return {
    engineVersion: SAVINGS_DPR_ENGINE_VERSION,
    perMeasure,
    totals: {
      annualEnergySaving,
      energyUnit: input.energyUnit,
      savingsPct,
      meetsProjectedThreshold: savingsPct >= input.minSavingsPct,
      minSavingsPct: input.minSavingsPct,
      capitalCostINR,
      annualCostSavingINR,
      simplePaybackYears: portfolioPayback,
      measuresMissingCostSaving: missing,
    },
    notComputed: SAVINGS_DPR_NOT_COMPUTED,
  };
}

export function hashSavingsDprInput(input: SavingsDprInput): string {
  return hashCanonical({ engine: SAVINGS_DPR_ENGINE_VERSION, input });
}

export function chainSavingsDprHash(inputHash: string, previousRunHash: string | null): string {
  return hashCanonical({ inputHash, previousRunHash });
}

/**
 * Self-consistency of a single document (Processes 3.0 and 4.3).
 *
 * Some errors never need a second document to see. A weighbridge slip prints a gross
 * weight, a tare and a net; if they do not agree, the slip is wrong on its face, and it
 * should be stopped before it becomes a fact. Coal proximate analysis has the same
 * property: moisture, ash, volatile matter and fixed carbon are the whole of the coal,
 * so they add to 100% on the same basis.
 *
 * Both checks take the values as extracted and return a verdict with the arithmetic
 * shown. Neither invents the tolerance silently: each has a stated default and the
 * caller may override it, so a finding can quote the band it used.
 */

/** The band on a weighbridge slip. A slip rounds to 0.01 t, so two roundings can differ by 0.02 t. */
export const WEIGHBRIDGE_TOLERANCE_T = 0.05;

export interface WeighbridgeSlip {
  grossT: number;
  tareT: number;
  /** The net printed on the slip. */
  netT: number;
  toleranceT?: number;
}

export type SlipVerdict =
  | { status: "consistent"; computedNet: number; difference: number; detail: string }
  | { status: "inconsistent"; computedNet: number; difference: number; detail: string }
  | { status: "not_applicable"; detail: string };

/**
 * Gross minus tare must equal the net the slip prints. A slip whose own three numbers
 * disagree is not evidence of a delivery; it is evidence that the slip was written by
 * hand or misread, and nothing downstream should rely on it.
 */
export function checkWeighbridgeSlip(slip: WeighbridgeSlip): SlipVerdict {
  const { grossT, tareT, netT } = slip;
  const tolerance = slip.toleranceT ?? WEIGHBRIDGE_TOLERANCE_T;
  if (![grossT, tareT, netT].every((n) => Number.isFinite(n))) {
    return { status: "not_applicable", detail: "The gross, tare or net weight was not read as a number." };
  }
  if (grossT <= 0 || tareT < 0 || netT < 0) {
    return { status: "not_applicable", detail: "A gross weight of zero or below, or a negative tare or net, is not a weighbridge reading." };
  }
  if (tareT >= grossT) {
    return {
      status: "inconsistent",
      computedNet: grossT - tareT,
      difference: netT - (grossT - tareT),
      detail: `Tare ${tareT} t is not lighter than gross ${grossT} t, so the slip describes no delivery.`,
    };
  }
  const computedNet = grossT - tareT;
  const difference = netT - computedNet;
  if (Math.abs(difference) > tolerance + 1e-9) {
    return {
      status: "inconsistent",
      computedNet,
      difference,
      detail:
        `Gross ${grossT} t minus tare ${tareT} t is ${round(computedNet)} t, but the slip prints ${netT} t: a difference of ` +
        `${round(difference)} t against a ${tolerance} t band. The slip does not agree with itself.`,
    };
  }
  return {
    status: "consistent",
    computedNet,
    difference,
    detail: `Gross ${grossT} t minus tare ${tareT} t is ${round(computedNet)} t, and the slip prints ${netT} t.`,
  };
}

/** The band on a proximate analysis, in percentage points. The four results are reported to 0.01%. */
export const PROXIMATE_TOLERANCE_PCT = 0.5;

export interface ProximateAnalysis {
  moisturePct: number;
  ashPct: number;
  volatileMatterPct: number;
  /** Where the document prints fixed carbon, it is given; where it prints only the other three, it is null. */
  fixedCarbonPct: number | null;
  tolerancePct?: number;
}

export type ProximateVerdict =
  | { status: "consistent"; total: number; difference: number; detail: string }
  | { status: "inconsistent"; total: number; difference: number; detail: string }
  | { status: "not_applicable"; detail: string };

/**
 * Moisture, ash, volatile matter and fixed carbon are the whole of the coal, so on one
 * basis they sum to 100%. A row that sums to 96% or 104% is a transcription error, and
 * a calorific value read from the same row is not reliable.
 *
 * Where fixed carbon is not printed, the check is not applied: the other three summing
 * to less than 100 is expected, and there is nothing to compare.
 */
export function checkProximateAnalysis(analysis: ProximateAnalysis): ProximateVerdict {
  const { moisturePct, ashPct, volatileMatterPct, fixedCarbonPct } = analysis;
  const tolerance = analysis.tolerancePct ?? PROXIMATE_TOLERANCE_PCT;
  if (fixedCarbonPct === null || ![moisturePct, ashPct, volatileMatterPct, fixedCarbonPct].every((n) => Number.isFinite(n))) {
    return { status: "not_applicable", detail: "Fixed carbon is not printed, so the four proximate results cannot be added." };
  }
  if ([moisturePct, ashPct, volatileMatterPct, fixedCarbonPct].some((n) => n < 0 || n > 100)) {
    return { status: "not_applicable", detail: "A proximate result outside 0% to 100% is not a percentage of the sample." };
  }
  const total = moisturePct + ashPct + volatileMatterPct + fixedCarbonPct;
  const difference = total - 100;
  if (Math.abs(difference) > tolerance + 1e-9) {
    return {
      status: "inconsistent",
      total,
      difference,
      detail:
        `Moisture ${moisturePct}%, ash ${ashPct}%, volatile matter ${volatileMatterPct}% and fixed carbon ${fixedCarbonPct}% ` +
        `sum to ${round(total)}%, not 100% within ${tolerance}: a difference of ${round(difference)} percentage points. ` +
        `The results are not all on one basis, or one of them was copied wrongly.`,
    };
  }
  return {
    status: "consistent",
    total,
    difference,
    detail: `The four proximate results sum to ${round(total)}%, within ${tolerance} of 100%.`,
  };
}

/** True when every figure in a set is written to the same number of decimals, a hint that they were typed rather than instrument-read. */
export function sharesOneDecimalScale(values: readonly number[]): boolean {
  const decimals = values
    .filter((v) => Number.isFinite(v))
    .map((v) => (Math.abs(v).toFixed(10).replace(/\.?0+$/, "").split(".")[1] ?? "").length);
  if (decimals.length < 2) return false;
  return new Set(decimals).size === 1;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Calorific value and moisture basis (Process 5.2).
 *
 * A lab reports a calorific value together with the moisture it was measured at.
 * The same coal therefore has two different numbers: one on the as-received basis
 * (ARB, the wet coal as burned) and one on a dried basis (ADB or DB). The numbers
 * differ only by how much water was driven off before the test:
 *
 *     NCV(ARB) = NCV(dried) x (1 - M_total) / (1 - M_inherent)
 *     NCV(dried) = NCV(ARB) x (1 - M_inherent) / (1 - M_total)
 *
 * where both moisture fractions are of the same gross sample. Drying removes water
 * without removing energy, so the same energy is spread over less mass: a dried-basis
 * calorific value is always the larger of the two. This module converts between them so
 * a value can be compared with the basis the workbook declares.
 *
 * It refuses to guess. A conversion is only made when the moisture figure it needs
 * is present and physically possible. Everything else comes back as an open reason,
 * so a check can report that the basis is unstated instead of assuming ARB.
 */

export type MoistureBasis = "ARB" | "ADB" | "DB" | "NA";

export const BASIS_LABEL: Record<MoistureBasis, string> = {
  ARB: "as-received basis (ARB)",
  ADB: "air-dried basis (ADB)",
  DB: "dry basis (DB)",
  NA: "no moisture basis stated",
};

/** The bases that describe dried coal, where the moisture has been driven off before the test. */
const DRIED: ReadonlySet<MoistureBasis> = new Set(["ADB", "DB"]);

export interface BasisInput {
  /** The calorific value as printed, kcal/kg. */
  value: number;
  basis: MoistureBasis;
  /** Total moisture, percent of the as-received sample. Required to reach ARB. */
  totalMoisturePct: number | null;
  /** Inherent (air-dry) moisture, percent. Required to leave ARB. */
  inherentMoisturePct: number | null;
}

export type BasisConversion =
  | { ok: true; value: number; from: MoistureBasis; to: MoistureBasis }
  | { ok: false; reason: string };

/**
 * Convert a calorific value to `target`. A value already on the target basis is
 * returned unchanged. Anything that cannot be done exactly is refused with a reason
 * a finding can quote, never approximated.
 */
export function convertCalorificValue(input: BasisInput, target: "ARB" | "ADB"): BasisConversion {
  const { value, basis } = input;
  if (!Number.isFinite(value) || value <= 0) return { ok: false, reason: `A calorific value of ${value} is not a measurement.` };
  if (basis === "NA") return { ok: false, reason: "The document does not state the moisture basis of this calorific value." };
  if (basis === target) return { ok: true, value, from: basis, to: target };

  const mTotal = fraction(input.totalMoisturePct);
  const mInherent = fraction(input.inherentMoisturePct);
  if (mTotal === null) return { ok: false, reason: "Total moisture is not stated, so the value cannot be moved between bases." };

  if (DRIED.has(basis) && target === "ARB") {
    if (mInherent === null) return { ok: false, reason: "Inherent moisture is not stated, so a dried-basis value cannot be put on an as-received basis." };
    if (!(mTotal > mInherent)) {
      return {
        ok: false,
        reason: `Total moisture ${input.totalMoisturePct}% is not above inherent moisture ${input.inherentMoisturePct}%, so the two figures are not on the same sample.`,
      };
    }
    // Drying removed water and left the energy, so returning to the wet mass spreads
    // that energy over more water and lowers the calorific value.
    return { ok: true, value: (value * (1 - mTotal)) / (1 - mInherent), from: basis, to: target };
  }

  if (basis === "ARB" && target === "ADB") {
    if (mInherent === null) return { ok: false, reason: "Inherent moisture is not stated, so the value cannot be put on an air-dried basis." };
    if (!(mTotal > mInherent)) {
      return {
        ok: false,
        reason: `Total moisture ${input.totalMoisturePct}% is not above inherent moisture ${input.inherentMoisturePct}%, so the two figures are not on the same sample.`,
      };
    }
    // The inverse of the dried-to-wet step: removing water raises the calorific value.
    return { ok: true, value: (value * (1 - mInherent)) / (1 - mTotal), from: basis, to: target };
  }

  return { ok: false, reason: `A ${BASIS_LABEL[basis]} value cannot be converted to ${BASIS_LABEL[target]} with the figures given.` };
}

function fraction(pct: number | null): number | null {
  if (pct === null || !Number.isFinite(pct) || pct < 0 || pct >= 100) return null;
  return pct / 100;
}

/**
 * The basis a workbook's coal figure is on, where the workbook makes it plain.
 *
 * A workbook that prints total moisture and a calorific value is treating the value
 * as as-received. A workbook that prints a GCV-to-NCV cell derives the net value with
 * the moisture already inside it (Annexure III, Eq. XVIII), which is also as-received.
 * Where the workbook says nothing, the basis is unknown and is reported as such.
 */
export function workbookBasis(hasMoistureColumn: boolean, hasGcvToNcvCell: boolean): MoistureBasis {
  if (hasGcvToNcvCell) return "ARB";
  if (hasMoistureColumn) return "ARB";
  return "NA";
}

/** True when the value a check was handed is on the basis the calculation needs. */
export function isOnBasis(basis: MoistureBasis, target: "ARB" | "ADB"): boolean {
  return basis === target;
}

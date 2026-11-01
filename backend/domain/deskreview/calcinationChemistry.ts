/**
 * Calcination chemistry (CCTS cement, Detailed Procedure Annexure II.G.1).
 *
 * Clinker CO2 comes from carbonate decomposition, and the oxides left behind set a
 * floor no plant can go below:
 *
 *   CaCO3 -> CaO + CO2      MgCO3 -> MgO + CO2
 *
 * So per tonne of clinker, the CO2 released is at least
 *
 *   0.785 x fraction(CaO) + 1.092 x fraction(MgO)
 *
 * The two constants are not magic numbers: they are the mass ratios CO2/CaO and
 * CO2/MgO from the atomic masses below. This module computes them from the masses so
 * the arithmetic can be followed, and exposes the published values for the register.
 *
 * The published factors are rounded (0.785 and 1.092). With exact atomic masses they
 * are 0.78480 and 1.09193. On 64.5% CaO and 2.1% MgO that is a floor of 0.52912 rather
 * than the 0.52926 the rounded factors give: a difference of 0.03%, far inside the
 * analytical tolerance, and the exact figure is the one used here.
 *
 * This is a physical floor for the process CO2 implied by an oxide analysis. It is not
 * a notified emission factor, and it does not decide what the scheme requires.
 */

/** Atomic masses (IUPAC), g/mol. */
const M = { Ca: 40.078, Mg: 24.305, C: 12.011, O: 15.999 } as const;

const M_CO2 = M.C + 2 * M.O;
const M_CAO = M.Ca + M.O;
const M_MGO = M.Mg + M.O;

/** kg CO2 per kg CaO in decomposed carbonate. About 0.785. */
export const CO2_PER_CAO = M_CO2 / M_CAO;
/** kg CO2 per kg MgO in decomposed carbonate. About 1.092. */
export const CO2_PER_MGO = M_CO2 / M_MGO;

/** The floor per tonne of clinker, tCO2/t, from fractional oxide contents (0 to 1). */
export function stoichiometricCalcinationFloor(caoFraction: number, mgoFraction: number): number {
  return CO2_PER_CAO * caoFraction + CO2_PER_MGO * mgoFraction;
}

export interface OxideTest {
  /** CaO as a fraction of clinker mass, 0 to 1. */
  caoFraction: number;
  /** MgO as a fraction of clinker mass, 0 to 1. */
  mgoFraction: number;
  /** The factor the workbook or run declares, tCO2 per tonne of clinker. */
  declaredFactor: number;
  /**
   * Share by which the declared factor may fall below the floor before it is called
   * impossible. The oxides are analytical results with their own uncertainty, so a
   * small margin is allowed rather than a strict equality.
   */
  tolerance?: number;
}

export type OxideVerdict =
  | { status: "impossible"; floor: number; shortfall: number; detail: string }
  | { status: "possible"; floor: number; headroom: number; detail: string }
  | { status: "not_applicable"; detail: string };

export const DEFAULT_OXIDE_TOLERANCE = 0.02;

/**
 * Compare a declared calcination factor with the chemical floor. A factor below the
 * floor by more than the tolerance cannot come from this clinker, whatever the plant
 * says: the carbon was in the carbonate or it was not.
 */
export function checkOxideFloor(test: OxideTest): OxideVerdict {
  const { caoFraction, mgoFraction, declaredFactor } = test;
  const tolerance = test.tolerance ?? DEFAULT_OXIDE_TOLERANCE;
  if (![caoFraction, mgoFraction, declaredFactor].every((n) => Number.isFinite(n))) {
    return { status: "not_applicable", detail: "The oxide analysis or the declared calcination factor was not available as a number." };
  }
  if (caoFraction < 0 || caoFraction > 1 || mgoFraction < 0 || mgoFraction > 1) {
    return {
      status: "not_applicable",
      detail: `CaO ${caoFraction} and MgO ${mgoFraction} are not fractions of clinker mass, so the floor cannot be computed from them.`,
    };
  }
  if (declaredFactor < 0) {
    return { status: "not_applicable", detail: "A negative calcination factor is not a measurement." };
  }

  const floor = stoichiometricCalcinationFloor(caoFraction, mgoFraction);
  const allowed = floor * (1 - tolerance);
  if (declaredFactor < allowed) {
    const shortfall = floor - declaredFactor;
    return {
      status: "impossible",
      floor,
      shortfall,
      detail:
        `CaO ${pct(caoFraction)} and MgO ${pct(mgoFraction)} of clinker set a floor of ${round4(floor)} tCO2 per tonne of clinker; ` +
        `the declared ${round4(declaredFactor)} is ${round4(shortfall)} below it, more than the ${Math.round(tolerance * 100)}% analytical tolerance. ` +
        `Carbonate decomposition cannot be held below the carbon the oxides came from. Either the oxide analysis, the clinker basis or the factor is wrong.`,
    };
  }
  return {
    status: "possible",
    floor,
    headroom: declaredFactor - floor,
    detail:
      `The declared ${round4(declaredFactor)} tCO2 per tonne of clinker is not below the floor of ${round4(floor)} set by ` +
      `CaO ${pct(caoFraction)} and MgO ${pct(mgoFraction)}.`,
  };
}

/**
 * The factor implied by an oxide analysis, tCO2 per tonne of clinker, ignoring any raw
 * meal substitution. Used where a plant reports oxides but no calcination figure.
 */
export function impliedCalcinationFactor(caoFraction: number, mgoFraction: number): number {
  return stoichiometricCalcinationFloor(caoFraction, mgoFraction);
}

const pct = (f: number) => `${(f * 100).toFixed(2)}%`;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

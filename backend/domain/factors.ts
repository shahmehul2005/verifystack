/**
 * Reference data: emission factors, calorific value defaults, plausibility ranges.
 *
 * IMPORTANT — every entry carries a `verified` flag and a `source`.
 * Values marked `verified: false` are PLACEHOLDERS for development only. They must be
 * replaced with values read directly from the authoritative published source before any
 * output is shown to a verifier. The calculation engine refuses unverified factors
 * unless explicitly run in draft mode.
 */

import type { Quantity, Unit } from "./units";

export interface FactorRecord {
  id: string;
  label: string;
  value: number;
  unit: Unit;
  /** Compliance year / publication vintage this factor applies to, e.g. "FY2025-26". */
  vintage: string;
  source: string;
  /** False until a human has checked this against the published source document. */
  verified: boolean;
  notes?: string;
}

/** Indexed by `${id}::${vintage}`. */
function key(id: string, vintage: string) {
  return `${id}::${vintage}`;
}

/**
 * CEA grid emission factor, used for Scope 2.
 * Using the wrong vintage is a recurring verification finding, so vintage is mandatory.
 */
export const GRID_FACTORS: FactorRecord[] = [
  {
    id: "cea_grid_ef",
    label: "CEA national grid emission factor",
    value: 0.716,
    unit: "tCO2e/MWh",
    vintage: "FY2024-25",
    source: "CEA CO2 Baseline Database — REPLACE WITH PUBLISHED VALUE",
    verified: false,
    notes: "Placeholder. Read the exact figure from the CEA baseline database version applicable to the compliance year.",
  },
  {
    id: "cea_grid_ef",
    label: "CEA national grid emission factor",
    value: 0.716,
    unit: "tCO2e/MWh",
    vintage: "FY2025-26",
    source: "CEA CO2 Baseline Database — REPLACE WITH PUBLISHED VALUE",
    verified: false,
    notes: "Placeholder. Must be confirmed for the FY2025-26 compliance cycle.",
  },
];

/**
 * Fuel combustion emission factors (Type I / IPCC default style).
 * Expressed per unit of energy so they compose with NCV cleanly.
 */
export const FUEL_EMISSION_FACTORS: FactorRecord[] = [
  {
    id: "ef_coal_bituminous",
    label: "Bituminous coal",
    value: 94.6,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 — VERIFY",
    verified: false,
  },
  {
    id: "ef_coal_subbituminous",
    label: "Sub-bituminous coal",
    value: 96.1,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 — VERIFY",
    verified: false,
  },
  {
    id: "ef_lignite",
    label: "Lignite",
    value: 101.0,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 — VERIFY",
    verified: false,
  },
  {
    id: "ef_natural_gas",
    label: "Natural gas",
    value: 56.1,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 — VERIFY",
    verified: false,
  },
  {
    id: "ef_furnace_oil",
    label: "Residual fuel oil / furnace oil",
    value: 77.4,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 — VERIFY",
    verified: false,
  },
  {
    id: "ef_diesel",
    label: "Diesel / gas oil",
    value: 74.1,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 — VERIFY",
    verified: false,
  },
  {
    id: "ef_petcoke",
    label: "Petroleum coke",
    value: 97.5,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 — VERIFY",
    verified: false,
  },
  {
    id: "ef_coal_coking",
    label: "Coking coal",
    value: 94.6,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 (Coking Coal) — TO VERIFY",
    verified: false,
    notes:
      "Placeholder. Read the Coking Coal row of IPCC 2006 Vol.2 Ch.1 Table 1.4 / Vol.2 Table 2.2 before use.",
  },
  {
    id: "ef_coke_oven_coke",
    label: "Coke oven coke / metallurgical coke",
    value: 107.0,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 (Coke Oven Coke) — TO VERIFY",
    verified: false,
    notes:
      "Placeholder for Iron & Steel and Foundry. Confirm against the IPCC 2006 Coke Oven Coke row.",
  },
  {
    id: "ef_lpg",
    label: "Liquefied petroleum gas",
    value: 63.1,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 (LPG) — TO VERIFY",
    verified: false,
  },
  {
    id: "ef_naphtha",
    label: "Naphtha",
    value: 73.3,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 (Naphtha) — TO VERIFY",
    verified: false,
  },
  {
    id: "ef_refinery_gas",
    label: "Refinery gas / still gas",
    value: 57.6,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 (Refinery Gas) — TO VERIFY",
    verified: false,
    notes:
      "Placeholder. Confirm the CCTS refining row (still gas vs refinery gas) before use.",
  },
  {
    id: "ef_charcoal",
    label: "Charcoal (biomass carbon)",
    value: 112.0,
    unit: "tCO2e/TJ",
    vintage: "IPCC2006",
    source: "IPCC 2006 GL Vol.2 Table 2.2 (Charcoal) — TO VERIFY",
    verified: false,
    notes:
      "Biogenic CO2 reporting treatment differs from fossil CO2. Confirm the CCTS treatment before including in a compliance total.",
  },
];

/**
 * Process and reductant emission factors for sectors where a material share of
 * emissions is not combustion. Every value here is a placeholder.
 */
export const PROCESS_EMISSION_FACTORS: FactorRecord[] = [
  {
    id: "ef_prebaked_anode",
    label: "Prebaked anode carbon consumption (aluminium smelting)",
    value: 1.5,
    unit: "tCO2e/t",
    vintage: "IPCC2006",
    source:
      "IPCC 2006 GL Vol.3 Ch.4 (Metal Industry — Aluminium Production) — TO VERIFY",
    verified: false,
    notes:
      "Placeholder tCO2e per tonne of net anode consumed. The IPCC Tier 1/Tier 2 anode formulae depend on anode composition (sulphur, ash) — derive per the published equation rather than using this default in a filed report.",
  },
  {
    id: "ef_pfc_anode_effect",
    label: "PFC emissions from anode effects (aluminium smelting)",
    value: 0,
    unit: "tCO2e/t",
    vintage: "TO-VERIFY",
    source:
      "IPCC 2006 GL Vol.3 Ch.4.4 (PFC emissions from aluminium production) — TO VERIFY",
    verified: false,
    notes:
      "DELIBERATELY ZERO — not a real value. PFC (CF4/C2F6) emissions depend on cell technology and measured anode-effect minutes/frequency per cell-day, and must be derived from the slope/overvoltage method with a GWP set stated by the methodology. A run using this factor understates emissions and must not be filed.",
  },
  {
    id: "ef_clinker_calcination",
    label: "Clinker calcination process CO2",
    value: 0.525,
    unit: "tCO2e/t",
    vintage: "TO-VERIFY",
    source: "CCTS Detailed Procedure / IPCC 2006 Vol.3 Ch.2 — TO VERIFY",
    verified: false,
    notes:
      "Placeholder tCO2e per tonne clinker. Cement runs currently supply calcination as a process_direct quantity instead of using this factor.",
  },
  {
    id: "ef_steel_reductant_carbon",
    label: "Carbon in reductants and carbon-bearing inputs (iron & steel)",
    value: 3.664,
    unit: "tCO2e/t",
    vintage: "STOICHIOMETRIC",
    source:
      "Stoichiometric ratio 44/12 for complete oxidation of elemental carbon — TO VERIFY its applicability under the CCTS Iron & Steel methodology",
    verified: false,
    notes:
      "This is the exact mass ratio of CO2 to C (3.6642). It is only correct when applied to the CARBON CONTENT of the input, not to the gross mass of the input. Confirm the mass-balance boundary in the sector methodology before use.",
  },
  {
    id: "ef_ammonia_feedstock",
    label: "Ammonia / urea feedstock process CO2",
    value: 0,
    unit: "tCO2e/t",
    vintage: "TO-VERIFY",
    source: "IPCC 2006 GL Vol.3 Ch.3 (Ammonia Production) — TO VERIFY",
    verified: false,
    notes:
      "DELIBERATELY ZERO — not a combustion factor. Fertilizer process CO2 is supplied as a process_direct tCO2e quantity from the feedstock carbon balance. Using this factor as a multiplier understates the total.",
  },
  {
    id: "ef_hydrogen_process",
    label: "Hydrogen production process CO2",
    value: 0,
    unit: "tCO2e/t",
    vintage: "TO-VERIFY",
    source: "IPCC 2006 GL Vol.3 — hydrogen production / chlor-alkali (TO VERIFY)",
    verified: false,
    notes:
      "DELIBERATELY ZERO — registered so the pack browser can cite the stream. The engine consumes a process_direct tCO2e quantity, not this factor.",
  },
];

/**
 * Energy content (calorific value) defaults for the ADEETIE fuel set.
 *
 * These convert an invoiced fuel quantity into energy so that a Specific Energy
 * Consumption figure can be formed. A lab-tested value on a certificate always
 * takes precedence over these; they exist so an SEC baseline can be produced at
 * all when a small enterprise has no fuel testing regime.
 *
 * Mass-basis entries are `specific_energy`; volume-basis entries are
 * `energy_density`. The dimension is what stops a kL of diesel being multiplied
 * by a per-kg calorific value.
 */
export const ENERGY_CONTENT_FACTORS: FactorRecord[] = [
  {
    id: "ec_coal_indian",
    label: "Indian non-coking coal, gross calorific value",
    value: 4_000,
    unit: "kcal/kg",
    vintage: "TO-VERIFY",
    source:
      "BEE / Coal India grade-band GCV declaration — TO VERIFY",
    verified: false,
    notes:
      "Indian coal GCV is graded (G1-G17) and varies from roughly 2,200 to 7,000 kcal/kg. Use the grade stated on the invoice or a lab certificate. This mid-band placeholder must not be used for a filed baseline.",
  },
  {
    id: "ec_coke",
    label: "Metallurgical / hard coke, gross calorific value",
    value: 6_500,
    unit: "kcal/kg",
    vintage: "TO-VERIFY",
    source: "BEE General Guidelines for Energy Audit, energy conversion table — TO VERIFY",
    verified: false,
  },
  {
    id: "ec_png",
    label: "Piped natural gas, gross calorific value per standard cubic metre",
    value: 8_500,
    unit: "kcal/SCM",
    vintage: "TO-VERIFY",
    source: "City gas distributor GCV declaration on the PNG invoice — TO VERIFY",
    verified: false,
    notes:
      "PNG GCV is printed on the monthly invoice by most city gas distributors and varies by network. Read it from the bill in preference to this default.",
  },
  {
    id: "ec_lpg",
    label: "Liquefied petroleum gas, gross calorific value",
    value: 11_000,
    unit: "kcal/kg",
    vintage: "TO-VERIFY",
    source: "BEE General Guidelines for Energy Audit, energy conversion table — TO VERIFY",
    verified: false,
  },
  {
    id: "ec_furnace_oil",
    label: "Furnace oil, gross calorific value (mass basis)",
    value: 10_000,
    unit: "kcal/kg",
    vintage: "TO-VERIFY",
    source: "BEE General Guidelines for Energy Audit, energy conversion table — TO VERIFY",
    verified: false,
    notes:
      "Furnace oil is invoiced in both kL and tonnes. Where it is invoiced in kL, use ec_furnace_oil_volume; converting between the two needs a measured density.",
  },
  {
    id: "ec_furnace_oil_volume",
    label: "Furnace oil, gross calorific value (volume basis)",
    value: 9_600,
    unit: "kcal/L",
    vintage: "TO-VERIFY",
    source:
      "Derived from a nominal furnace oil density near 0.96 kg/L — TO VERIFY against the supplier test report",
    verified: false,
    notes:
      "Density-dependent. Prefer a mass-basis invoice, or read the density from the supplier's test certificate.",
  },
  {
    id: "ec_diesel",
    label: "High speed diesel, gross calorific value (volume basis)",
    value: 8_800,
    unit: "kcal/L",
    vintage: "TO-VERIFY",
    source: "BEE General Guidelines for Energy Audit, energy conversion table — TO VERIFY",
    verified: false,
    notes: "Diesel is invoiced in litres or kL at Indian retail outlets.",
  },
  {
    id: "ec_biomass_briquette",
    label: "Biomass briquette, gross calorific value",
    value: 3_800,
    unit: "kcal/kg",
    vintage: "TO-VERIFY",
    source: "TO VERIFY — biomass calorific value varies widely with species and moisture",
    verified: false,
    notes:
      "Moisture content dominates. A lab certificate is effectively mandatory for a defensible biomass baseline.",
  },
];

/** Fuels whose energy content is declared on a volume basis. */
export const VOLUME_BASIS_ENERGY_FACTOR_IDS = new Set<string>([
  "ec_png",
  "ec_diesel",
  "ec_furnace_oil_volume",
]);

/**
 * IPCC default gross-to-net calorific value conversion, as referenced by the
 * CCTS Detailed Procedure when a lab-tested NCV is unavailable.
 */
export const GCV_TO_NCV_DEFAULT = {
  solid: 0.95,
  liquid: 0.95,
  gaseous: 0.9,
} as const;

export type FuelPhase = keyof typeof GCV_TO_NCV_DEFAULT;

/**
 * Physical plausibility ranges for net calorific value, in MJ/kg.
 * These are deliberately generous — they exist to catch unit errors and
 * transcription mistakes, not to second-guess a lab.
 */
export const NCV_PLAUSIBLE_RANGE: Record<string, { minMJkg: number; maxMJkg: number; phase: FuelPhase }> = {
  coal_indian: { minMJkg: 7, maxMJkg: 28, phase: "solid" },
  coal_imported: { minMJkg: 18, maxMJkg: 32, phase: "solid" },
  lignite: { minMJkg: 5, maxMJkg: 18, phase: "solid" },
  petcoke: { minMJkg: 28, maxMJkg: 38, phase: "solid" },
  biomass: { minMJkg: 8, maxMJkg: 20, phase: "solid" },
  furnace_oil: { minMJkg: 36, maxMJkg: 44, phase: "liquid" },
  diesel: { minMJkg: 40, maxMJkg: 46, phase: "liquid" },
  natural_gas: { minMJkg: 42, maxMJkg: 55, phase: "gaseous" },
};

/**
 * Mandated minimum sampling frequency from the CCTS Detailed Procedure.
 * Used by the sampling-frequency reconciliation rule.
 */
export const SAMPLING_MANDATE = {
  coal: { perMonth: 1, perTonnes: 20_000 },
  raw_material: { perMonth: 1, perTonnes: 50_000 },
} as const;

/** Default materiality threshold for GHG assertions. */
export const DEFAULT_MATERIALITY_PCT = 5;

export interface FactorSet {
  /** Bumped whenever any factor value changes. Recorded on every calculation run. */
  version: string;
  records: Map<string, FactorRecord>;
}

/** Every factor known to the system, in registration order. */
export const ALL_FACTOR_RECORDS: FactorRecord[] = [
  ...GRID_FACTORS,
  ...FUEL_EMISSION_FACTORS,
  ...PROCESS_EMISSION_FACTORS,
  ...ENERGY_CONTENT_FACTORS,
];

export function buildFactorSet(version = "dev-0.1.0"): FactorSet {
  const records = new Map<string, FactorRecord>();
  for (const r of ALL_FACTOR_RECORDS) {
    records.set(key(r.id, r.vintage), r);
  }
  return { version, records };
}

/**
 * Factor verification.
 *
 * A factor becomes `verified` only when a human records the source they read it
 * from. This produces a new FactorSet rather than mutating the module-level
 * records, so a calculation run can never see a factor change under it.
 */
export interface FactorVerification {
  factorId: string;
  vintage: string;
  /** Citation the verifier actually read. Free text is accepted; emptiness is not. */
  citedSource: string;
  /** Value as read from the cited source, where it differs from the placeholder. */
  correctedValue?: number;
  verifiedBy: string;
  /** ISO timestamp supplied by the caller. This module never reads the clock. */
  verifiedAt: string;
}

export class FactorVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactorVerificationError";
  }
}

const UNVERIFIED_SOURCE_MARKERS = ["TO VERIFY", "VERIFY", "REPLACE WITH"];

/**
 * Apply verifications to a factor set, returning a new set with a new version.
 * The version string changes so that runs made before and after a verification
 * are never confused with one another.
 */
export function applyVerifications(
  set: FactorSet,
  verifications: FactorVerification[],
  nextVersion: string
): FactorSet {
  const records = new Map(set.records);
  for (const v of verifications) {
    const k = key(v.factorId, v.vintage);
    const existing = records.get(k);
    if (!existing) {
      throw new FactorVerificationError(
        `Cannot verify unknown factor "${v.factorId}" (${v.vintage}).`
      );
    }
    if (!v.citedSource || v.citedSource.trim().length < 12) {
      throw new FactorVerificationError(
        `Factor "${v.factorId}" cannot be verified without a cited source ` +
          `(at least 12 characters — the publication, table and edition).`
      );
    }
    if (
      UNVERIFIED_SOURCE_MARKERS.some((m) => v.citedSource.toUpperCase().includes(m))
    ) {
      throw new FactorVerificationError(
        `Cited source for "${v.factorId}" still carries a TO VERIFY marker. ` +
          `Record the publication actually read.`
      );
    }
    if (v.correctedValue !== undefined && !Number.isFinite(v.correctedValue)) {
      throw new FactorVerificationError(
        `Corrected value for "${v.factorId}" must be a finite number.`
      );
    }
    records.set(k, {
      ...existing,
      value: v.correctedValue ?? existing.value,
      source: v.citedSource,
      verified: true,
      notes: `Verified by ${v.verifiedBy} at ${v.verifiedAt}.`,
    });
  }
  return { version: nextVersion, records };
}

export function listFactors(set: FactorSet): FactorRecord[] {
  return [...set.records.values()];
}

export function unverifiedFactors(set: FactorSet): FactorRecord[] {
  return listFactors(set).filter((r) => !r.verified);
}

export class FactorLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactorLookupError";
  }
}

export function getFactor(set: FactorSet, id: string, vintage: string): FactorRecord {
  const found = set.records.get(key(id, vintage));
  if (!found) {
    const available = [...set.records.values()]
      .filter((r) => r.id === id)
      .map((r) => r.vintage);
    throw new FactorLookupError(
      `No factor "${id}" for vintage "${vintage}". Available vintages: ${
        available.length ? available.join(", ") : "none"
      }`
    );
  }
  return found;
}

export function factorQuantity(r: FactorRecord): Quantity {
  return { value: r.value, unit: r.unit };
}

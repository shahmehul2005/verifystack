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
];

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

export function buildFactorSet(version = "dev-0.1.0"): FactorSet {
  const records = new Map<string, FactorRecord>();
  for (const r of [...GRID_FACTORS, ...FUEL_EMISSION_FACTORS]) {
    records.set(key(r.id, r.vintage), r);
  }
  return { version, records };
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

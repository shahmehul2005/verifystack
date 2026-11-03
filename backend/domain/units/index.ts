/**
 * Unit registry and dimension-checked conversion.
 *
 * Unit confusion is one of the most common material errors in GHG verification
 * (kcal/kg vs MJ/kg, GCV vs NCV, t vs kg). Every quantity in this system carries
 * its unit, and conversion across dimensions is impossible by construction.
 */

export type Dimension =
  | "mass"
  | "volume"
  | "energy"
  /** Energy per unit mass, e.g. a calorific value on a lab certificate. */
  | "specific_energy"
  /** Energy per unit volume, e.g. PNG billed in SCM or diesel billed in kL. */
  | "energy_density"
  /** Real power. Not energy: kW x h is energy, kW alone is a rate. */
  | "power"
  /**
   * Apparent power (kVA). Deliberately its own dimension: contracted demand and
   * maximum demand on an Indian HT bill are kVA figures and must never be summed
   * into an energy total. Converting kVA to any energy unit throws.
   */
  | "apparent_power"
  /** Emissions per unit of energy, e.g. an IPCC fuel factor. */
  | "emission_factor"
  /** Emissions per unit of material mass, e.g. process CO2 per tonne of clinker. */
  | "emission_intensity_mass"
  | "emissions"
  | "dimensionless";

export type Unit =
  // mass
  | "kg"
  | "g"
  | "t"
  | "kt"
  // volume
  | "L"
  | "kL"
  | "m3"
  /** Standard cubic metre, as PNG is billed. Treated as m3 at standard conditions. */
  | "SCM"
  // energy
  | "MJ"
  | "kJ"
  | "GJ"
  | "TJ"
  | "kcal"
  | "Mcal"
  | "Gcal"
  | "kWh"
  | "MWh"
  | "GWh"
  | "toe"
  | "ktoe"
  // specific energy (calorific value)
  | "MJ/kg"
  | "kJ/kg"
  | "kcal/kg"
  | "GJ/t"
  | "Gcal/t"
  // energy density (calorific value on a volume basis)
  | "MJ/m3"
  | "MJ/SCM"
  | "kcal/SCM"
  | "kcal/m3"
  | "MJ/L"
  | "kcal/L"
  | "GJ/kL"
  // power
  | "kW"
  | "MW"
  // apparent power
  | "kVA"
  | "MVA"
  // emission factor
  | "kgCO2e/MJ"
  | "tCO2e/TJ"
  | "tCO2e/MWh"
  | "kgCO2e/kWh"
  // emission intensity on a material mass basis
  | "kgCO2e/kg"
  | "tCO2e/t"
  | "kgCO2e/t"
  // emissions
  | "kgCO2e"
  | "tCO2e";

interface UnitDef {
  dimension: Dimension;
  /** Multiplier to convert a value in this unit into the canonical unit of its dimension. */
  toCanonical: number;
}

/** Canonical unit per dimension. All internal maths happens in these. */
export const CANONICAL: Record<Dimension, Unit | null> = {
  mass: "kg",
  volume: "m3",
  energy: "MJ",
  specific_energy: "MJ/kg",
  energy_density: "MJ/m3",
  power: "kW",
  apparent_power: "kVA",
  emission_factor: "kgCO2e/MJ",
  emission_intensity_mass: "kgCO2e/kg",
  emissions: "kgCO2e",
  dimensionless: null,
};

const KCAL_TO_KJ = 4.1868; // ISO thermochemical kcal
/** IEA definition: 1 tonne of oil equivalent = 41.868 GJ. */
const TOE_TO_MJ = 41_868;

const UNITS: Record<Unit, UnitDef> = {
  // mass -> kg
  kg: { dimension: "mass", toCanonical: 1 },
  g: { dimension: "mass", toCanonical: 0.001 },
  t: { dimension: "mass", toCanonical: 1_000 },
  kt: { dimension: "mass", toCanonical: 1_000_000 },

  // volume -> m3
  m3: { dimension: "volume", toCanonical: 1 },
  L: { dimension: "volume", toCanonical: 0.001 },
  kL: { dimension: "volume", toCanonical: 1 },
  SCM: { dimension: "volume", toCanonical: 1 },

  // energy -> MJ
  MJ: { dimension: "energy", toCanonical: 1 },
  kJ: { dimension: "energy", toCanonical: 0.001 },
  GJ: { dimension: "energy", toCanonical: 1_000 },
  TJ: { dimension: "energy", toCanonical: 1_000_000 },
  kcal: { dimension: "energy", toCanonical: KCAL_TO_KJ / 1000 },
  Mcal: { dimension: "energy", toCanonical: KCAL_TO_KJ },
  Gcal: { dimension: "energy", toCanonical: KCAL_TO_KJ * 1000 },
  kWh: { dimension: "energy", toCanonical: 3.6 },
  MWh: { dimension: "energy", toCanonical: 3_600 },
  GWh: { dimension: "energy", toCanonical: 3_600_000 },
  toe: { dimension: "energy", toCanonical: TOE_TO_MJ },
  ktoe: { dimension: "energy", toCanonical: TOE_TO_MJ * 1_000 },

  // specific energy -> MJ/kg
  "MJ/kg": { dimension: "specific_energy", toCanonical: 1 },
  "kJ/kg": { dimension: "specific_energy", toCanonical: 0.001 },
  "kcal/kg": { dimension: "specific_energy", toCanonical: KCAL_TO_KJ / 1000 },
  "GJ/t": { dimension: "specific_energy", toCanonical: 1 }, // 1000 MJ / 1000 kg
  "Gcal/t": { dimension: "specific_energy", toCanonical: KCAL_TO_KJ },

  // energy density -> MJ/m3
  "MJ/m3": { dimension: "energy_density", toCanonical: 1 },
  "MJ/SCM": { dimension: "energy_density", toCanonical: 1 },
  "kcal/SCM": { dimension: "energy_density", toCanonical: KCAL_TO_KJ / 1000 },
  "kcal/m3": { dimension: "energy_density", toCanonical: KCAL_TO_KJ / 1000 },
  "MJ/L": { dimension: "energy_density", toCanonical: 1_000 },
  "kcal/L": { dimension: "energy_density", toCanonical: KCAL_TO_KJ },
  "GJ/kL": { dimension: "energy_density", toCanonical: 1_000 }, // 1000 MJ per 1 m3

  // power -> kW
  kW: { dimension: "power", toCanonical: 1 },
  MW: { dimension: "power", toCanonical: 1_000 },

  // apparent power -> kVA
  kVA: { dimension: "apparent_power", toCanonical: 1 },
  MVA: { dimension: "apparent_power", toCanonical: 1_000 },

  // emission factor -> kgCO2e/MJ
  "kgCO2e/MJ": { dimension: "emission_factor", toCanonical: 1 },
  "tCO2e/TJ": { dimension: "emission_factor", toCanonical: 0.001 }, // 1 t/TJ = 1 kg/GJ = 0.001 kg/MJ
  "tCO2e/MWh": { dimension: "emission_factor", toCanonical: 1000 / 3600 },
  "kgCO2e/kWh": { dimension: "emission_factor", toCanonical: 1 / 3.6 },

  // emission intensity (mass basis) -> kgCO2e/kg
  "kgCO2e/kg": { dimension: "emission_intensity_mass", toCanonical: 1 },
  "tCO2e/t": { dimension: "emission_intensity_mass", toCanonical: 1 }, // 1000 kg / 1000 kg
  "kgCO2e/t": { dimension: "emission_intensity_mass", toCanonical: 0.001 },

  // emissions -> kgCO2e
  kgCO2e: { dimension: "emissions", toCanonical: 1 },
  tCO2e: { dimension: "emissions", toCanonical: 1_000 },
};

/** A number that knows what it is. */
export interface Quantity {
  value: number;
  unit: Unit;
}

export function qty(value: number, unit: Unit): Quantity {
  if (!Number.isFinite(value)) {
    throw new UnitError(`Quantity value must be finite, received ${value}`);
  }
  return { value, unit };
}

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitError";
  }
}

export function dimensionOf(unit: Unit): Dimension {
  const def = UNITS[unit];
  if (!def) throw new UnitError(`Unknown unit: ${unit}`);
  return def.dimension;
}

/**
 * Convert between units of the same dimension.
 * Throws on cross-dimension conversion rather than silently coercing.
 */
export function convert(q: Quantity, to: Unit): Quantity {
  const from = UNITS[q.unit];
  const target = UNITS[to];
  if (!from) throw new UnitError(`Unknown source unit: ${q.unit}`);
  if (!target) throw new UnitError(`Unknown target unit: ${to}`);
  if (from.dimension !== target.dimension) {
    throw new UnitError(
      `Cannot convert ${q.unit} (${from.dimension}) to ${to} (${target.dimension}) — dimension mismatch`
    );
  }
  return { value: (q.value * from.toCanonical) / target.toCanonical, unit: to };
}

/** Convert to the canonical unit of the quantity's dimension. */
export function toCanonical(q: Quantity): Quantity {
  const dim = dimensionOf(q.unit);
  const canonical = CANONICAL[dim];
  if (!canonical) throw new UnitError(`Dimension ${dim} has no canonical unit`);
  return convert(q, canonical);
}

/**
 * Parse a unit string as it might appear on an Indian invoice or lab certificate.
 * Returns null rather than guessing — unknown units must reach a human.
 */
export function parseUnit(raw: string): Unit | null {
  const normalized = raw
    .trim()
    .replace(/\s+/g, "")
    .replace(/per/gi, "/")
    .replace(/co2e?/gi, "CO2e");

  const aliases: Record<string, Unit> = {
    kg: "kg",
    kgs: "kg",
    kilogram: "kg",
    kilograms: "kg",
    g: "g",
    gram: "g",
    t: "t",
    mt: "t",
    ton: "t",
    tons: "t",
    tonne: "t",
    tonnes: "t",
    te: "t",
    kt: "kt",
    l: "L",
    ltr: "L",
    ltrs: "L",
    litre: "L",
    litres: "L",
    liter: "L",
    liters: "L",
    kl: "kL",
    kilolitre: "kL",
    kilolitres: "kL",
    m3: "m3",
    "m^3": "m3",
    cum: "m3",
    scm: "SCM",
    sm3: "SCM",
    // "Nm3" is deliberately absent: normal (0 degC) and standard (15 degC) cubic
    // metres differ by roughly 5%, so it must reach a human rather than be aliased.
    mj: "MJ",
    kj: "kJ",
    gj: "GJ",
    tj: "TJ",
    kcal: "kcal",
    mcal: "Mcal",
    gcal: "Gcal",
    kwh: "kWh",
    mwh: "MWh",
    gwh: "GWh",
    units: "kWh", // Indian electricity bills commonly say "units"
    // "kVAh" is deliberately absent: apparent energy differs from active energy by
    // the power factor, so it must reach a human rather than be read as kWh.
    toe: "toe",
    ktoe: "ktoe",
    kw: "kW",
    mw: "MW",
    kva: "kVA",
    mva: "MVA",
    "mj/kg": "MJ/kg",
    "kj/kg": "kJ/kg",
    "kcal/kg": "kcal/kg",
    "gj/t": "GJ/t",
    "gj/tonne": "GJ/t",
    "gcal/t": "Gcal/t",
    "gcal/tonne": "Gcal/t",
    "mj/m3": "MJ/m3",
    "mj/scm": "MJ/SCM",
    "kcal/scm": "kcal/SCM",
    "kcal/m3": "kcal/m3",
    "mj/l": "MJ/L",
    "mj/litre": "MJ/L",
    "kcal/l": "kcal/L",
    "gj/kl": "GJ/kL",
    "kgCO2e/mj": "kgCO2e/MJ",
    "tCO2e/tj": "tCO2e/TJ",
    "tCO2e/mwh": "tCO2e/MWh",
    "kgCO2e/kwh": "kgCO2e/kWh",
    "kgCO2e": "kgCO2e",
    "tCO2e": "tCO2e",
  };

  return aliases[normalized.toLowerCase()] ?? aliases[normalized] ?? null;
}

import type { Unit } from "../units";
import type { FuelPhase } from "../factors";

export type PackScheme = "CCTS" | "ADEETIE";
export type PackStatus = "runnable" | "scaffold";
export type CalculationMethod = "GEI" | "SEC" | "TBD";

export interface PackDocType {
  id: string;
  label: string;
  extractable: boolean;
  notes?: string;
}

export interface PackClauseCitation {
  ruleId: string;
  clauseRef: string;
}

export interface PackFactorRef {
  factorKey: string;
  vintage: string;
  role: "grid" | "fuel" | "energy" | "process";
}

/**
 * How a fact reaches a calculation input.
 *
 * `path` is matched against `extracted_fact.field_path`. `units` lists the units
 * the binding will accept from the fact as printed; anything else falls back to
 * `defaultUnit`, which keeps a mislabelled unit from silently changing dimension.
 */
export interface PackQuantityBinding {
  path: string;
  units: Unit[];
  defaultUnit: Unit;
}

export type PackStreamKind =
  | "fuel_combustion"
  | "electricity_import"
  | "process_direct";

interface PackStreamBindingBase {
  streamId: string;
  label: string;
  quantity: PackQuantityBinding;
  /**
   * When true, a run fails if the fact is absent. When false, the stream is
   * simply omitted — appropriate where a plant may genuinely not use the fuel.
   */
  required?: boolean;
}

export interface PackFuelStreamBinding extends PackStreamBindingBase {
  kind: "fuel_combustion";
  calorificValue: PackQuantityBinding;
  /**
   * Explicit calorific basis. When omitted, the basis is read from
   * `calorificBasisPath` if present, and otherwise inferred from the unit as
   * printed (a kcal/kg figure on an Indian fuel invoice is conventionally gross).
   */
  calorificBasis?: "NCV" | "GCV";
  calorificBasisPath?: string;
  factorKey: string;
  factorVintage: string;
  phase: FuelPhase;
  oxidationFactor?: number;
}

export interface PackElectricityStreamBinding extends PackStreamBindingBase {
  kind: "electricity_import";
  factorKey: string;
  factorVintage: string;
}

/**
 * A stream whose emissions are supplied as a quantity of CO2e computed under a
 * named sector methodology, rather than derived from an activity and a factor.
 */
export interface PackProcessStreamBinding extends PackStreamBindingBase {
  kind: "process_direct";
  methodologyRef: string;
}

export type PackStreamBinding =
  | PackFuelStreamBinding
  | PackElectricityStreamBinding
  | PackProcessStreamBinding;

/** The GEI or SEC denominator. */
export interface PackProductionBinding {
  path: string;
  units: Unit[];
  defaultUnit: Unit;
  /** e.g. "tonne_crude_steel". Appears in the run record and on the report. */
  productUnitLabel: string;
  /** Human label for the product, e.g. "Crude steel". */
  productLabel: string;
}

export type PackEnergyStreamKind =
  | "electricity"
  | "fuel_mass"
  | "fuel_volume"
  | "thermal_direct";

/**
 * How a fact becomes an energy stream in an SEC calculation. The mass/volume
 * split is carried here so the pack, not the code, decides whether a fuel is
 * invoiced by weight or by volume.
 */
export interface PackEnergyBinding {
  kind: PackEnergyStreamKind;
  streamId: string;
  label: string;
  quantity: PackQuantityBinding;
  /** Fact path for a measured calorific value, preferred over the registry default. */
  calorificValue?: PackQuantityBinding;
  /** Registry fallback when no measured calorific value is present. */
  factorKey?: string;
  factorVintage?: string;
  energyContentBasis?: "NCV" | "GCV";
  phase?: FuelPhase;
  methodologyRef?: string;
  onSiteGeneration?: boolean;
  required?: boolean;
}

/** Apparent-power fields read off an electricity bill. Never summed into energy. */
export interface PackDemandBinding {
  contractedDemand?: PackQuantityBinding;
  maximumDemand?: PackQuantityBinding;
}

/** Reporting conventions for the SEC method. */
export interface PackSecConfig {
  /** Unit the total energy input is normalised to before dividing by output. */
  reportingEnergyUnit: Extract<Unit, "GJ" | "toe" | "MJ" | "kWh">;
  /** Displayed intensity unit, e.g. "GJ/t". */
  secUnitLabel: string;
  /** Minimum savings percentage the scheme requires, where one applies. */
  minSavingsPct?: number;
}

/** ADEETIE-specific pack metadata. */
export interface PackAdeetieConfig {
  /** Notified clusters for this sector. Empty means none recorded yet. */
  clusters: PackCluster[];
  /** Source note for the cluster list. */
  clusterSource: string;
  clustersVerified: boolean;
}

export interface PackCluster {
  state: string;
  cluster: string;
}

export interface MethodologyPack {
  pack_id: string;
  scheme: PackScheme;
  sector_or_cluster: string;
  status: PackStatus;
  version: string;
  document_taxonomy: PackDocType[];
  field_schemas: Record<string, string>;
  calculation_method: CalculationMethod;
  emission_or_energy_factors: PackFactorRef[];
  /**
   * The declaration that keeps Process 5.0 free of sector branches. A runnable
   * pack states which facts feed which streams, which factors apply, and what
   * the denominator is; the mapper walks this list and never asks which sector
   * it is looking at.
   */
  stream_bindings: PackStreamBinding[];
  /** SEC counterpart of `stream_bindings`, used by packs whose method is SEC. */
  energy_bindings?: PackEnergyBinding[];
  demand_binding?: PackDemandBinding;
  production_binding?: PackProductionBinding;
  sec_config?: PackSecConfig;
  adeetie?: PackAdeetieConfig;
  reconciliation_rules: string[];
  clause_citations: PackClauseCitation[];
  report_template: string;
  notes?: string;
}

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackError";
  }
}

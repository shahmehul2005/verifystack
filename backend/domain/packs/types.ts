import type { Unit } from "../units";
import type { FuelPhase } from "../factors";
import type { ProformaInput } from "../proforma/types";

/**
 * CBAM and GREEN_HYDROGEN exist as structure only (pack schema v2). They are
 * code-resident, never seeded into the `packs` table, and cannot start work.
 */
export type PackScheme = "CCTS" | "ADEETIE" | "CBAM" | "GREEN_HYDROGEN";
export type PackStatus = "runnable" | "scaffold";
/**
 * `GEI` and `SEC` are implemented. `EMBEDDED_EMISSIONS` and `H2_INTENSITY` are
 * declared by the structure-only packs and refused by the dispatcher until a
 * method is specified and verified. `SAVINGS_DPR` is not a pack's primary
 * method: it is a separate versioned layer over an ADEETIE engagement
 * (backend/domain/savings).
 */
export type CalculationMethod =
  | "GEI"
  | "SEC"
  | "EMBEDDED_EMISSIONS"
  | "H2_INTENSITY"
  | "TBD";

/** Pack schema version. v1 packs omit the field. */
export type PackSchemaVersion = 1 | 2;

/** One input a structure-only pack says its method will need, and how it will be evidenced. */
export interface PackStructureInput {
  key: string;
  label: string;
  /** Which provenance types may evidence it, from backend/domain/provenance. */
  evidence: Array<"document_page" | "spreadsheet_cell" | "time_series_range" | "site_observation">;
  /** Unit family only. A structure pack carries no numeric factor, limit or default. */
  unitFamily?: string;
}

/**
 * The shape of a methodology the product does not yet implement. It records the
 * boundary and the inputs so intake and planning can be designed against it,
 * while every figure, formula and threshold stays an open item.
 */
export interface PackMethodStructure {
  summary: string;
  boundary: string[];
  requiredInputs: PackStructureInput[];
  /** What must be confirmed with the regulator or a domain expert before this can run. */
  openItems: string[];
}

export interface PackStage {
  id: string;
  label: string;
  phase?: "IGEA" | "DPR" | "MV";
}

/** Output formats a scheme or portal asks for in a submission package (DFD 8.7). */
export interface PackSubmissionFormat {
  id: string;
  label: string;
  kind: "csv" | "json" | "pdf";
  /** True when the exact column layout comes from a scheme template we have not seen. */
  layoutUnverified: boolean;
  notes?: string;
}

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
  /**
   * Alternative methods for one quantity. A run needs at least one stream in the group
   * bound, not all of them: calcination can be estimated from the clinker output or from
   * the raw meal input, never both. Streams in a group are individually optional.
   */
  requiredGroup?: string;
  /**
   * Compliance years in which this stream is outside the intensity basis. In that window
   * the stream is not required. A figure that is supplied is still counted, and the run
   * warns that the intensity is not on the same basis as a target set without it.
   */
  basisWindow?: PackBasisWindow;
}

/** A page-cited window of compliance years in which a stream is outside the intensity basis. */
export interface PackBasisWindow {
  /** First and last financial-year start (FY2024-25 is 2024), inclusive. */
  fromFyStart: number;
  toFyStart: number;
  /** The primary source and page, in words an auditor can check. */
  citation: string;
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

/**
 * One labelled place in a pack's evidence checklist. Several documents may sit
 * under one slot (three electricity bills, a PDF and a CSV export). A slot is
 * ticked once it holds at least one document.
 *
 * `gate` says what an empty slot blocks: a calculation run, a submission, or
 * nothing (corroboration only). The source list in `basis` is what the slot was
 * proposed from. A slot stays "proposed" until a practitioner confirms it.
 */
export interface EvidenceSlot {
  id: string;
  label: string;
  gate: "run" | "submission" | "none";
  /** Plain-language description of the files this slot takes. */
  accepts: string;
  basis: string;
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
  /** Pack schema v2. Absent on v1 packs, which behave exactly as before. */
  schema_version?: PackSchemaVersion;
  /** Required on structure-only packs; they must also be `scaffold`. */
  structure_only?: PackMethodStructure;
  /**
   * Whether an independent technical review must be recorded before sign-off.
   * Defaults to false: which schemes require one is an open item in the
   * regulatory register, so no pack switches it on without a source.
   */
  technical_review_required?: boolean;
  /**
   * Evidence checklist (verification-first intake). When present, a calculation
   * run is refused until every slot with `gate: "run"` holds a document.
   */
  evidence_slots?: EvidenceSlot[];
  /**
   * When true, a run uses only accepted spreadsheet-cell and time-series facts
   * (plus site observations and explicit overrides). PDF readings stay on the
   * ledger and are left out of the run. Changing this changes run results, so it
   * is a pack version change. Absent or false keeps the existing behaviour.
   */
  workbook_required?: boolean;
  /**
   * Where each calculation input sits in the master pro forma workbook. When
   * present, the inputs a run needs are read from that workbook alone, and
   * formula cells are recomputed in code. No OCR and no hand-keying.
   */
  proforma_inputs?: ProformaInput[];
  /** Submission package outputs (DFD 8.7). Empty or absent means the generic package only. */
  submission_formats?: PackSubmissionFormat[];
  /**
   * Stage list for the stage manager (DFD 1.5), in order. Absent means the
   * scheme's stage list is not defined yet and no tracker is shown.
   */
  stages?: PackStage[];
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

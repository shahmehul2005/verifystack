/**
 * Canonical key registry: what a quantity IS, written once.
 *
 * A quantity such as "coal GCV" is named in several places that do not talk to each other: a pack
 * binding path the calculation reads, a pro forma cell, a desk-review reading, and a leaf of an
 * extraction schema. This registry gives the quantity one key and lists every name it goes by, with
 * the scope, unit and basis each name carries, because the names do NOT all mean the same thing:
 * the mean of a lab's dated samples, one certificate's figure and the workbook's annual cell are all
 * "coal GCV" and none of them may stand in for another.
 *
 * What it is not:
 *  - Not a value store. It holds definitions only. Values stay in extracted_fields, facts and
 *    desk_readings, which keep their own mutability and independence.
 *  - Not a merge. Two sources sharing a key are compared side by side, never copied into each other.
 *  - Not editable at run time. It lives in code, versioned with the pack, so a definition cannot
 *    change what a calculation means without review.
 */

/** The kinds of place a quantity is named. */
export type Surface =
  /** A path a pack stream reads from the facts (`stream_bindings`, `production_binding`). */
  | "pack_binding"
  /** A pack's pro forma input: the pro forma row that becomes that fact path. */
  | "pack_proforma"
  /** A pro forma cell desk review compares against. */
  | "proforma_cell"
  /** A figure the auditor types from a document into desk review. */
  | "desk_manual"
  /** A figure desk review's workbook readers compute. */
  | "desk_reader"
  /** A leaf of a document-type extraction schema, as `docType.leaf`. */
  | "extraction_field";

/** What span of time a name covers. This is the difference a bare label hides. */
export type Period =
  | "annual" // the entity's annual figure for the compliance year
  | "period_total" // a sum over the months the evidence covers
  | "period_mean" // a mean of dated samples over the months the evidence covers
  | "single_reading" // one certificate, one slip
  | "daily_series" // one value per day
  | "document_period"; // whatever period the one document prints

/** The moisture or heating basis a figure is stated on. */
export type Basis =
  | { kind: "none" } // the quantity has no basis (tonnes, kWh)
  | { kind: "fixed"; basis: "ARB" | "ADB" | "DB" } // the source states it once, for every value
  | { kind: "stated_by"; name: string } // another field on the same source states it
  | { kind: "not_stated" }; // the source does not say; it cannot be compared until someone does

export interface RegistryMember {
  surface: Surface;
  /** The name exactly as that surface writes it. */
  name: string;
  /** The unit that surface states, or null when it is whatever the document prints. */
  unit: string | null;
  period: Period;
  basis: Basis;
  /**
   * Another member that is the same cell, declared in a second place (the pack's pro forma input and
   * desk review's pro forma cell read the same row). The conformance test checks the two agree.
   */
  pairedWith?: string;
  /**
   * For an extraction field: whether the fact it becomes can be read by the pack binding, worked out
   * by the extraction path rewrite and the binding match, not by hand. The test recomputes it.
   */
  packBinds?: "always" | "only_without_fuel_kind";
  note?: string;
}

/** A name that sits near this quantity but is a different one, with why. */
export interface RegistryExclusion {
  surface: Surface;
  name: string;
  reason: string;
  /** For an extraction field: whether its fact lands on a pack binding anyway. Recomputed by the test. */
  landsOnPackBinding?: boolean;
}

export type Dimension = "mass" | "energy" | "calorific_value";

export interface RegistryEntry {
  /** The canonical key. Lower snake case, stable. */
  key: string;
  meaning: string;
  /** The unit values are normalised to when compared. */
  standardUnit: string;
  dimension: Dimension;
  /**
   * Structural checks only. No numeric range is set: a plausible range is an engineering and scheme
   * decision that belongs in the regulatory register with a source, not here.
   */
  validation: { finite: true; nonNegative: true; allowedUnits: readonly string[] };
  members: readonly RegistryMember[];
  excluded: readonly RegistryExclusion[];
  /** Where the definition comes from. `provisional` until each clause is confirmed against the procedure. */
  source: { status: "provisional" | "confirmed"; note: string };
}

export interface Registry {
  scheme: "CCTS";
  sector: "cement";
  packId: string;
  version: string;
  entries: readonly RegistryEntry[];
}

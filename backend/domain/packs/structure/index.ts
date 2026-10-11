import type { MethodologyPack } from "../types";

/**
 * Structure-only packs (pack schema v2).
 *
 * These describe the boundary and the inputs a methodology will need so intake
 * and planning can be designed against them. They contain no emission factor,
 * default value, formula or threshold, because none of those has been sourced.
 * Every one is `scaffold`, so `canStartWork` refuses them and the calculation
 * dispatcher reports the method as not implemented.
 *
 * They are code-resident and deliberately not seeded into the `packs` table, so
 * no engagement can reference them.
 */

export const CBAM_STRUCTURE_V0: MethodologyPack = {
  pack_id: "CBAM-STRUCTURE-v0",
  scheme: "CBAM",
  sector_or_cluster: "Embedded emissions (export to the EU)",
  status: "scaffold",
  version: "0.0.1",
  schema_version: 2,
  document_taxonomy: [
    { id: "installation_description", label: "Installation and production-process description", extractable: false },
    { id: "monitoring_plan", label: "Monitoring plan", extractable: false },
    { id: "production_log", label: "Production log by product", extractable: true },
    { id: "precursor_invoice", label: "Precursor purchase invoice", extractable: true },
    { id: "electricity_bill", label: "Electricity bill", extractable: true },
  ],
  field_schemas: {},
  calculation_method: "EMBEDDED_EMISSIONS",
  emission_or_energy_factors: [],
  stream_bindings: [],
  reconciliation_rules: [],
  clause_citations: [],
  report_template: "none",
  structure_only: {
    summary:
      "Embedded emissions of goods exported to the EU, reported per installation and product. Direct and indirect emissions plus precursor attribution.",
    boundary: [
      "Installation boundary and the production processes inside it",
      "Direct emissions from fuels and process",
      "Indirect emissions from electricity",
      "Precursor goods and their embedded emissions",
    ],
    requiredInputs: [
      { key: "production_by_product", label: "Production by product", evidence: ["document_page", "spreadsheet_cell"], unitFamily: "mass" },
      { key: "fuel_consumption", label: "Fuel consumption by stream", evidence: ["document_page", "spreadsheet_cell", "time_series_range"], unitFamily: "mass or volume" },
      { key: "electricity", label: "Electricity consumed", evidence: ["document_page", "time_series_range"], unitFamily: "energy" },
      { key: "precursor_quantity", label: "Precursor quantity and supplier-declared embedded emissions", evidence: ["document_page", "spreadsheet_cell"], unitFamily: "mass" },
      { key: "site_boundary_check", label: "Boundary confirmed on site", evidence: ["site_observation"] },
    ],
    openItems: [
      "Which CBAM regulation text and implementing acts apply, and the current reporting period",
      "Calculation methodology for embedded emissions and for precursors",
      "Default values policy, if any, and where they are published",
      "Verification requirements for the accredited verifier",
      "Report template and submission channel",
    ],
  },
  notes:
    "Structure only. No factor, default or formula is recorded. See docs/domain/regulatory-register.md.",
};

export const GREEN_HYDROGEN_STRUCTURE_V0: MethodologyPack = {
  pack_id: "GREEN-HYDROGEN-STRUCTURE-v0",
  scheme: "GREEN_HYDROGEN",
  sector_or_cluster: "Green hydrogen carbon intensity",
  status: "scaffold",
  version: "0.0.1",
  schema_version: 2,
  document_taxonomy: [
    { id: "electrolyser_log", label: "Electrolyser operating log", extractable: true },
    { id: "electricity_source", label: "Electricity source records (PPA, renewable certificates)", extractable: true },
    { id: "hydrogen_output", label: "Hydrogen output and purity records", extractable: true },
    { id: "metering_calibration", label: "Meter calibration certificate", extractable: true },
  ],
  field_schemas: {},
  calculation_method: "H2_INTENSITY",
  emission_or_energy_factors: [],
  stream_bindings: [],
  reconciliation_rules: [],
  clause_citations: [],
  report_template: "none",
  structure_only: {
    summary:
      "Carbon intensity of hydrogen produced by electrolysis, per unit of hydrogen, across the production boundary.",
    boundary: [
      "Electrolyser and balance-of-plant electricity",
      "Electricity source and its renewable attribution",
      "Water and compression, if inside the boundary",
      "Hydrogen output at the defined purity and pressure",
    ],
    requiredInputs: [
      { key: "electricity_by_source", label: "Electricity consumed by source", evidence: ["time_series_range", "document_page"], unitFamily: "energy" },
      { key: "hydrogen_output", label: "Hydrogen produced", evidence: ["time_series_range", "spreadsheet_cell"], unitFamily: "mass" },
      { key: "renewable_attribution", label: "Renewable attribution evidence", evidence: ["document_page"] },
      { key: "meter_check", label: "Meter and boundary check on site", evidence: ["site_observation"] },
    ],
    openItems: [
      "The notified methodology, its boundary and the intensity threshold",
      "Rules for renewable attribution and temporal matching",
      "Which meter points are in the boundary",
      "Verification and certification process and who may perform it",
    ],
  },
  notes:
    "Structure only. No threshold or formula is recorded. See docs/domain/regulatory-register.md.",
};

export const STRUCTURE_ONLY_PACKS: MethodologyPack[] = [CBAM_STRUCTURE_V0, GREEN_HYDROGEN_STRUCTURE_V0];

import type { EvidenceSlot, MethodologyPack } from "../types";
import type { ProformaInput } from "../../proforma/types";

/**
 * CCTS-CEMENT-v1 — runnable pack assembled from existing schemas, rules, and
 * Cement fallback factors. Process 3.0/5.0 load this record; they do not
 * branch on sector.
 */
/**
 * Evidence checklist proposed from the Shyamrock Cement Works test set
 * (do-res/shyamrock_cement_works.zip). Labels and the run gate are PROPOSED:
 * a practitioner must confirm which slots are mandatory before this gates
 * real engagements. Normalization evidence (kiln equipment log, SLDC letter)
 * is deliberately absent. CCTS does not use it.
 */
/**
 * Where the run's inputs sit in the master pro forma (sector-specific workbook,
 * sheets 3 and 4). Labels are matched, not cell addresses, so a re-ordered copy
 * still reads. Quantities are the annual figures in the workbook.
 */
const CEMENT_PROFORMA_INPUTS: ProformaInput[] = [
  { fieldPath: "production", sheet: "summary|form ?1", label: "^Total Equivalent Product", unit: "t", description: "Total equivalent product (t)" },
  { fieldPath: "quantity", sheet: "ghg", label: "^Coal Consumed Total", unit: "t", description: "Coal consumed (t)" },
  { fieldPath: "calorificValue", sheet: "ghg", label: "^GCV\\s*(of\\s*)?Coal", unit: "kcal/kg", description: "GCV of coal (kcal/kg)" },
  { fieldPath: "activeEnergy", sheet: "ghg", label: "^Grid Import", unit: "kWh", scale: 100000, description: "Grid import (kWh)", note: "Workbook unit is Lakh kWh." },
  {
    fieldPath: null,
    sheet: "ghg",
    label: "^Fuel Oil Consumed",
    unit: "t",
    description: "Fuel oil consumed (t)",
    note: "The pro forma counts fuel oil in its GHG total. The cement pack has no fuel-oil stream, so a run leaves it out.",
  },
];

const CEMENT_EVIDENCE_SLOTS: EvidenceSlot[] = [
  {
    id: "proforma_workbook",
    label: "Sector pro forma workbook",
    gate: "run",
    accepts: "One Excel workbook: the entity's sector-specific pro forma. Cells are mapped, not read.",
    basis: "Test set file 15_sector_specific_proforma.xlsx",
  },
  {
    id: "production_evidence",
    label: "Production evidence",
    gate: "run",
    accepts: "Monthly production report, SCADA or DCS trend export, daily production report, SAP printout. Several may be attached.",
    basis: "Test set 01, 02, 03, 04",
  },
  {
    id: "coal_quality",
    label: "Coal quality",
    gate: "run",
    accepts: "Internal lab daily log (Excel or CSV) and the NABL external certificate (PDF).",
    basis: "Test set 08, 09",
  },
  {
    id: "grid_electricity",
    label: "Grid electricity bill",
    gate: "run",
    accepts: "Electricity bills (PDF, Excel or CSV). Several months may be attached.",
    basis: "Test set 12",
  },
  {
    id: "cpp_generation",
    label: "Captive power plant generation",
    gate: "none",
    accepts: "CPP daily generation report and monthly generation report.",
    basis: "Test set 06, 07. Corroboration only; CPP kWh is not a GEI input.",
  },
  {
    id: "coal_purchase",
    label: "Coal purchase order",
    gate: "none",
    accepts: "Purchase order or supplier invoice for coal.",
    basis: "Test set 10. Corroborates lab and quantity; feeds no pro forma cell.",
  },
  {
    id: "petcoke_log",
    label: "Petcoke consumption log",
    gate: "none",
    accepts: "Daily or monthly petcoke and coal consumption log.",
    basis: "Test set 11. Petcoke has no pro forma cell yet; see tie-out findings.",
  },
  {
    id: "rec_declaration",
    label: "REC or renewable declaration",
    gate: "none",
    accepts: "Renewable energy certificate status or an onsite / open-access declaration.",
    basis: "Test set 13. REC purchases are not a renewable claim (procedure p.14, 4(12)(iii)).",
  },
  {
    id: "form1",
    label: "Form 1 (entity claim)",
    gate: "submission",
    accepts: "Form 1 Annual Energy Consumption and GHG Emissions, as submitted by the entity.",
    basis: "Test set 16. Compared with the pro forma summary; never an input.",
  },
];

export const CCTS_CEMENT_V1: MethodologyPack = {
  pack_id: "CCTS-CEMENT-v1",
  scheme: "CCTS",
  sector_or_cluster: "Cement",
  status: "runnable",
  version: "1.0.0",
  document_taxonomy: [
    { id: "fuel_invoice", label: "Fuel invoice", extractable: true },
    {
      id: "tax_invoice",
      label: "GST / commercial tax invoice",
      extractable: true,
      notes: "Supporting evidence. Line items do not enter GEI unless bound.",
    },
    { id: "electricity_bill", label: "Electricity bill (HT)", extractable: true },
    { id: "lab_certificate", label: "NABL lab certificate", extractable: true },
    {
      id: "production_log",
      label: "Equivalent-product log",
      extractable: true,
    },
    {
      id: "weighbridge_slip",
      label: "Weighbridge slip",
      extractable: false,
      notes: "Out of scope beyond Cement facsimile",
    },
    { id: "monitoring_plan", label: "Monitoring plan", extractable: false },
  ],
  field_schemas: {
    fuel_invoice: "FuelInvoiceSchema",
    tax_invoice: "TaxInvoiceSchema",
    electricity_bill: "ElectricityBillSchema",
    lab_certificate: "LabCertificateSchema",
    production_log: "ProductionLogSchema",
  },
  calculation_method: "GEI",
  evidence_slots: CEMENT_EVIDENCE_SLOTS,
  proforma_inputs: CEMENT_PROFORMA_INPUTS,
  emission_or_energy_factors: [
    { factorKey: "cea_grid_ef", vintage: "FY2024-25", role: "grid" },
    { factorKey: "ef_coal_subbituminous", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_petcoke", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_lignite", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_natural_gas", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_charcoal", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_clinker_calcination", vintage: "TO-VERIFY", role: "process" },
  ],
  // The first two streams are pinned: they reproduce the pre-refactor Cement
  // mapping exactly (see calc/golden.test.ts). Additional kiln fuels and
  // calcination are optional and omitted when facts are absent.
  stream_bindings: [
    {
      kind: "fuel_combustion",
      streamId: "coal-kiln",
      label: "Kiln coal",
      quantity: { path: "quantity", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "MJ/kg",
      },
      factorKey: "ef_coal_subbituminous",
      factorVintage: "IPCC2006",
      phase: "solid",
    },
    {
      kind: "electricity_import",
      streamId: "grid-ht",
      label: "Imported HT electricity",
      quantity: { path: "activeEnergy", units: ["kWh", "MWh"], defaultUnit: "MWh" },
      factorKey: "cea_grid_ef",
      factorVintage: "FY2024-25",
    },
    {
      kind: "fuel_combustion",
      streamId: "petcoke-kiln",
      label: "Kiln petroleum coke",
      quantity: { path: "petcoke.quantity", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "petcoke.calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "kcal/kg",
      },
      factorKey: "ef_petcoke",
      factorVintage: "IPCC2006",
      phase: "solid",
    },
    {
      kind: "fuel_combustion",
      streamId: "lignite-kiln",
      label: "Kiln lignite",
      quantity: { path: "lignite.quantity", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "lignite.calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "kcal/kg",
      },
      factorKey: "ef_lignite",
      factorVintage: "IPCC2006",
      phase: "solid",
    },
    {
      kind: "fuel_combustion",
      streamId: "natural-gas",
      label: "Natural gas",
      quantity: { path: "naturalGas.quantity", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "naturalGas.calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "MJ/kg",
      },
      factorKey: "ef_natural_gas",
      factorVintage: "IPCC2006",
      phase: "gaseous",
    },
    {
      kind: "fuel_combustion",
      streamId: "afr-biomass",
      label: "Alternative fuel / biomass (kiln)",
      quantity: { path: "biomass.quantity", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "biomass.calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "kcal/kg",
      },
      factorKey: "ef_charcoal",
      factorVintage: "IPCC2006",
      phase: "solid",
    },
    {
      kind: "process_direct",
      streamId: "clinker-calcination",
      label: "Clinker calcination process CO2",
      quantity: {
        path: "process.calcinationEmissions",
        units: ["tCO2e", "kgCO2e"],
        defaultUnit: "tCO2e",
      },
      methodologyRef:
        "CCTS Cement / IPCC 2006 Vol.3 Ch.2 — calcination of carbonates in clinker (TO VERIFY). Supply as tCO2e from the sector equation (clinker mass × process factor, CKD correction). Biogenic treatment of AFR is TO VERIFY before including afr-biomass in a compliance total.",
    },
  ],
  production_binding: {
    path: "production",
    units: ["t"],
    defaultUnit: "t",
    productUnitLabel: "tonne_equivalent_product",
    productLabel: "Cement equivalent product",
  },
  reconciliation_rules: [
    "MB001",
    "CV001",
    "CV002",
    "LB001",
    "TS001",
    "EF001",
    "SM001",
    "MT001",
  ],
  clause_citations: [
    {
      ruleId: "MB001",
      clauseRef: "CCTS Detailed Procedure — data flow and control activities (TO VERIFY)",
    },
    {
      ruleId: "CV001",
      clauseRef: "CCTS Detailed Procedure — emissions estimated using actual NCV (TO VERIFY)",
    },
    {
      ruleId: "CV002",
      clauseRef: "Physical plausibility gate (internal control)",
    },
    {
      ruleId: "LB001",
      clauseRef: "CCTS Detailed Procedure — NABL accredited lab testing (TO VERIFY)",
    },
    {
      ruleId: "TS001",
      clauseRef: "CCTS Detailed Procedure — completeness of monitored data (TO VERIFY)",
    },
    {
      ruleId: "EF001",
      clauseRef: "CEA CO2 baseline database applicable to the compliance year (TO VERIFY)",
    },
    {
      ruleId: "SM001",
      clauseRef:
        "CCTS Detailed Procedure — sampling (coal monthly or per 20,000 t; raw material monthly or per 50,000 t)",
    },
    {
      ruleId: "MT001",
      clauseRef: "ISO 14064-3 — materiality and aggregation of errors (TO VERIFY)",
    },
  ],
  report_template: "ccts-gei-form-ab-v1",
  notes:
    "Runnable. Kiln coal + HT electricity reproduce the original Cement mapping. Petcoke, lignite, gas, AFR and calcination are optional and omitted when facts are absent — a run without calcination understates Scope 1. Factors remain verified:false. Captive power and clinker/cement conversion ratios are not yet separate streams.",
};

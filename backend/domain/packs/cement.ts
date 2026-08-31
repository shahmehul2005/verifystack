import type { MethodologyPack } from "./types";

/**
 * CCTS-CEMENT-v1 — runnable pack assembled from existing schemas, rules, and
 * Cement fallback factors. Process 3.0/5.0 load this record; they do not
 * branch on sector.
 */
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

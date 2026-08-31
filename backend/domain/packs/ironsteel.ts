import type { MethodologyPack } from "./types";

/**
 * CCTS-IRON-AND-STEEL-v1 — runnable pack.
 *
 * GEI is reported in tCO2e per tonne of crude steel. Unlike Cement, a material
 * share of the total is neither fuel combustion nor purchased electricity: carbon
 * entering as a reductant (coke, coal injected at the tuyeres, electrode carbon)
 * leaves as CO2 whether or not it was burned for heat. That share is taken as a
 * `process_direct` stream so it is visible on the run rather than buried inside a
 * fuel factor.
 *
 * Fact paths are qualified by fuel (`coke.quantity`, not `quantity`) because an
 * integrated works reports several solid fuels at once.
 */
export const CCTS_IRON_AND_STEEL_V1: MethodologyPack = {
  pack_id: "CCTS-IRON-AND-STEEL-v1",
  scheme: "CCTS",
  sector_or_cluster: "Iron & Steel",
  status: "runnable",
  version: "1.0.0",
  document_taxonomy: [
    {
      id: "fuel_invoice",
      label: "Fuel invoice (coke, coking coal, natural gas)",
      extractable: true,
    },
    {
      id: "tax_invoice",
      label: "GST / commercial tax invoice",
      extractable: true,
      notes: "Supporting evidence. Line items do not enter GEI unless bound.",
    },
    { id: "electricity_bill", label: "Electricity bill (HT)", extractable: true },
    {
      id: "lab_certificate",
      label: "NABL lab certificate (proximate/ultimate analysis)",
      extractable: true,
      notes:
        "Supplies the calorific value, and for the reductant stream the fixed carbon content.",
    },
    {
      id: "production_log",
      label: "Crude steel production log",
      extractable: true,
      notes: "Supplies the GEI denominator.",
    },
    {
      id: "weighbridge_slip",
      label: "Weighbridge slip",
      extractable: false,
    },
    {
      id: "reductant_balance",
      label: "Reductant and carbon input balance",
      extractable: false,
      notes:
        "Carbon-in / carbon-out statement supporting the process_direct stream. No general extractor; the boundary differs by route (BF-BOF, DRI-EAF, scrap-EAF).",
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
    { factorKey: "ef_coke_oven_coke", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_coal_coking", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_natural_gas", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "cea_grid_ef", vintage: "FY2025-26", role: "grid" },
    { factorKey: "ef_steel_reductant_carbon", vintage: "STOICHIOMETRIC", role: "process" },
  ],
  stream_bindings: [
    {
      kind: "fuel_combustion",
      streamId: "coke-oven-coke",
      label: "Coke oven coke",
      quantity: { path: "coke.quantity", units: ["kg", "t", "kt"], defaultUnit: "t" },
      calorificValue: {
        path: "coke.calorificValue",
        units: ["kcal/kg", "MJ/kg", "GJ/t", "Gcal/t"],
        defaultUnit: "kcal/kg",
      },
      factorKey: "ef_coke_oven_coke",
      factorVintage: "IPCC2006",
      phase: "solid",
    },
    {
      kind: "fuel_combustion",
      streamId: "coking-coal",
      label: "Coking coal",
      quantity: { path: "coal.quantity", units: ["kg", "t", "kt"], defaultUnit: "t" },
      calorificValue: {
        path: "coal.calorificValue",
        units: ["kcal/kg", "MJ/kg", "GJ/t", "Gcal/t"],
        defaultUnit: "kcal/kg",
      },
      factorKey: "ef_coal_coking",
      factorVintage: "IPCC2006",
      phase: "solid",
    },
    {
      // The GEI engine composes a fuel factor with a per-mass calorific value, so
      // natural gas must arrive on a mass basis. A volumetric (SCM) gas invoice has
      // to be converted using a measured density during intake; the SEC engine
      // handles volumetric gas directly, the GEI engine does not.
      kind: "fuel_combustion",
      streamId: "natural-gas",
      label: "Natural gas (reheating and annealing)",
      quantity: {
        path: "naturalGas.quantity",
        units: ["kg", "t"],
        defaultUnit: "t",
      },
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
      kind: "electricity_import",
      streamId: "grid-ht",
      label: "Imported HT electricity",
      quantity: {
        path: "electricity.activeEnergy",
        units: ["kWh", "MWh", "GWh"],
        defaultUnit: "MWh",
      },
      factorKey: "cea_grid_ef",
      factorVintage: "FY2025-26",
    },
    {
      kind: "process_direct",
      streamId: "reductant-carbon",
      label: "Reductant and carbon-bearing input oxidation",
      quantity: {
        path: "process.reductantEmissions",
        units: ["tCO2e", "kgCO2e"],
        defaultUnit: "tCO2e",
      },
      methodologyRef:
        "Carbon mass balance over reductant and carbon-bearing inputs (CCTS Iron & Steel methodology — TO VERIFY)",
    },
  ],
  production_binding: {
    path: "production",
    units: ["t", "kt", "kg"],
    defaultUnit: "t",
    productUnitLabel: "tonne_crude_steel",
    productLabel: "Crude steel",
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
    { ruleId: "CV002", clauseRef: "Physical plausibility gate (internal control)" },
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
        "CCTS Detailed Procedure — sampling (coal monthly or per 20,000 t; raw material monthly or per 50,000 t) — applicability to coke and reductants TO VERIFY",
    },
    {
      ruleId: "MT001",
      clauseRef: "ISO 14064-3 — materiality and aggregation of errors (TO VERIFY)",
    },
  ],
  report_template: "ccts-gei-form-ab-v1",
  notes:
    "Runnable. Denominator is tonnes of crude steel. The gazetted GEI target for this sector is NOT held in this pack — it is supplied per engagement. Reductant carbon arrives as a process_direct emissions quantity computed under the sector mass balance; ef_steel_reductant_carbon is registered for that derivation and is verified:false. Sector-specific reconciliation rules (carbon balance closure, route-specific boundary checks) are not yet written; the eight universal rules apply.",
};

import type { MethodologyPack } from "./types";

/**
 * CCTS-ALUMINIUM-v1 — runnable pack.
 *
 * GEI is reported in tCO2e per tonne of aluminium. The emissions profile is
 * unlike Cement or Iron & Steel in two ways that the pack has to make visible:
 *
 *  1. It is electricity-dominated. Smelting draws roughly 13-15 MWh per tonne, so
 *     the grid factor vintage moves the answer more than any fuel choice does.
 *     That makes rule EF001 (grid vintage) the highest-materiality check here.
 *  2. Anode consumption and PFC releases from anode effects are process emissions,
 *     not combustion. Both are declared as `process_direct` streams so they appear
 *     as their own lines with their own methodology reference.
 *
 * The PFC factor in the registry is deliberately zero and unverified — see the note
 * on `ef_pfc_anode_effect`. A run that relies on it understates the total.
 */
export const CCTS_ALUMINIUM_V1: MethodologyPack = {
  pack_id: "CCTS-ALUMINIUM-v1",
  scheme: "CCTS",
  sector_or_cluster: "Aluminium",
  status: "runnable",
  version: "1.0.0",
  document_taxonomy: [
    {
      id: "electricity_bill",
      label: "Electricity bill (HT) / captive generation statement",
      extractable: true,
      notes:
        "Dominant input. Where supply is from a captive plant rather than the grid, the applicable factor is not the CEA grid factor and the engagement must say so.",
    },
    {
      id: "fuel_invoice",
      label: "Fuel invoice (anode baking, casthouse furnaces)",
      extractable: true,
    },
    {
      id: "tax_invoice",
      label: "GST / commercial tax invoice",
      extractable: true,
      notes: "Supporting evidence. Line items do not enter GEI unless bound.",
    },
    {
      id: "lab_certificate",
      label: "NABL lab certificate",
      extractable: true,
      notes: "Fuel calorific value, and anode composition where tested.",
    },
    {
      id: "production_log",
      label: "Aluminium production log",
      extractable: true,
      notes: "Supplies the GEI denominator.",
    },
    {
      id: "anode_consumption_log",
      label: "Net anode consumption log",
      extractable: false,
      notes:
        "Net carbon consumed per tonne of aluminium. Supports the anode process stream; no general extractor.",
    },
    {
      id: "anode_effect_log",
      label: "Anode effect log (cell-days, minutes, overvoltage)",
      extractable: false,
      notes:
        "PFC emissions are derived from anode effect frequency and duration or from overvoltage. Pot-line SCADA export; format is smelter-specific.",
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
    { factorKey: "cea_grid_ef", vintage: "FY2025-26", role: "grid" },
    { factorKey: "ef_natural_gas", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_furnace_oil", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_prebaked_anode", vintage: "IPCC2006", role: "process" },
    { factorKey: "ef_pfc_anode_effect", vintage: "TO-VERIFY", role: "process" },
  ],
  stream_bindings: [
    {
      kind: "electricity_import",
      streamId: "grid-smelter",
      label: "Imported electricity (pot line and ancillaries)",
      quantity: {
        path: "electricity.activeEnergy",
        units: ["kWh", "MWh", "GWh"],
        defaultUnit: "MWh",
      },
      factorKey: "cea_grid_ef",
      factorVintage: "FY2025-26",
      required: true,
    },
    {
      kind: "fuel_combustion",
      streamId: "anode-baking-gas",
      label: "Natural gas (anode baking furnace)",
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
      kind: "fuel_combustion",
      streamId: "casthouse-fo",
      label: "Furnace oil (casthouse holding furnaces)",
      quantity: {
        path: "furnaceOil.quantity",
        units: ["kg", "t"],
        defaultUnit: "t",
      },
      calorificValue: {
        path: "furnaceOil.calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "kcal/kg",
      },
      factorKey: "ef_furnace_oil",
      factorVintage: "IPCC2006",
      phase: "liquid",
    },
    {
      kind: "process_direct",
      streamId: "anode-carbon",
      label: "Net anode carbon consumption",
      quantity: {
        path: "process.anodeEmissions",
        units: ["tCO2e", "kgCO2e"],
        defaultUnit: "tCO2e",
      },
      methodologyRef:
        "IPCC 2006 GL Vol.3 Ch.4.4 anode consumption equation, using net anode consumed and anode composition (TO VERIFY)",
    },
    {
      kind: "process_direct",
      streamId: "pfc-anode-effect",
      label: "PFC emissions from anode effects (CF4 and C2F6)",
      quantity: {
        path: "process.pfcEmissions",
        units: ["tCO2e", "kgCO2e"],
        defaultUnit: "tCO2e",
      },
      methodologyRef:
        "IPCC 2006 GL Vol.3 Ch.4.4 slope or overvoltage method, from anode effect minutes per cell-day, converted with a stated GWP set (TO VERIFY). This system holds no PFC factor value — the quantity must be supplied from the smelter's own derivation.",
    },
  ],
  production_binding: {
    path: "production",
    units: ["t", "kt", "kg"],
    defaultUnit: "t",
    productUnitLabel: "tonne_aluminium",
    productLabel: "Aluminium",
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
      clauseRef:
        "CEA CO2 baseline database applicable to the compliance year (TO VERIFY). Highest-materiality check for this sector, which is electricity-dominated.",
    },
    {
      ruleId: "SM001",
      clauseRef:
        "CCTS Detailed Procedure — sampling. Applicability to anode and alumina inputs TO VERIFY.",
    },
    {
      ruleId: "MT001",
      clauseRef: "ISO 14064-3 — materiality and aggregation of errors (TO VERIFY)",
    },
  ],
  report_template: "ccts-gei-form-ab-v1",
  notes:
    "Runnable. Denominator is tonnes of aluminium. PFC emissions from anode effects must be supplied as a derived tCO2e quantity — no PFC factor value is held in this system, and ef_pfc_anode_effect is a zero placeholder that would silently understate the total if used. A PFC-specific reconciliation rule and a captive-generation factor path are not yet written.",
};

import type { Registry, RegistryEntry } from "./types";

/**
 * The cement registry — exhaustive cut covering every quantity that appears
 * in desk review (corroboration drawer + workbook readers), the calculation
 * engine's stream bindings, and the pro forma cells.
 *
 * Version history:
 *   0.1.0-provisional  — 3 entries (clinker_production, coal_gcv, grid_electricity_import)
 *   0.2.0-provisional  — Expanded to full coverage: all fuels, CPP, stock balance,
 *                        clinker chemistry, calcination, petcoke, furnace oil, SAP production.
 *                        Still provisional: no entry has been confirmed against a BEE-issued
 *                        blank or a cited clause yet. See source.note on each entry.
 *
 * Working agreement: no numeric range is set here. Plausible ranges are engineering
 * and regulatory decisions that belong in docs/domain/regulatory-register.md with a source.
 */

// ---------------------------------------------------------------------------
// 1. PRODUCTION QUANTITIES
// ---------------------------------------------------------------------------

const clinkerProduction: RegistryEntry = {
  key: "clinker_production",
  meaning: "Clinker produced by the plant, in tonnes. Not cement and not equivalent product.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "proforma_cell", name: "pf.clinker_t", unit: "t", period: "annual", basis: { kind: "none" } },
    {
      surface: "desk_reader",
      name: "scada.clinker_sum",
      unit: "t",
      period: "period_total",
      basis: { kind: "none" },
      note: "Sum of the dated SCADA rows, over the months the file covers.",
    },
    { surface: "desk_reader", name: "scada.clinker@*", unit: "t", period: "daily_series", basis: { kind: "none" } },
    { surface: "desk_manual", name: "mpr.clinker_t", unit: "t", period: "document_period", basis: { kind: "none" }, note: "One monthly production report." },
    { surface: "desk_manual", name: "dpr.clinker", unit: "t", period: "daily_series", basis: { kind: "none" } },
  ],
  excluded: [
    {
      surface: "extraction_field",
      name: "production_log.production",
      reason: "One leaf for any production figure. A clinker log and an equivalent-product log land on the same name.",
      landsOnPackBinding: true,
    },
    { surface: "desk_manual", name: "clinker.cao_pct", reason: "Clinker chemistry (CaO), not a quantity of clinker." },
    { surface: "desk_manual", name: "clinker.mgo_pct", reason: "Clinker chemistry (MgO), not a quantity of clinker." },
  ],
  source: {
    status: "provisional",
    note: "Scope read from desk review's coverage and daily-agreement rules.",
  },
};

const opcProduction: RegistryEntry = {
  key: "opc_production",
  meaning: "OPC (Ordinary Portland Cement) produced by the plant, in tonnes.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "proforma_cell", name: "pf.opc_t", unit: "t", period: "annual", basis: { kind: "none" } },
    { surface: "desk_reader", name: "scada.opc_sum", unit: "t", period: "period_total", basis: { kind: "none" } },
    { surface: "desk_manual", name: "mpr.opc_t", unit: "t", period: "document_period", basis: { kind: "none" } },
    { surface: "desk_manual", name: "sap.opc_t", unit: "t", period: "document_period", basis: { kind: "none" }, note: "SAP ERP production extract." },
  ],
  excluded: [],
  source: { status: "provisional", note: "Scope from SCADA reader and SAP corroboration rules." },
};

const ppcProduction: RegistryEntry = {
  key: "ppc_production",
  meaning: "PPC (Portland Pozzolana Cement) produced by the plant, in tonnes.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "proforma_cell", name: "pf.ppc_t", unit: "t", period: "annual", basis: { kind: "none" } },
    { surface: "desk_reader", name: "scada.ppc_sum", unit: "t", period: "period_total", basis: { kind: "none" } },
    { surface: "desk_manual", name: "mpr.ppc_t", unit: "t", period: "document_period", basis: { kind: "none" } },
    { surface: "desk_manual", name: "sap.ppc_t", unit: "t", period: "document_period", basis: { kind: "none" } },
  ],
  excluded: [],
  source: { status: "provisional", note: "Scope from SCADA reader and SAP corroboration rules." },
};

const pscProduction: RegistryEntry = {
  key: "psc_production",
  meaning: "PSC (Portland Slag Cement) produced by the plant, in tonnes.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "proforma_cell", name: "pf.psc_t", unit: "t", period: "annual", basis: { kind: "none" } },
    { surface: "desk_reader", name: "scada.psc_sum", unit: "t", period: "period_total", basis: { kind: "none" } },
    { surface: "desk_manual", name: "mpr.psc_t", unit: "t", period: "document_period", basis: { kind: "none" } },
    { surface: "desk_manual", name: "sap.psc_t", unit: "t", period: "document_period", basis: { kind: "none" } },
  ],
  excluded: [],
  source: { status: "provisional", note: "Scope from SCADA reader and SAP corroboration rules." },
};

const equivalentProduct: RegistryEntry = {
  key: "equivalent_product",
  meaning: "Total cement-equivalent product in tonnes, the GEI denominator. Computed by the pro forma formula from clinker factors.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    {
      surface: "proforma_cell",
      name: "pf.eq_product_t",
      unit: "t",
      period: "annual",
      basis: { kind: "none" },
      note: "Sheet 4 Summary cell — total equivalent major product in t.",
    },
    {
      surface: "pack_proforma",
      name: "production",
      unit: "t",
      period: "annual",
      basis: { kind: "none" },
      pairedWith: "pf.eq_product_t",
    },
    {
      surface: "desk_manual",
      name: "form1.eq_product_t",
      unit: "t",
      period: "annual",
      basis: { kind: "none" },
      note: "Form 1 figure typed by the auditor for cross-check.",
    },
  ],
  excluded: [
    {
      surface: "pack_binding",
      name: "production",
      reason: "The production binding is used by the calculation engine as the denominator; it is not a corroboration reading and the conformance test asserts no entry classifies it as one.",
    },
    { surface: "proforma_cell", name: "pf.cf_opc", reason: "OPC clinker factor (dimensionless ratio); unit '' not yet parseable. Feeds equivalent-product formula." },
    { surface: "proforma_cell", name: "pf.cf_ppc", reason: "PPC clinker factor (dimensionless ratio); unit '' not yet parseable." },
    { surface: "proforma_cell", name: "pf.cf_psc", reason: "PSC clinker factor (dimensionless ratio); unit '' not yet parseable." },
  ],
  source: { status: "provisional", note: "Binding path is 'production' per calc/engine.ts." },
};

// ---------------------------------------------------------------------------
// 2. COAL (KILN FUEL)
// ---------------------------------------------------------------------------

const coalGcv: RegistryEntry = {
  key: "coal_gcv",
  meaning: "Gross calorific value of the coal burned in the kiln, kcal/kg. Each name states it for a different span and basis.",
  standardUnit: "kcal/kg",
  dimension: "calorific_value",
  validation: { finite: true, nonNegative: true, allowedUnits: ["kcal/kg", "MJ/kg"] },
  members: [
    { surface: "proforma_cell", name: "pf.gcv_coal", unit: "kcal/kg", period: "annual", basis: { kind: "not_stated" }, note: "The workbook cell states no basis." },
    {
      surface: "pack_proforma",
      name: "calorificValue",
      unit: "kcal/kg",
      period: "annual",
      basis: { kind: "not_stated" },
      pairedWith: "pf.gcv_coal",
    },
    {
      surface: "pack_binding",
      name: "calorificValue",
      unit: "MJ/kg",
      period: "annual",
      basis: { kind: "not_stated" },
      note: "The kiln-coal stream's default unit is MJ/kg; the pro forma and desk review state kcal/kg.",
    },
    {
      surface: "desk_reader",
      name: "lab.gcv_mean",
      unit: "kcal/kg",
      period: "period_mean",
      basis: { kind: "fixed", basis: "ARB" },
      note: "Mean of the internal lab's dated samples, on the as-fired basis.",
    },
    { surface: "desk_reader", name: "lab.gcv@*", unit: "kcal/kg", period: "daily_series", basis: { kind: "fixed", basis: "ARB" } },
    {
      surface: "desk_manual",
      name: "coal.nabl_gcv",
      unit: "kcal/kg",
      period: "single_reading",
      basis: { kind: "stated_by", name: "coal.nabl_basis" },
      note: "One NABL certificate.",
    },
    {
      surface: "extraction_field",
      name: "lab_certificate.calorificValue",
      unit: null,
      period: "document_period",
      basis: { kind: "stated_by", name: "lab_certificate.calorificBasis" },
      packBinds: "always",
      appliesToPaths: ["calorificValue"],
    },
    {
      surface: "extraction_field",
      name: "fuel_invoice.calorificValue",
      unit: null,
      period: "document_period",
      basis: { kind: "stated_by", name: "fuel_invoice.calorificBasis" },
      packBinds: "only_without_fuel_kind",
      appliesToPaths: ["calorificValue", "coal.calorificValue"],
    },
  ],
  excluded: [
    { surface: "desk_reader", name: "lab.gcv_n", reason: "A count of samples." },
    { surface: "desk_reader", name: "lab.gcv_months", reason: "A count of months covered." },
    { surface: "desk_reader", name: "pf.gcv_ncv_ref", reason: "A cell address, not a calorific value." },
    { surface: "extraction_field", name: "lab_certificate.calorificBasis", reason: "States the basis of a calorific value; it is a word, not a value." },
    { surface: "extraction_field", name: "fuel_invoice.calorificBasis", reason: "States the basis; not a value." },
    { surface: "pack_binding", name: "furnaceOil.calorificValue", reason: "Furnace oil's calorific value, a different fuel." },
    { surface: "pack_binding", name: "petcoke.calorificValue", reason: "Petroleum coke's calorific value, a different fuel." },
    { surface: "pack_binding", name: "lignite.calorificValue", reason: "Lignite's calorific value, a different fuel." },
    { surface: "pack_binding", name: "naturalGas.calorificValue", reason: "Natural gas's calorific value, a different fuel." },
    { surface: "pack_binding", name: "biomass.calorificValue", reason: "Biomass's calorific value, a different fuel." },
    { surface: "pack_proforma", name: "furnaceOil.calorificValue", reason: "Furnace oil's GCV pro forma row; not coal GCV." },
  ],
  source: {
    status: "provisional",
    note: "Basis and span of each name read from the rules that use them.",
  },
};

const coalConsumed: RegistryEntry = {
  key: "coal_consumed",
  meaning: "Total coal consumed (kiln + CPP), in tonnes, over the compliance year. The principal fuel quantity in the GHG calculation.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "proforma_cell", name: "pf.coal_t", unit: "t", period: "annual", basis: { kind: "none" } },
    {
      surface: "pack_proforma",
      name: "quantity",
      unit: "t",
      period: "annual",
      basis: { kind: "none" },
      pairedWith: "pf.coal_t",
      note: "The kiln-coal stream's quantity input.",
    },
    {
      surface: "pack_binding",
      name: "quantity",
      unit: "t",
      period: "annual",
      basis: { kind: "none" },
    },
    {
      surface: "desk_reader",
      name: "petcoke.coal_t_sum",
      unit: "t",
      period: "period_total",
      basis: { kind: "none" },
      note: "Sum of the coal-consumed column in the petcoke/coal log workbook.",
    },
    {
      surface: "desk_manual",
      name: "coal.issues_t",
      unit: "t",
      period: "document_period",
      basis: { kind: "none" },
      note: "Issues from the coal stock ledger — the consumption figure in the mass balance.",
    },
    {
      surface: "desk_manual",
      name: "coal.weighfeeder_t",
      unit: "t",
      period: "document_period",
      basis: { kind: "none" },
      note: "Weigh-feeder register total.",
    },
  ],
  excluded: [
    { surface: "desk_manual", name: "coal.po_t", reason: "Purchase order quantity — not consumption." },
    { surface: "desk_manual", name: "coal.po_months", reason: "Count of months the purchase orders cover — not a quantity consumed." },
  ],
  source: { status: "provisional", note: "Binding path 'quantity' per kiln-coal stream in calc/engine.ts." },
};

// Stock-balance quantities (not pack inputs — corroboration only)
const coalStockOpening: RegistryEntry = {
  key: "coal_stock_opening",
  meaning: "Opening coal stock at the start of the compliance year, in tonnes. Used only in the mass-balance check; not a GHG calculation input.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "desk_manual", name: "coal.opening_t", unit: "t", period: "document_period", basis: { kind: "none" } },
  ],
  excluded: [],
  source: { status: "provisional", note: "Corroboration drawer reading only; never a pack input." },
};

const coalStockClosing: RegistryEntry = {
  key: "coal_stock_closing",
  meaning: "Closing coal stock at the end of the compliance year, in tonnes. Used only in the mass-balance check.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "desk_manual", name: "coal.closing_t", unit: "t", period: "document_period", basis: { kind: "none" } },
  ],
  excluded: [],
  source: { status: "provisional", note: "Corroboration drawer reading only; never a pack input." },
};

const coalStockReceipts: RegistryEntry = {
  key: "coal_stock_receipts",
  meaning: "Coal received at the plant over the compliance year, in tonnes. Used only in the mass-balance check.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "desk_manual", name: "coal.receipts_t", unit: "t", period: "document_period", basis: { kind: "none" } },
  ],
  excluded: [],
  source: { status: "provisional", note: "Corroboration drawer reading only; never a pack input." },
};

// ---------------------------------------------------------------------------
// 3. PETCOKE
// ---------------------------------------------------------------------------

const petcokeConsumed: RegistryEntry = {
  key: "petcoke_consumed",
  meaning: "Petroleum coke consumed in the kiln, in tonnes. Optional fuel stream; a non-zero quantity triggers a CAR if absent from the pro forma.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "proforma_cell", name: "pf.petcoke_t", unit: "t", period: "annual", basis: { kind: "none" }, note: "May not exist on the pro forma — its absence is a potential finding." },
    {
      surface: "desk_reader",
      name: "petcoke.petcoke_t_sum",
      unit: "t",
      period: "period_total",
      basis: { kind: "none" },
      note: "Sum from the petcoke/coal log workbook.",
    },
  ],
  excluded: [],
  source: { status: "provisional", note: "Binding path is petcoke.quantity per calc/engine.ts." },
};

// petcokeGcv, furnaceOilGcv — no desk-review proforma cell or manual entry for GCV;
//   pack_binding:petcoke.calorificValue and pack_binding/pack_proforma:furnaceOil.calorificValue
//   are classified in coalGcv.excluded. Revisit when desk readings are added.

// ---------------------------------------------------------------------------
// 4. FURNACE OIL
// ---------------------------------------------------------------------------

const furnaceOilConsumed: RegistryEntry = {
  key: "furnace_oil_consumed",
  meaning: "Furnace oil consumed over the compliance year, in tonnes.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "proforma_cell", name: "pf.fuel_oil_t", unit: "t", period: "annual", basis: { kind: "none" } },
    {
      surface: "pack_proforma",
      name: "furnaceOil.quantity",
      unit: "t",
      period: "annual",
      basis: { kind: "none" },
      pairedWith: "pf.fuel_oil_t",
    },
    { surface: "pack_binding", name: "furnaceOil.quantity", unit: "t", period: "annual", basis: { kind: "none" } },
    { surface: "proforma_cell", name: "pf.s2_fuel_oil_t", unit: "t", period: "annual", basis: { kind: "none" }, note: "Sheet 2 cross-check cell." },
  ],
  excluded: [],
  source: { status: "provisional", note: "Pack binding path furnaceOil.quantity." },
};

// furnaceOilGcv — no desk-review entry for furnace oil GCV (pack_proforma:furnaceOil.calorificValue
//   and pack_binding:furnaceOil.calorificValue are classified in coalGcv.excluded).

// ---------------------------------------------------------------------------
// 5. ELECTRICITY
// ---------------------------------------------------------------------------

const gridElectricityImport: RegistryEntry = {
  key: "grid_electricity_import",
  meaning: "Electricity drawn from the grid, in kWh. Active energy; not apparent energy (kVAh), not exported power.",
  standardUnit: "kWh",
  dimension: "energy",
  validation: { finite: true, nonNegative: true, allowedUnits: ["kWh", "MWh"] },
  members: [
    { surface: "proforma_cell", name: "pf.grid_kwh", unit: "kWh", period: "annual", basis: { kind: "none" }, note: "Workbook unit is Lakh kWh; scaled to kWh." },
    { surface: "pack_proforma", name: "activeEnergy", unit: "kWh", period: "annual", basis: { kind: "none" }, pairedWith: "pf.grid_kwh" },
    { surface: "proforma_cell", name: "pf.s2_grid_import_kwh", unit: "kWh", period: "annual", basis: { kind: "none" }, note: "Sheet 2 cross-check cell." },
    {
      surface: "pack_binding",
      name: "activeEnergy",
      unit: "MWh",
      period: "annual",
      basis: { kind: "none" },
      note: "Grid stream default unit is MWh.",
    },
    {
      surface: "desk_manual",
      name: "grid.bill_kwh",
      unit: "kWh",
      period: "period_total",
      basis: { kind: "none" },
      note: "Units on the bills, over the months the bills cover.",
    },
    {
      surface: "extraction_field",
      name: "electricity_bill.activeEnergy",
      unit: null,
      period: "document_period",
      basis: { kind: "none" },
      packBinds: "always",
      appliesToPaths: ["electricity.activeEnergy", "activeEnergy"],
      note: "Unit as printed. A bill may print kVAh, which is not active energy.",
    },
  ],
  excluded: [
    { surface: "proforma_cell", name: "pf.s2_grid_export_kwh", reason: "Power sent to the grid, the opposite direction." },
    { surface: "desk_manual", name: "grid.bill_months", reason: "A count of months the bills cover." },
    { surface: "desk_reader", name: "pf.grid_import_ref", reason: "A cell address, not a quantity." },
    { surface: "desk_reader", name: "pf.grid_export_ref", reason: "A cell address, not a quantity." },
    { surface: "desk_reader", name: "pf.grid_export_sheet", reason: "A sheet name, not a quantity." },
  ],
  source: {
    status: "provisional",
    note: "Whether the Grid Import cell is net of export or gross is not stated by the workbook.",
  },
};

const cppGrossGeneration: RegistryEntry = {
  key: "cpp_gross_generation",
  meaning: "Gross electricity generated by the captive power plant (CPP), in kWh. Includes own use and export.",
  standardUnit: "kWh",
  dimension: "energy",
  validation: { finite: true, nonNegative: true, allowedUnits: ["kWh", "MWh"] },
  members: [
    { surface: "proforma_cell", name: "pf.cpp_kwh", unit: "kWh", period: "annual", basis: { kind: "none" }, note: "Workbook unit is Lakh kWh." },
    {
      surface: "desk_reader",
      name: "cpp.kwh_sum",
      unit: "kWh",
      period: "period_total",
      basis: { kind: "none" },
      note: "Sum from the CPP generation log workbook.",
    },
  ],
  excluded: [
    {
      surface: "desk_manual",
      name: "cpp.report_lakh_kwh",
      reason: "The manual slot's unit is 'Lakh kWh', which the normaliser cannot parse. The value is accessible via the CPP reader (cpp.kwh_sum). Revisit when the unit system supports 'Lakh kWh'.",
    },
  ],
  source: { status: "provisional", note: "Pack CPP stream — quantity path pf.cpp_kwh." },
};

// ---------------------------------------------------------------------------
// 6. CLINKER CHEMISTRY — excluded from entries: unit "%" not parseable by normalizer.
//    clinker.cao_pct / clinker.mgo_pct are classified in clinkerProduction.excluded.
//    calcinationCo2 excluded: pf.calcination_co2 is set dynamically, not a proformaCells row.
//    Revisit all three when units/index.ts gains a "ratio/percent" dimension and a rule need is added.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 7. COAL LAB QUALITY — excluded from entries: unit "%" not parseable.
//    coal.nabl_moisture_pct / coal.nabl_inherent_moisture_pct are classified in coalGcv.excluded
//    (or coalConsumed). lab.moisture_mean_pct / lab.ash_mean_pct / lab.hydrogen_mean_pct are set
//    by reader body code, not in any rule's needs array.
//    Revisit when units support "%" and rule needs are added.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 8. CLINKER STOCK (mass balance — corroboration readings only)
// ---------------------------------------------------------------------------

const clinkerStockOpening: RegistryEntry = {
  key: "clinker_stock_opening",
  meaning: "Opening clinker stock at the start of the compliance year, in tonnes. Mass-balance input only.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "desk_manual", name: "mpr.clinker_opening_t", unit: "t", period: "document_period", basis: { kind: "none" } },
  ],
  excluded: [],
  source: { status: "provisional", note: "Clinker mass-balance check in cement.ts." },
};

const clinkerStockClosing: RegistryEntry = {
  key: "clinker_stock_closing",
  meaning: "Closing clinker stock at the end of the compliance year, in tonnes. Mass-balance input only.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "desk_manual", name: "mpr.clinker_closing_t", unit: "t", period: "document_period", basis: { kind: "none" } },
  ],
  excluded: [],
  source: { status: "provisional", note: "Clinker mass-balance check in cement.ts." },
};

const clinkerImports: RegistryEntry = {
  key: "clinker_imports",
  meaning: "Clinker purchased/imported by the plant, in tonnes. Added in the mass balance; also yields equivalent product.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "desk_manual", name: "mpr.clinker_import_t", unit: "t", period: "document_period", basis: { kind: "none" } },
  ],
  excluded: [],
  source: { status: "provisional", note: "Clinker mass-balance check in cement.ts." },
};

const clinkerExports: RegistryEntry = {
  key: "clinker_exports",
  meaning: "Clinker exported/sold by the plant, in tonnes. Deducted in the mass balance.",
  standardUnit: "t",
  dimension: "mass",
  validation: { finite: true, nonNegative: true, allowedUnits: ["t", "kg"] },
  members: [
    { surface: "desk_manual", name: "mpr.clinker_export_t", unit: "t", period: "document_period", basis: { kind: "none" } },
  ],
  excluded: [],
  source: { status: "provisional", note: "Clinker mass-balance check in cement.ts." },
};

// ---------------------------------------------------------------------------
// 9. CLINKER FACTORS — excluded from entries: dimensionless "" unit not parseable.
//    pf.cf_opc, pf.cf_ppc, pf.cf_psc are classified in equivalentProduct.excluded.
//    Revisit when units/index.ts gains a "dimensionless" or "ratio" dimension.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 10. RENEWABLES / REC (corroboration)
// ---------------------------------------------------------------------------

const renewableEnergyExcluded: RegistryEntry = {
  key: "renewable_energy_excluded",
  meaning: "Renewable energy excluded from the indirect GHG calculation, in kWh. Requires REC documentation.",
  standardUnit: "kWh",
  dimension: "energy",
  validation: { finite: true, nonNegative: true, allowedUnits: ["kWh", "MWh"] },
  members: [
    { surface: "proforma_cell", name: "pf.renewable_excl", unit: "kWh", period: "annual", basis: { kind: "none" }, note: "May not exist — its absence is the finding." },
    { surface: "desk_manual", name: "rec.claim_mwh", unit: "MWh", period: "document_period", basis: { kind: "none" } },
    { surface: "desk_manual", name: "rec.purchases_mwh", unit: "MWh", period: "document_period", basis: { kind: "none" } },
  ],
  excluded: [],
  source: { status: "provisional", note: "REC check in desk review: checkRenewableClaim." },
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

export const CEMENT_REGISTRY: Registry = {
  scheme: "CCTS",
  sector: "cement",
  packId: "CCTS-CEMENT-v1",
  version: "0.2.0-provisional",
  entries: [
    // Production
    clinkerProduction,
    opcProduction,
    ppcProduction,
    pscProduction,
    equivalentProduct,
    // Coal fuel
    coalGcv,
    coalConsumed,
    coalStockOpening,
    coalStockClosing,
    coalStockReceipts,
    // Petcoke
    // petcokeGcv — excluded: pack_binding:petcoke.calorificValue is classified in coalGcv.excluded;
    //   no desk-review proforma cell or manual entry exists for petcoke GCV. Revisit when added.
    petcokeConsumed,
    // Furnace oil
    furnaceOilConsumed,
    // furnaceOilGcv — excluded: pack_proforma:furnaceOil.calorificValue and
    //   pack_binding:furnaceOil.calorificValue are classified in coalGcv.excluded.
    //   No desk-review proforma cell or manual entry for furnace-oil GCV. Revisit when added.
    // Electricity
    gridElectricityImport,
    cppGrossGeneration,
    // Clinker chemistry + process emissions
    // clinkerCaoPct / clinkerMgoPct — excluded: use unit "%" which parseUnit() cannot handle;
    //   registered desk_manual names (clinker.cao_pct / clinker.mgo_pct) are correct but the
    //   unit system does not yet support dimensionless ratios/percentages. Revisit when units/index.ts
    //   gains a "ratio" dimension. The names are classified in clinkerProduction.excluded.
    // calcinationCo2 — excluded: pf.calcination_co2 is set dynamically by the reader, not a
    //   proformaCells row; no desk-review cell or manual entry for it. Revisit when a rule need is added.
    // Coal lab quality
    // coalMoisturePct / coalAshPct / coalHydrogenPct — excluded: use unit "%" (not parseable);
    //   also lab.moisture_mean_pct / lab.ash_mean_pct / lab.hydrogen_mean_pct are written by the
    //   reader body, not in any rule's needs array. Revisit when units support "%" and rule needs are added.
    // Clinker stock (mass balance)
    clinkerStockOpening,
    clinkerStockClosing,
    clinkerImports,
    clinkerExports,
    // Clinker factors (dimensionless "" unit not parseable by normalizer; excluded until
    //   units/index.ts gains a "ratio" dimension. The proforma cells are classifed here as excluded.)
    // Renewables
    renewableEnergyExcluded,
  ],
};

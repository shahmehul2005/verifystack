import type { Registry, RegistryEntry } from "./types";

/**
 * The cement registry, first cut: three quantities that appear both in the calculation and in desk
 * review, so that is where two definitions can actually disagree. Clinker production, coal GCV and
 * grid electricity import.
 *
 * Everything here is `provisional`: the scope and basis of each name come from reading the code that
 * uses it, not yet from a confirmed clause of the procedure. No numeric range is set.
 */

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
      surface: "pack_binding",
      name: "production",
      reason: "The pack's production binding is cement equivalent product (the pro forma's Total Equivalent Product), not clinker. The pack has no clinker input at all.",
    },
    {
      surface: "extraction_field",
      name: "production_log.production",
      reason: "One leaf for any production figure. A clinker log and an equivalent-product log land on the same name and cannot be told apart once stored.",
      landsOnPackBinding: true,
    },
    { surface: "desk_manual", name: "mpr.clinker_opening_t", reason: "A stock level, not a production quantity." },
    { surface: "desk_manual", name: "mpr.clinker_closing_t", reason: "A stock level, not a production quantity." },
    { surface: "desk_manual", name: "mpr.clinker_import_t", reason: "Clinker bought in, not produced." },
    { surface: "desk_manual", name: "mpr.clinker_export_t", reason: "Clinker sold out; production is counted before export." },
    { surface: "desk_manual", name: "clinker.cao_pct", reason: "Clinker chemistry (CaO), not a quantity of clinker." },
    { surface: "desk_manual", name: "clinker.mgo_pct", reason: "Clinker chemistry (MgO), not a quantity of clinker." },
  ],
  source: {
    status: "provisional",
    note: "Scope read from desk review's coverage and daily-agreement rules. Whether the workbook's annual cell is clinker produced or clinker consumed is not yet confirmed against the pro forma instructions.",
  },
};

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
      note: "Mean of the internal lab's dated samples, on the as-fired basis its moisture column states.",
    },
    { surface: "desk_reader", name: "lab.gcv@*", unit: "kcal/kg", period: "daily_series", basis: { kind: "fixed", basis: "ARB" } },
    {
      surface: "desk_manual",
      name: "coal.nabl_gcv",
      unit: "kcal/kg",
      period: "single_reading",
      basis: { kind: "stated_by", name: "coal.nabl_basis" },
      note: "One NABL certificate. Its basis is a separate reading and may be ADB or DB.",
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
      note: "For any fuel. With a fuelKind of coal the fact is stored as coal.calorificValue, which the cement kiln-coal binding does not read.",
    },
  ],
  excluded: [
    { surface: "desk_reader", name: "lab.gcv_n", reason: "A count of samples." },
    { surface: "desk_reader", name: "lab.gcv_months", reason: "A count of months covered." },
    { surface: "desk_reader", name: "pf.gcv_ncv_ref", reason: "The address of the GCV-to-NCV factor cell, not a calorific value." },
    { surface: "extraction_field", name: "lab_certificate.calorificBasis", reason: "States the basis of a calorific value; it is a word, not a value." },
    { surface: "extraction_field", name: "fuel_invoice.calorificBasis", reason: "States the basis of a calorific value; it is a word, not a value." },
    { surface: "pack_binding", name: "furnaceOil.calorificValue", reason: "Furnace oil's calorific value, a different fuel." },
    { surface: "pack_proforma", name: "furnaceOil.calorificValue", reason: "The pro forma row for furnace oil's calorific value, a different fuel." },
    { surface: "pack_binding", name: "petcoke.calorificValue", reason: "Petroleum coke's calorific value, a different fuel." },
    { surface: "pack_binding", name: "lignite.calorificValue", reason: "Lignite's calorific value, a different fuel." },
    { surface: "pack_binding", name: "naturalGas.calorificValue", reason: "Natural gas's calorific value, a different fuel." },
    { surface: "pack_binding", name: "biomass.calorificValue", reason: "Biomass's calorific value, a different fuel." },
  ],
  source: {
    status: "provisional",
    note: "Basis and span of each name are read from the rules that use them (gcv_nabl_corroboration, gcv_basis_nabl). Whether the pro forma's cell is GCV as received or on another basis is not stated by the workbook.",
  },
};

const gridElectricityImport: RegistryEntry = {
  key: "grid_electricity_import",
  meaning: "Electricity drawn from the grid, in kWh. Active energy; not apparent energy (kVAh), not exported power.",
  standardUnit: "kWh",
  dimension: "energy",
  validation: { finite: true, nonNegative: true, allowedUnits: ["kWh", "MWh"] },
  members: [
    { surface: "proforma_cell", name: "pf.grid_kwh", unit: "kWh", period: "annual", basis: { kind: "none" }, note: "Workbook unit is Lakh kWh; the cell is scaled to kWh." },
    { surface: "pack_proforma", name: "activeEnergy", unit: "kWh", period: "annual", basis: { kind: "none" }, pairedWith: "pf.grid_kwh" },
    { surface: "proforma_cell", name: "pf.s2_grid_import_kwh", unit: "kWh", period: "annual", basis: { kind: "none" }, note: "Sheet 2's own figure for the same import; desk review ties it to the GHG sheet." },
    {
      surface: "pack_binding",
      name: "activeEnergy",
      unit: "MWh",
      period: "annual",
      basis: { kind: "none" },
      note: "The grid stream's default unit is MWh; the pro forma states kWh.",
    },
    {
      surface: "desk_manual",
      name: "grid.bill_kwh",
      unit: "kWh",
      period: "period_total",
      basis: { kind: "none" },
      note: "Units on the bills, over the months the bills cover. Counted with grid.bill_months.",
    },
    {
      surface: "extraction_field",
      name: "electricity_bill.activeEnergy",
      unit: null,
      period: "document_period",
      basis: { kind: "none" },
      packBinds: "always",
      appliesToPaths: ["electricity.activeEnergy", "activeEnergy"],
      note: "Unit as printed. A bill may print kVAh, which is not active energy and is not in the pack's allowed units.",
    },
  ],
  excluded: [
    { surface: "proforma_cell", name: "pf.s2_grid_export_kwh", reason: "Power sent to the grid, the opposite direction; it is deducted, not added." },
    { surface: "desk_manual", name: "grid.bill_months", reason: "A count of months the bills cover." },
    { surface: "desk_reader", name: "pf.grid_import_ref", reason: "A cell address, not a quantity." },
    { surface: "desk_reader", name: "pf.grid_export_ref", reason: "A cell address, not a quantity." },
    { surface: "desk_reader", name: "pf.grid_export_sheet", reason: "A sheet name, not a quantity." },
  ],
  source: {
    status: "provisional",
    note: "Whether the Grid Import cell is net of export or gross is not stated by the workbook; desk review's sheet2_export rule treats export as a separate deduction.",
  },
};

export const CEMENT_REGISTRY: Registry = {
  scheme: "CCTS",
  sector: "cement",
  packId: "CCTS-CEMENT-v1",
  version: "0.1.0-provisional",
  entries: [clinkerProduction, coalGcv, gridElectricityImport],
};

import type { StreamDefinition, StreamCategory } from "./types";

export const CEMENT_STREAMS: StreamDefinition[] = [
  // ---------------------------------------------------------------------------
  // 1. Production & Clinker Balance (Form-Sb Section A)
  // ---------------------------------------------------------------------------
  {
    key: "equivalent_product",
    label: "Total Equivalent Product",
    category: "production",
    scope: "production",
    standardUnit: "t",
    aggregation: "sum",
    calcBindingPath: "production",
    proformaRef: "Form 1 / Form-Sb Summary",
    description: "Total equivalent cement production for compliance denominator",
    acceptableUnits: ["t", "tonne", "tonnes", "MT", "metric ton", "metric tonnes"],
  },
  {
    key: "clinker_production",
    label: "Total Clinker Production",
    category: "production",
    scope: "production",
    standardUnit: "t",
    aggregation: "sum",
    calcBindingPath: "clinker.production",
    proformaRef: "Form-Sb A3",
    description: "Gross clinker produced across all kilns",
    acceptableUnits: ["t", "tonne", "tonnes", "MT"],
  },
  {
    key: "opc_production",
    label: "OPC Cement Production",
    category: "production",
    scope: "production",
    standardUnit: "t",
    aggregation: "sum",
    calcBindingPath: "opc.production",
    proformaRef: "Form-Sb A11",
    description: "Ordinary Portland Cement produced",
    acceptableUnits: ["t", "tonne", "tonnes", "MT"],
  },
  {
    key: "ppc_production",
    label: "PPC Cement Production",
    category: "production",
    scope: "production",
    standardUnit: "t",
    aggregation: "sum",
    calcBindingPath: "ppc.production",
    proformaRef: "Form-Sb A12",
    description: "Portland Pozzolana Cement produced",
    acceptableUnits: ["t", "tonne", "tonnes", "MT"],
  },
  {
    key: "psc_production",
    label: "PSC / Composite Cement Production",
    category: "production",
    scope: "production",
    standardUnit: "t",
    aggregation: "sum",
    calcBindingPath: "psc.production",
    proformaRef: "Form-Sb A13/A14",
    description: "Portland Slag / Composite Cement produced",
    acceptableUnits: ["t", "tonne", "tonnes", "MT"],
  },

  // ---------------------------------------------------------------------------
  // 2. Solid Fuel Consumption (Form-Sb Section D)
  // ---------------------------------------------------------------------------
  {
    key: "coal_quantity",
    label: "Indian Coal Consumed",
    category: "solid_fuel",
    scope: "scope_1",
    standardUnit: "t",
    aggregation: "sum",
    calcBindingPath: "quantity",
    proformaRef: "Form-Sb D.1 (viii)",
    description: "Domestic Indian coal consumed in kiln and calciner",
    acceptableUnits: ["t", "tonne", "tonnes", "MT", "kg"],
  },
  {
    key: "coal_gcv",
    label: "Indian Coal GCV",
    category: "solid_fuel",
    scope: "scope_1",
    standardUnit: "kcal/kg",
    aggregation: "weighted_mean",
    weightStreamKey: "coal_quantity",
    calcBindingPath: "calorificValue",
    proformaRef: "Form-Sb D.1 (iii)",
    description: "Gross calorific value (as fired) of Indian coal",
    acceptableUnits: ["kcal/kg", "MJ/kg", "GJ/t", "cal/g"],
  },
  {
    key: "petcoke_quantity",
    label: "Petcoke Consumed",
    category: "solid_fuel",
    scope: "scope_1",
    standardUnit: "t",
    aggregation: "sum",
    calcBindingPath: "petcoke.quantity",
    proformaRef: "Form-Sb D.2 (viii)",
    description: "Petroleum coke consumed in kiln",
    acceptableUnits: ["t", "tonne", "tonnes", "MT", "kg"],
  },
  {
    key: "petcoke_gcv",
    label: "Petcoke GCV",
    category: "solid_fuel",
    scope: "scope_1",
    standardUnit: "kcal/kg",
    aggregation: "weighted_mean",
    weightStreamKey: "petcoke_quantity",
    calcBindingPath: "petcoke.calorificValue",
    proformaRef: "Form-Sb D.2 (iii)",
    description: "Gross calorific value of petroleum coke",
    acceptableUnits: ["kcal/kg", "MJ/kg", "GJ/t"],
  },
  {
    key: "imported_coal_quantity",
    label: "Imported Coal Consumed",
    category: "solid_fuel",
    scope: "scope_1",
    standardUnit: "t",
    aggregation: "sum",
    calcBindingPath: "importedCoal.quantity",
    proformaRef: "Form-Sb D.3 (viii)",
    description: "Imported thermal coal consumed",
    acceptableUnits: ["t", "tonne", "tonnes", "MT", "kg"],
  },
  {
    key: "imported_coal_gcv",
    label: "Imported Coal GCV",
    category: "solid_fuel",
    scope: "scope_1",
    standardUnit: "kcal/kg",
    aggregation: "weighted_mean",
    weightStreamKey: "imported_coal_quantity",
    calcBindingPath: "importedCoal.calorificValue",
    proformaRef: "Form-Sb D.3 (iii)",
    description: "Gross calorific value of imported coal",
    acceptableUnits: ["kcal/kg", "MJ/kg", "GJ/t"],
  },
  {
    key: "biomass_afr_quantity",
    label: "Biomass / Alternative Fuel (AFR)",
    category: "solid_fuel",
    scope: "scope_1",
    standardUnit: "t",
    aggregation: "sum",
    calcBindingPath: "biomass.quantity",
    proformaRef: "Form-Sb D.10/D.11 (vii)",
    description: "Biomass, RDF, or tyre chips co-processed in kiln",
    acceptableUnits: ["t", "tonne", "tonnes", "MT"],
  },
  {
    key: "biomass_afr_gcv",
    label: "Biomass / AFR GCV",
    category: "solid_fuel",
    scope: "scope_1",
    standardUnit: "kcal/kg",
    aggregation: "weighted_mean",
    weightStreamKey: "biomass_afr_quantity",
    calcBindingPath: "biomass.calorificValue",
    proformaRef: "Form-Sb D.10/D.11",
    description: "Gross calorific value of alternative fuel / biomass",
    acceptableUnits: ["kcal/kg", "MJ/kg", "GJ/t"],
  },

  // ---------------------------------------------------------------------------
  // 3. Liquid Fuel Consumption (Form-Sb Section E)
  // ---------------------------------------------------------------------------
  {
    key: "fo_quantity",
    label: "Furnace Oil (FO)",
    category: "liquid_fuel",
    scope: "scope_1",
    standardUnit: "t",
    aggregation: "sum",
    calcBindingPath: "furnaceOil.quantity",
    proformaRef: "Form-Sb E.1 (viii)",
    description: "Furnace oil consumed for kiln start-up and CPP",
    acceptableUnits: ["t", "tonne", "tonnes", "MT", "kL", "litres", "L"],
  },
  {
    key: "fo_gcv",
    label: "Furnace Oil GCV",
    category: "liquid_fuel",
    scope: "scope_1",
    standardUnit: "kcal/kg",
    aggregation: "weighted_mean",
    weightStreamKey: "fo_quantity",
    calcBindingPath: "furnaceOil.calorificValue",
    proformaRef: "Form-Sb E.1 (iv)",
    description: "Gross calorific value of furnace oil",
    acceptableUnits: ["kcal/kg", "MJ/kg", "GJ/t"],
  },
  {
    key: "hsd_quantity",
    label: "High Speed Diesel (HSD)",
    category: "liquid_fuel",
    scope: "scope_1",
    standardUnit: "kL",
    aggregation: "sum",
    calcBindingPath: "hsd.quantity",
    proformaRef: "Form-Sb E.4 (ix)",
    description: "High speed diesel consumed in DG sets and mobile equipment",
    acceptableUnits: ["kL", "t", "litres", "L"],
  },
  {
    key: "hsd_gcv",
    label: "High Speed Diesel GCV",
    category: "liquid_fuel",
    scope: "scope_1",
    standardUnit: "kcal/kg",
    aggregation: "weighted_mean",
    weightStreamKey: "hsd_quantity",
    calcBindingPath: "hsd.calorificValue",
    proformaRef: "Form-Sb E.4 (iv)",
    description: "Gross calorific value of high speed diesel",
    acceptableUnits: ["kcal/kg", "MJ/kg"],
  },

  // ---------------------------------------------------------------------------
  // 4. Gaseous Fuel Consumption (Form-Sb Section F)
  // ---------------------------------------------------------------------------
  {
    key: "natural_gas_quantity",
    label: "Natural Gas (PNG/LNG)",
    category: "gaseous_fuel",
    scope: "scope_1",
    standardUnit: "Million SCM",
    aggregation: "sum",
    calcBindingPath: "naturalGas.quantity",
    proformaRef: "Form-Sb F.1 (vii)",
    description: "Piped or liquefied natural gas consumed",
    acceptableUnits: ["Million SCM", "SCM", "MMSCM", "NM3"],
  },
  {
    key: "natural_gas_gcv",
    label: "Natural Gas GCV",
    category: "gaseous_fuel",
    scope: "scope_1",
    standardUnit: "kcal/SCM",
    aggregation: "weighted_mean",
    weightStreamKey: "natural_gas_quantity",
    calcBindingPath: "naturalGas.calorificValue",
    proformaRef: "Form-Sb F.1 (iv)",
    description: "Calorific value of natural gas",
    acceptableUnits: ["kcal/SCM", "MJ/SCM", "kcal/Nm3"],
  },

  // ---------------------------------------------------------------------------
  // 5. Electricity Consumption & Generation (Form-Sb Section C)
  // ---------------------------------------------------------------------------
  {
    key: "grid_electricity",
    label: "Purchased Grid Electricity",
    category: "electricity",
    scope: "scope_2",
    standardUnit: "kWh",
    aggregation: "sum",
    calcBindingPath: "activeEnergy",
    proformaRef: "Form-Sb C.1 (i)",
    description: "Grid HT import from State Electricity Board / DISCOM",
    acceptableUnits: ["kWh", "MWh", "Lakh kWh", "MU"],
  },
  {
    key: "cpp_generation",
    label: "Captive Power Plant (CPP) Generation",
    category: "electricity",
    scope: "scope_1",
    standardUnit: "kWh",
    aggregation: "sum",
    calcBindingPath: "cpp.generation",
    proformaRef: "Form-Sb C.2.1 (iii)",
    description: "Gross electricity generated from onsite thermal CPP",
    acceptableUnits: ["kWh", "MWh", "Lakh kWh", "MU"],
  },
  {
    key: "whrs_generation",
    label: "WHRS Generation",
    category: "electricity",
    scope: "scope_1",
    standardUnit: "kWh",
    aggregation: "sum",
    calcBindingPath: "whrs.generation",
    proformaRef: "Form-Sb C.2.4 (ii)",
    description: "Gross generation from waste heat recovery system",
    acceptableUnits: ["kWh", "MWh", "Lakh kWh", "MU"],
  },
  {
    key: "power_export",
    label: "Electricity Exported to Grid",
    category: "electricity",
    scope: "scope_2",
    standardUnit: "kWh",
    aggregation: "sum",
    calcBindingPath: "process.exportedPowerDeduction",
    proformaRef: "Form-Sb C.6",
    description: "Power exported back to the grid / open access",
    acceptableUnits: ["kWh", "MWh", "Lakh kWh", "MU"],
  },

  // ---------------------------------------------------------------------------
  // 6. Process Emissions (Form-Sb & Annexure II-G1)
  // ---------------------------------------------------------------------------
  {
    key: "calcination_co2",
    label: "Clinker Calcination CO2 (Output-based)",
    category: "process",
    scope: "scope_1",
    standardUnit: "tCO2e",
    aggregation: "sum",
    calcBindingPath: "process.calcinationEmissions",
    proformaRef: "Annexure II-G1 (Output method: 0.525 tCO2/t clinker)",
    description: "Direct process emissions from carbonate calcination",
    acceptableUnits: ["tCO2e", "tCO2", "tonne CO2", "t"],
  },
  {
    key: "raw_meal_calcination",
    label: "Raw Meal Carbonate Calcination (Input-based)",
    category: "process",
    scope: "scope_1",
    standardUnit: "tCO2e",
    aggregation: "sum",
    calcBindingPath: "process.rawMealCalcinationEmissions",
    proformaRef: "Annexure II-G1 (Input method: CaCO3 / MgCO3 stoichiometry)",
    description: "Process CO2 computed from raw meal carbonate consumption",
    acceptableUnits: ["tCO2e", "tCO2", "tonne CO2", "t"],
  },
];

export const CATEGORY_METADATA: Record<
  StreamCategory,
  { label: string; description: string; scope: "scope_1" | "scope_2" | "production" | "other" }
> = {
  production: {
    label: "Production & Balance",
    description: "Clinker, cement varieties, and equivalent product denominator",
    scope: "production",
  },
  solid_fuel: {
    label: "Solid Fuels",
    description: "Domestic coal, petcoke, imported coal, and alternative fuels",
    scope: "scope_1",
  },
  liquid_fuel: {
    label: "Liquid Fuels",
    description: "Furnace oil, high-speed diesel, and liquid alternative fuels",
    scope: "scope_1",
  },
  gaseous_fuel: {
    label: "Gaseous Fuels",
    description: "Natural gas, PNG, and LPG",
    scope: "scope_1",
  },
  electricity: {
    label: "Electricity & Generation",
    description: "Grid purchase, CPP gross generation, WHRS, and exported power",
    scope: "scope_2",
  },
  process: {
    label: "Process Emissions",
    description: "Calcination CO2 from raw meal and clinker decomposition",
    scope: "scope_1",
  },
};

/** Normalizes an input value from a stated unit to the stream's standardUnit */
export function normalizeStreamValue(
  value: number,
  fromUnit: string | null | undefined,
  toUnit: string
): number {
  if (!Number.isFinite(value)) return 0;
  if (!fromUnit) return value;
  const f = fromUnit.trim().toLowerCase();
  const t = toUnit.trim().toLowerCase();
  if (f === t) return value;

  // Electricity conversions:
  // Lakh kWh -> kWh: x 100,000
  if ((f === "lakh kwh" || f === "lakh-kwh" || f === "lac kwh") && t === "kwh") return value * 100000;
  if (f === "mu" && t === "kwh") return value * 1000000;
  if (f === "mwh" && t === "kwh") return value * 1000;
  if (f === "kwh" && (t === "lakh kwh" || t === "lakh-kwh")) return value / 100000;

  // Mass conversions:
  // kg -> t: / 1000
  if (f === "kg" && (t === "t" || t === "tonne" || t === "tonnes" || t === "mt")) return value / 1000;
  if ((f === "t" || f === "tonne" || f === "tonnes" || f === "mt") && t === "kg") return value * 1000;

  // Volume conversions:
  // L -> kL: / 1000
  if ((f === "l" || f === "litres" || f === "liter") && t === "kl") return value / 1000;
  if (f === "kl" && (t === "l" || t === "litres")) return value * 1000;

  // Energy/Calorific value:
  // MJ/kg -> kcal/kg: 1 kcal = 4.184 kJ = 0.004184 MJ -> MJ/kg / 0.004184 = ~239.0057 kcal/kg
  if (f === "mj/kg" && t === "kcal/kg") return value * (1 / 0.004184);
  if (f === "kcal/kg" && t === "mj/kg") return value * 0.004184;
  if (f === "gj/t" && t === "kcal/kg") return value * (1 / 0.004184);

  return value;
}

/** Looks up a stream definition by exact key or legacy canonical_key alias */
export function getStreamDefinition(streamOrCanonicalKey: string): StreamDefinition | undefined {
  const exact = CEMENT_STREAMS.find((s) => s.key === streamOrCanonicalKey);
  if (exact) return exact;

  // Legacy canonical_key mapping
  const ALIAS_MAP: Record<string, string> = {
    production: "equivalent_product",
    clinker_production: "clinker_production",
    coal_consumed: "coal_quantity",
    coal_stock_receipts: "coal_quantity",
    coal_gcv: "coal_gcv",
    grid_electricity_import: "grid_electricity",
    grid_electricity: "grid_electricity",
    clinker_calcination: "calcination_co2",
    calcination_co2: "calcination_co2",
    raw_meal_calcination: "raw_meal_calcination",
    petcoke_consumed: "petcoke_quantity",
    furnace_oil_consumed: "fo_quantity",
    cpp_gross_generation: "cpp_generation",
    power_export: "power_export",
    biomass_consumed: "biomass_afr_quantity",
  };

  const clean = streamOrCanonicalKey.split("#")[0].split(":")[0];
  const mappedKey = ALIAS_MAP[clean] ?? clean;
  return CEMENT_STREAMS.find((s) => s.key === mappedKey);
}

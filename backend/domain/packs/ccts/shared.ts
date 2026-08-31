import type {
  PackClauseCitation,
  PackDocType,
  PackElectricityStreamBinding,
  PackFuelStreamBinding,
  PackProcessStreamBinding,
  PackProductionBinding,
  PackQuantityBinding,
} from "../types";
import type { FuelPhase } from "../../factors";
import type { Unit } from "../../units";

/** Evidence types every CCTS GEI pack recognises. Sector packs may append more. */
export const CCTS_COMMON_TAXONOMY: PackDocType[] = [
  {
    id: "fuel_invoice",
    label: "Fuel invoice",
    extractable: true,
  },
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
  { id: "weighbridge_slip", label: "Weighbridge slip", extractable: false },
  { id: "monitoring_plan", label: "Monitoring plan", extractable: false },
];

export const CCTS_COMMON_SCHEMAS: Record<string, string> = {
  fuel_invoice: "FuelInvoiceSchema",
  tax_invoice: "TaxInvoiceSchema",
  electricity_bill: "ElectricityBillSchema",
  lab_certificate: "LabCertificateSchema",
  production_log: "ProductionLogSchema",
};

export const CCTS_UNIVERSAL_RULES = [
  "MB001",
  "CV001",
  "CV002",
  "LB001",
  "TS001",
  "EF001",
  "SM001",
  "MT001",
];

export const CCTS_UNIVERSAL_CITATIONS: PackClauseCitation[] = [
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
      "CCTS Detailed Procedure — sampling (coal monthly or per 20,000 t; raw material monthly or per 50,000 t) — sector applicability TO VERIFY",
  },
  {
    ruleId: "MT001",
    clauseRef: "ISO 14064-3 — materiality and aggregation of errors (TO VERIFY)",
  },
];

const MASS: PackQuantityBinding = {
  path: "quantity",
  units: ["kg", "t", "kt"],
  defaultUnit: "t",
};

const CV_MASS: PackQuantityBinding = {
  path: "calorificValue",
  units: ["kcal/kg", "MJ/kg", "GJ/t", "Gcal/t"],
  defaultUnit: "kcal/kg",
};

export function massQty(path: string): PackQuantityBinding {
  return { ...MASS, path };
}

export function massCv(path: string): PackQuantityBinding {
  return { ...CV_MASS, path };
}

export function fuelStream(opts: {
  streamId: string;
  label: string;
  prefix: string;
  factorKey: string;
  phase: FuelPhase;
  required?: boolean;
}): PackFuelStreamBinding {
  return {
    kind: "fuel_combustion",
    streamId: opts.streamId,
    label: opts.label,
    quantity: massQty(`${opts.prefix}.quantity`),
    calorificValue: massCv(`${opts.prefix}.calorificValue`),
    factorKey: opts.factorKey,
    factorVintage: "IPCC2006",
    phase: opts.phase,
    required: opts.required,
  };
}

export function electricityStream(opts?: {
  streamId?: string;
  label?: string;
  required?: boolean;
}): PackElectricityStreamBinding {
  return {
    kind: "electricity_import",
    streamId: opts?.streamId ?? "grid-ht",
    label: opts?.label ?? "Imported HT electricity",
    quantity: {
      path: "electricity.activeEnergy",
      units: ["kWh", "MWh", "GWh"],
      defaultUnit: "MWh",
    },
    factorKey: "cea_grid_ef",
    factorVintage: "FY2025-26",
    required: opts?.required,
  };
}

export function processStream(opts: {
  streamId: string;
  label: string;
  path: string;
  methodologyRef: string;
  required?: boolean;
}): PackProcessStreamBinding {
  return {
    kind: "process_direct",
    streamId: opts.streamId,
    label: opts.label,
    quantity: {
      path: opts.path,
      units: ["tCO2e", "kgCO2e"],
      defaultUnit: "tCO2e",
    },
    methodologyRef: opts.methodologyRef,
    required: opts.required,
  };
}

export function productionBinding(opts: {
  productUnitLabel: string;
  productLabel: string;
  units?: Unit[];
}): PackProductionBinding {
  return {
    path: "production",
    units: opts.units ?? ["t", "kt", "kg"],
    defaultUnit: "t",
    productUnitLabel: opts.productUnitLabel,
    productLabel: opts.productLabel,
  };
}

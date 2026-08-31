import type { MethodologyPack, PackDocType, PackEnergyBinding } from "../types";
import type { Unit } from "../../units";
import {
  ADEETIE_SECTORS,
  CLUSTERS_VERIFIED,
  CLUSTER_SOURCE_NOTE,
  clustersForSector,
  type AdeetieSector,
} from "./clusters";
import { ADEETIE_CLAUSE_REFS, MIN_ENERGY_SAVINGS_PCT } from "./scheme";
import {
  ADEETIE_ENERGY,
  FOUNDRY_ENERGY_BINDINGS,
  pickEnergy,
  type AdeetieEnergyKey,
} from "./energy";

export * from "./clusters";
export * from "./scheme";
export * from "./phases";
export { ADEETIE_ENERGY, FOUNDRY_ENERGY_BINDINGS, pickEnergy } from "./energy";

function slug(name: string) {
  return name
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Evidence types drawn from the ADEETIE EOI form and DPR requirements.
 *
 * Only types marked extractable have Zod schemas with mandatory provenance.
 * The rest are `extractable: false` on purpose: an unbuilt extractor declared as
 * available is worse than an honest gap, because it invites a reviewer to trust
 * a field nothing populated.
 */
const ADEETIE_DOC_TAXONOMY: PackDocType[] = [
  {
    id: "electricity_bill",
    label: "Electricity bill (HT/LT)",
    extractable: true,
    notes:
      "Supplies active energy, unit cost, contracted and maximum demand in kVA, and any renewable or open-access component.",
  },
  {
    id: "fuel_consumption_record",
    label: "Fuel consumption record / fuel invoice",
    extractable: true,
    notes: "Covers Coal/Coke, PNG, LPG, FO, Diesel and other fuels.",
  },
  {
    id: "udyam_certificate",
    label: "Udyam Registration Certificate",
    extractable: true,
    notes: "Establishes MSME status and enterprise category.",
  },
  {
    id: "production_log",
    label: "Production log",
    extractable: true,
    notes: "Supplies the SEC denominator.",
  },
  {
    id: "loan_sanction_letter",
    label: "Loan sanction letter from a Registered FI",
    extractable: false,
    notes: "Supplies sanctioned amount and interest rate. Format varies by lender.",
  },
  {
    id: "equipment_quotation",
    label: "Equipment quotation / purchase order",
    extractable: false,
    notes: "Supports the DPR project cost build-up.",
  },
  {
    id: "commissioning_certificate",
    label: "Installation & commissioning certificate",
    extractable: false,
    notes: "Establishes the M&V start date.",
  },
  {
    id: "tax_invoice",
    label: "GST / commercial tax invoice",
    extractable: true,
    notes: "Supporting evidence. Line items do not enter SEC unless bound.",
  },
  {
    id: "gst_registration",
    label: "GST registration certificate",
    extractable: false,
  },
  {
    id: "audited_financials",
    label: "Audited financial statements",
    extractable: false,
  },
  {
    id: "calibration_certificate",
    label: "Measuring instrument calibration certificate",
    extractable: false,
    notes: "Supports the meter calibration validity rule.",
  },
  {
    id: "igea_report",
    label: "Investment Grade Energy Audit report",
    extractable: false,
    notes: "Prepared by a BEE-empanelled CEA/AEA firm.",
  },
];

const ADEETIE_FIELD_SCHEMAS: Record<string, string> = {
  electricity_bill: "ElectricityBillSchema",
  fuel_consumption_record: "FuelConsumptionRecordSchema",
  udyam_certificate: "UdyamCertificateSchema",
  tax_invoice: "TaxInvoiceSchema",
  production_log: "ProductionLogSchema",
};

/** Rules every ADEETIE pack runs. */
const ADEETIE_RULES = [
  "AD-EB001",
  "AD-TS001",
  "AD-CAL001",
  "AD-SEC001",
  "AD-SAV001",
  "AD-ELG001",
  "AD-ELG002",
  "AD-ELG003",
  "AD-ELG004",
  "AD-ELG005",
];

const ADEETIE_CLAUSE_CITATIONS = [
  { ruleId: "AD-EB001", clauseRef: ADEETIE_CLAUSE_REFS.energyBalance },
  {
    ruleId: "AD-TS001",
    clauseRef:
      "BEE General Guidelines for Energy Audit — a baseline year must be complete (TO VERIFY)",
  },
  { ruleId: "AD-CAL001", clauseRef: ADEETIE_CLAUSE_REFS.calibration },
  {
    ruleId: "AD-SEC001",
    clauseRef: "Physical plausibility gate (internal control)",
  },
  { ruleId: "AD-SAV001", clauseRef: ADEETIE_CLAUSE_REFS.savings },
  { ruleId: "AD-ELG001", clauseRef: ADEETIE_CLAUSE_REFS.udyam },
  { ruleId: "AD-ELG002", clauseRef: ADEETIE_CLAUSE_REFS.cluster },
  { ruleId: "AD-ELG003", clauseRef: ADEETIE_CLAUSE_REFS.loanRange },
  { ruleId: "AD-ELG004", clauseRef: ADEETIE_CLAUSE_REFS.debtShare },
  { ruleId: "AD-ELG005", clauseRef: ADEETIE_CLAUSE_REFS.subvention },
];

const ADEETIE_DEMAND = {
  contractedDemand: {
    path: "electricity.contractedDemand",
    units: ["kVA", "MVA"] as Unit[],
    defaultUnit: "kVA" as const,
  },
  maximumDemand: {
    path: "electricity.maximumDemand",
    units: ["kVA", "MVA"] as Unit[],
    defaultUnit: "kVA" as const,
  },
};

const ENERGY_FACTORS = [
  { factorKey: "ec_coal_indian", vintage: "TO-VERIFY", role: "energy" as const },
  { factorKey: "ec_coke", vintage: "TO-VERIFY", role: "energy" as const },
  { factorKey: "ec_png", vintage: "TO-VERIFY", role: "energy" as const },
  { factorKey: "ec_lpg", vintage: "TO-VERIFY", role: "energy" as const },
  { factorKey: "ec_furnace_oil", vintage: "TO-VERIFY", role: "energy" as const },
  { factorKey: "ec_diesel", vintage: "TO-VERIFY", role: "energy" as const },
  { factorKey: "ec_biomass_briquette", vintage: "TO-VERIFY", role: "energy" as const },
];

interface SectorSpec {
  sector: AdeetieSector;
  energy: PackEnergyBinding[];
  productLabel: string;
  productUnitLabel: string;
  notes: string;
}

function energy(...keys: AdeetieEnergyKey[]): PackEnergyBinding[] {
  return pickEnergy(...keys);
}

/**
 * Typical MSME energy mix per Phase 1 sector. Optional streams are omitted when
 * facts are absent. Required streams fail the run. Every calorific default is
 * verified:false. Product units are TO VERIFY against the cluster's usual output.
 */
const SECTOR_SPECS: SectorSpec[] = [
  {
    sector: "Foundry",
    energy: FOUNDRY_ENERGY_BINDINGS,
    productLabel: "Good castings dispatched",
    productUnitLabel: "tonne_good_castings",
    notes:
      "Runnable. SEC is reported in GJ per tonne of good castings dispatched. All energy content factors are verified:false, so non-draft runs are refused until a human cites the published calorific values. The notified cluster list is unverified pending the official BEE page.",
  },
  {
    sector: "Brass",
    energy: energy("grid", "renewable", "coke", "png", "lpg", "furnaceOil", "diesel"),
    productLabel: "Brass products dispatched",
    productUnitLabel: "tonne_brass_product",
    notes:
      "Runnable. SEC in GJ per tonne of brass product. Melting is typically coke or induction; both paths are declared. Factors and clusters unverified.",
  },
  {
    sector: "Bricks",
    energy: [
      { ...ADEETIE_ENERGY.coal, required: true },
      ADEETIE_ENERGY.gridOptional,
      ADEETIE_ENERGY.biomass,
      ADEETIE_ENERGY.diesel,
    ],
    productLabel: "Fired bricks",
    productUnitLabel: "tonne_fired_bricks",
    notes:
      "Runnable. SEC in GJ per tonne of fired bricks (not per thousand bricks — that unit is not in the registry). Coal is required; electricity is often small at clamp/Hoffman units. Factors and clusters unverified.",
  },
  {
    sector: "Ceramics",
    energy: energy("grid", "renewable", "png", "coal", "furnaceOil", "diesel", "biomass"),
    productLabel: "Ceramic product",
    productUnitLabel: "tonne_ceramic_product",
    notes:
      "Runnable. SEC in GJ per tonne of ceramic product (tiles / sanitaryware weighting TO VERIFY). Morbi-type units are PNG-dominated. Factors and clusters unverified.",
  },
  {
    sector: "Chemicals",
    energy: energy("grid", "renewable", "coal", "png", "furnaceOil", "diesel", "lpg"),
    productLabel: "Chemical product",
    productUnitLabel: "tonne_chemical_product",
    notes:
      "Runnable. SEC in GJ per tonne of chemical product — product definition is plant-specific and TO VERIFY. Factors and clusters unverified.",
  },
  {
    sector: "Fisheries",
    energy: energy("grid", "renewable", "diesel", "lpg"),
    productLabel: "Processed seafood",
    productUnitLabel: "tonne_processed_seafood",
    notes:
      "Runnable. SEC in GJ per tonne of processed seafood (ice-plant / cold-chain boundary TO VERIFY). Factors and clusters unverified.",
  },
  {
    sector: "Food Processing",
    energy: energy(
      "grid",
      "renewable",
      "coal",
      "png",
      "furnaceOil",
      "diesel",
      "biomass",
      "lpg"
    ),
    productLabel: "Processed food",
    productUnitLabel: "tonne_processed_food",
    notes:
      "Runnable. SEC in GJ per tonne of processed food (rice-mill vs other food sub-clusters TO VERIFY). Factors and clusters unverified.",
  },
  {
    sector: "Forging",
    energy: energy("grid", "renewable", "furnaceOil", "png", "lpg", "diesel", "coal"),
    productLabel: "Forged product",
    productUnitLabel: "tonne_forged_product",
    notes:
      "Runnable. SEC in GJ per tonne of forged product. Induction vs oil-fired furnaces are both declared. Factors and clusters unverified.",
  },
  {
    sector: "Glass & Refractory",
    energy: energy("grid", "renewable", "png", "furnaceOil", "coal", "diesel", "lpg"),
    productLabel: "Glass or refractory product",
    productUnitLabel: "tonne_glass_refractory",
    notes:
      "Runnable. SEC in GJ per tonne of glass or refractory product (sub-cluster split TO VERIFY). Factors and clusters unverified.",
  },
  {
    sector: "Leather",
    energy: energy("grid", "renewable", "coal", "png", "furnaceOil", "diesel"),
    productLabel: "Finished leather",
    productUnitLabel: "tonne_finished_leather",
    notes:
      "Runnable. SEC in GJ per tonne of finished leather. Some clusters report sq ft — that unit is not in the registry; convert to mass before a run. Factors and clusters unverified.",
  },
  {
    sector: "Paper",
    energy: energy("grid", "renewable", "coal", "biomass", "png", "furnaceOil", "diesel"),
    productLabel: "Paper",
    productUnitLabel: "tonne_paper",
    notes:
      "Runnable. SEC in GJ per tonne of paper. Factors and clusters unverified.",
  },
  {
    sector: "Pharma",
    energy: energy("grid", "renewable", "png", "furnaceOil", "diesel", "coal", "lpg"),
    productLabel: "Formulation / API output",
    productUnitLabel: "tonne_pharma_output",
    notes:
      "Runnable. SEC in GJ per tonne of formulation or API output (HVAC-dominated plants may need a different denominator — TO VERIFY). Factors and clusters unverified.",
  },
  {
    sector: "Steel Re-rolling",
    energy: energy("grid", "renewable", "coal", "furnaceOil", "png", "diesel"),
    productLabel: "Rolled steel",
    productUnitLabel: "tonne_rolled_steel",
    notes:
      "Runnable. SEC in GJ per tonne of rolled steel. Reheating-furnace fuel is the usual dominant stream. Factors and clusters unverified.",
  },
  {
    sector: "Textiles",
    energy: energy(
      "grid",
      "renewable",
      "coal",
      "png",
      "furnaceOil",
      "diesel",
      "biomass",
      "lpg"
    ),
    productLabel: "Yarn or fabric",
    productUnitLabel: "tonne_yarn_or_fabric",
    notes:
      "Runnable. SEC in GJ per tonne of yarn or fabric (spinning vs processing weighting TO VERIFY). Factors and clusters unverified.",
  },
];

function adeetiePack(spec: SectorSpec): MethodologyPack {
  const factorKeys = new Set(
    spec.energy
      .map((b) => b.factorKey)
      .filter((k): k is string => Boolean(k))
  );
  return {
    pack_id: `ADEETIE-${slug(spec.sector)}-v1`,
    scheme: "ADEETIE",
    sector_or_cluster: spec.sector,
    status: "runnable",
    version: "1.0.0",
    document_taxonomy: ADEETIE_DOC_TAXONOMY,
    field_schemas: ADEETIE_FIELD_SCHEMAS,
    calculation_method: "SEC",
    emission_or_energy_factors: ENERGY_FACTORS.filter((f) => factorKeys.has(f.factorKey)),
    stream_bindings: [],
    energy_bindings: spec.energy,
    demand_binding: ADEETIE_DEMAND,
    production_binding: {
      path: "production",
      units: ["t", "kg"],
      defaultUnit: "t",
      productUnitLabel: spec.productUnitLabel,
      productLabel: spec.productLabel,
    },
    sec_config: {
      reportingEnergyUnit: "GJ",
      secUnitLabel: "GJ/t",
      minSavingsPct: MIN_ENERGY_SAVINGS_PCT,
    },
    adeetie: {
      clusters: clustersForSector(spec.sector).map((c) => ({
        state: c.state,
        cluster: c.cluster,
      })),
      clusterSource: CLUSTER_SOURCE_NOTE,
      clustersVerified: CLUSTERS_VERIFIED,
    },
    reconciliation_rules: ADEETIE_RULES,
    clause_citations: ADEETIE_CLAUSE_CITATIONS,
    report_template: "adeetie-dpr-v1",
    notes: spec.notes,
  };
}

export const ADEETIE_PACKS: MethodologyPack[] = SECTOR_SPECS.map(adeetiePack);

export const ADEETIE_FOUNDRY_V1: MethodologyPack = ADEETIE_PACKS.find(
  (p) => p.sector_or_cluster === "Foundry"
)!;

import type { MethodologyPack, PackFactorRef, PackStreamBinding } from "../types";
import {
  CCTS_COMMON_SCHEMAS,
  CCTS_COMMON_TAXONOMY,
  CCTS_UNIVERSAL_CITATIONS,
  CCTS_UNIVERSAL_RULES,
  electricityStream,
  fuelStream,
  processStream,
  productionBinding,
} from "./shared";

const GRID: PackFactorRef = {
  factorKey: "cea_grid_ef",
  vintage: "FY2025-26",
  role: "grid",
};

function cctsPack(opts: {
  pack_id: string;
  sector: string;
  notes: string;
  extraTaxonomy?: MethodologyPack["document_taxonomy"];
  factors: PackFactorRef[];
  streams: PackStreamBinding[];
  productUnitLabel: string;
  productLabel: string;
}): MethodologyPack {
  return {
    pack_id: opts.pack_id,
    scheme: "CCTS",
    sector_or_cluster: opts.sector,
    status: "runnable",
    version: "1.0.0",
    document_taxonomy: [...CCTS_COMMON_TAXONOMY, ...(opts.extraTaxonomy ?? [])],
    field_schemas: CCTS_COMMON_SCHEMAS,
    calculation_method: "GEI",
    emission_or_energy_factors: opts.factors,
    stream_bindings: opts.streams,
    production_binding: productionBinding({
      productUnitLabel: opts.productUnitLabel,
      productLabel: opts.productLabel,
    }),
    reconciliation_rules: CCTS_UNIVERSAL_RULES,
    clause_citations: CCTS_UNIVERSAL_CITATIONS,
    report_template: "ccts-gei-form-ab-v1",
    notes: opts.notes,
  };
}

/**
 * Membrane-cell chlor-alkali is electricity-dominated. Equivalent product is
 * typically tonnes of caustic soda (NaOH) equivalent — TO VERIFY against the
 * gazetted CCTS chlor-alkali methodology (chlorine / hydrogen weighting).
 */
export const CCTS_CHLOR_ALKALI_V1: MethodologyPack = cctsPack({
  pack_id: "CCTS-CHLOR-ALKALI-v1",
  sector: "Chlor-Alkali",
  productUnitLabel: "tonne_equivalent_caustic_soda",
  productLabel: "Caustic soda equivalent",
  factors: [
    GRID,
    { factorKey: "ef_coal_subbituminous", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_furnace_oil", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_natural_gas", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_hydrogen_process", vintage: "TO-VERIFY", role: "process" },
  ],
  streams: [
    electricityStream({
      streamId: "grid-cells",
      label: "Imported electricity (electrolysis and ancillaries)",
      required: true,
    }),
    fuelStream({
      streamId: "coal-boilers",
      label: "Coal (steam / boilers)",
      prefix: "coal",
      factorKey: "ef_coal_subbituminous",
      phase: "solid",
    }),
    fuelStream({
      streamId: "furnace-oil",
      label: "Furnace oil",
      prefix: "furnaceOil",
      factorKey: "ef_furnace_oil",
      phase: "liquid",
    }),
    fuelStream({
      streamId: "natural-gas",
      label: "Natural gas",
      prefix: "naturalGas",
      factorKey: "ef_natural_gas",
      phase: "gaseous",
    }),
    processStream({
      streamId: "carbonate-process",
      label: "Process CO2 (carbonate / other non-combustion)",
      path: "process.directEmissions",
      methodologyRef:
        "CCTS Chlor-Alkali methodology — non-combustion process emissions (TO VERIFY). Supply as tCO2e; this engine does not derive cell chemistry.",
    }),
  ],
  notes:
    "Runnable. Denominator is tonnes of caustic-soda equivalent — confirm chlorine/hydrogen weighting in the gazetted methodology before filing. Cell-room electricity is required. Factors verified:false. Draft mode only until CEA vintage and equivalent-product definition are verified.",
});

/**
 * Pulp & paper GEI is typically tCO2e per tonne of equivalent paper. Recovery
 * boilers (black liquor) are often biogenic; the stream is declared so a
 * reviewer can include or omit it rather than hiding it.
 */
export const CCTS_PULP_AND_PAPER_V1: MethodologyPack = cctsPack({
  pack_id: "CCTS-PULP-AND-PAPER-v1",
  sector: "Pulp & Paper",
  productUnitLabel: "tonne_equivalent_paper",
  productLabel: "Equivalent paper",
  extraTaxonomy: [
    {
      id: "lime_kiln_log",
      label: "Lime kiln / recausticising process log",
      extractable: false,
      notes: "Supports the lime-kiln process_direct stream. Plant-specific format.",
    },
  ],
  factors: [
    GRID,
    { factorKey: "ef_coal_subbituminous", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_natural_gas", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_furnace_oil", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_charcoal", vintage: "IPCC2006", role: "fuel" },
  ],
  streams: [
    fuelStream({
      streamId: "coal",
      label: "Coal (power and process steam)",
      prefix: "coal",
      factorKey: "ef_coal_subbituminous",
      phase: "solid",
    }),
    fuelStream({
      streamId: "natural-gas",
      label: "Natural gas",
      prefix: "naturalGas",
      factorKey: "ef_natural_gas",
      phase: "gaseous",
    }),
    fuelStream({
      streamId: "furnace-oil",
      label: "Furnace oil",
      prefix: "furnaceOil",
      factorKey: "ef_furnace_oil",
      phase: "liquid",
    }),
    fuelStream({
      streamId: "black-liquor",
      label: "Black liquor (recovery boiler)",
      prefix: "blackLiquor",
      factorKey: "ef_charcoal",
      phase: "solid",
    }),
    electricityStream({ required: true }),
    processStream({
      streamId: "lime-kiln",
      label: "Lime kiln calcination",
      path: "process.limeKilnEmissions",
      methodologyRef:
        "IPCC 2006 Vol.3 / CCTS Pulp & Paper — lime kiln process CO2 (TO VERIFY). Biogenic treatment of black liquor must be confirmed before including that stream in a compliance total.",
    }),
  ],
  notes:
    "Runnable. Denominator is tonnes of equivalent paper (TO VERIFY sub-grade weighting). Black liquor uses a biomass-carbon placeholder (ef_charcoal); CCTS biogenic treatment is TO VERIFY — omitting the stream is safer than filing it. Factors verified:false.",
});

/**
 * Ammonia/urea plants: natural gas is both fuel and feedstock. Feedstock carbon
 * that leaves as process CO2 is a process_direct quantity, not a combustion factor.
 */
export const CCTS_FERTILIZER_V1: MethodologyPack = cctsPack({
  pack_id: "CCTS-FERTILIZER-v1",
  sector: "Fertilizer",
  productUnitLabel: "tonne_urea_equivalent",
  productLabel: "Urea equivalent",
  extraTaxonomy: [
    {
      id: "ammonia_carbon_balance",
      label: "Ammonia feedstock carbon balance",
      extractable: false,
      notes: "Supports the process_direct feedstock stream. No general extractor.",
    },
  ],
  factors: [
    GRID,
    { factorKey: "ef_natural_gas", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_furnace_oil", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_coal_subbituminous", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_ammonia_feedstock", vintage: "TO-VERIFY", role: "process" },
  ],
  streams: [
    fuelStream({
      streamId: "natural-gas-fuel",
      label: "Natural gas (fuel)",
      prefix: "naturalGas",
      factorKey: "ef_natural_gas",
      phase: "gaseous",
    }),
    fuelStream({
      streamId: "furnace-oil",
      label: "Furnace oil",
      prefix: "furnaceOil",
      factorKey: "ef_furnace_oil",
      phase: "liquid",
    }),
    fuelStream({
      streamId: "coal",
      label: "Coal",
      prefix: "coal",
      factorKey: "ef_coal_subbituminous",
      phase: "solid",
    }),
    electricityStream({ required: true }),
    processStream({
      streamId: "ammonia-feedstock",
      label: "Ammonia / urea feedstock process CO2",
      path: "process.feedstockEmissions",
      methodologyRef:
        "CCTS Fertilizer / IPCC 2006 Vol.3 Ch.3 ammonia process emissions (TO VERIFY). Do not apply the combustion EF to feedstock gas — supply the mass-balance tCO2e.",
    }),
  ],
  notes:
    "Runnable. Denominator is tonnes of urea equivalent (TO VERIFY ammonia/complex weighting). Feedstock carbon is a process_direct quantity. Factors verified:false.",
});

/**
 * Petrochemicals cover olefins, polymers, aromatics and fibre. The equivalent
 * product is sub-sector specific; this pack uses a generic tonne of equivalent
 * product so a run can be formed, and flags the definition as TO VERIFY.
 */
export const CCTS_PETROCHEMICALS_V1: MethodologyPack = cctsPack({
  pack_id: "CCTS-PETROCHEMICALS-v1",
  sector: "Petrochemicals",
  productUnitLabel: "tonne_equivalent_product",
  productLabel: "Petrochemical equivalent product",
  factors: [
    GRID,
    { factorKey: "ef_naphtha", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_natural_gas", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_furnace_oil", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_coal_subbituminous", vintage: "IPCC2006", role: "fuel" },
  ],
  streams: [
    fuelStream({
      streamId: "naphtha",
      label: "Naphtha (fuel / furnace)",
      prefix: "naphtha",
      factorKey: "ef_naphtha",
      phase: "liquid",
    }),
    fuelStream({
      streamId: "natural-gas",
      label: "Natural gas",
      prefix: "naturalGas",
      factorKey: "ef_natural_gas",
      phase: "gaseous",
    }),
    fuelStream({
      streamId: "furnace-oil",
      label: "Furnace oil",
      prefix: "furnaceOil",
      factorKey: "ef_furnace_oil",
      phase: "liquid",
    }),
    fuelStream({
      streamId: "coal",
      label: "Coal",
      prefix: "coal",
      factorKey: "ef_coal_subbituminous",
      phase: "solid",
    }),
    electricityStream({ required: true }),
    processStream({
      streamId: "feedstock-oxidation",
      label: "Feedstock / process oxidation CO2",
      path: "process.feedstockEmissions",
      methodologyRef:
        "CCTS Petrochemicals methodology — non-energy feedstock carbon (TO VERIFY). Sub-sector equivalent-product definition must be confirmed before a GEI is compared to a notified target.",
    }),
  ],
  notes:
    "Runnable. Equivalent-product definition is sub-sector specific (olefins / polymers / aromatics / fibre) and is TO VERIFY. Factors verified:false. Do not file against a notified trajectory until the denominator matches the gazette.",
});

/**
 * Refining GEI may use crude throughput or a complexity-weighted tonne (CWT).
 * This pack uses crude throughput as a runnable denominator and states CWT as
 * TO VERIFY — using the wrong denominator silently misstates intensity.
 */
export const CCTS_PETROLEUM_REFINING_V1: MethodologyPack = cctsPack({
  pack_id: "CCTS-PETROLEUM-REFINING-v1",
  sector: "Petroleum Refining",
  productUnitLabel: "tonne_crude_throughput",
  productLabel: "Crude throughput",
  extraTaxonomy: [
    {
      id: "hydrogen_plant_log",
      label: "Hydrogen plant / FCC coke log",
      extractable: false,
      notes: "Supports process_direct hydrogen and FCC coke streams.",
    },
  ],
  factors: [
    GRID,
    { factorKey: "ef_refinery_gas", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_furnace_oil", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_petcoke", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_natural_gas", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_naphtha", vintage: "IPCC2006", role: "fuel" },
  ],
  streams: [
    fuelStream({
      streamId: "refinery-gas",
      label: "Refinery fuel gas",
      prefix: "refineryGas",
      factorKey: "ef_refinery_gas",
      phase: "gaseous",
    }),
    fuelStream({
      streamId: "furnace-oil",
      label: "Fuel oil / residual",
      prefix: "furnaceOil",
      factorKey: "ef_furnace_oil",
      phase: "liquid",
    }),
    fuelStream({
      streamId: "fcc-coke",
      label: "FCC / petcoke combustion",
      prefix: "petcoke",
      factorKey: "ef_petcoke",
      phase: "solid",
    }),
    fuelStream({
      streamId: "natural-gas",
      label: "Natural gas",
      prefix: "naturalGas",
      factorKey: "ef_natural_gas",
      phase: "gaseous",
    }),
    electricityStream({ required: true }),
    processStream({
      streamId: "hydrogen-plant",
      label: "Hydrogen plant process CO2",
      path: "process.hydrogenEmissions",
      methodologyRef:
        "CCTS Petroleum Refining / IPCC 2006 Vol.3 — hydrogen production process emissions (TO VERIFY). Confirm whether the notified GEI uses crude throughput or CWT before comparing to a target.",
    }),
  ],
  notes:
    "Runnable. Denominator is tonnes of crude throughput. If the gazetted CCTS refining GEI uses CWT (complexity-weighted tonne), this denominator is wrong and the intensity cannot be compared to a notified target until the pack is corrected. Factors verified:false.",
});

/**
 * Textiles GEI spans spinning, composite, and processing units with different
 * equivalent products (yarn vs fabric vs processed fabric). This pack uses
 * tonnes of equivalent textile product and flags the sub-sector split.
 */
export const CCTS_TEXTILES_V1: MethodologyPack = cctsPack({
  pack_id: "CCTS-TEXTILES-v1",
  sector: "Textiles",
  productUnitLabel: "tonne_equivalent_textile",
  productLabel: "Equivalent textile product",
  factors: [
    GRID,
    { factorKey: "ef_coal_subbituminous", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_natural_gas", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_furnace_oil", vintage: "IPCC2006", role: "fuel" },
    { factorKey: "ef_diesel", vintage: "IPCC2006", role: "fuel" },
  ],
  streams: [
    fuelStream({
      streamId: "coal",
      label: "Coal (captive steam / thermic fluid)",
      prefix: "coal",
      factorKey: "ef_coal_subbituminous",
      phase: "solid",
    }),
    fuelStream({
      streamId: "natural-gas",
      label: "Natural gas / PNG",
      prefix: "naturalGas",
      factorKey: "ef_natural_gas",
      phase: "gaseous",
    }),
    fuelStream({
      streamId: "furnace-oil",
      label: "Furnace oil",
      prefix: "furnaceOil",
      factorKey: "ef_furnace_oil",
      phase: "liquid",
    }),
    fuelStream({
      streamId: "diesel",
      label: "Diesel (DG)",
      prefix: "diesel",
      factorKey: "ef_diesel",
      phase: "liquid",
    }),
    electricityStream({ required: true }),
  ],
  notes:
    "Runnable. Denominator is tonnes of equivalent textile product — spinning / composite / processing weighting is TO VERIFY against the gazetted methodology. Factors verified:false.",
});

export const CCTS_REMAINING_PACKS: MethodologyPack[] = [
  CCTS_CHLOR_ALKALI_V1,
  CCTS_PULP_AND_PAPER_V1,
  CCTS_FERTILIZER_V1,
  CCTS_PETROCHEMICALS_V1,
  CCTS_PETROLEUM_REFINING_V1,
  CCTS_TEXTILES_V1,
];

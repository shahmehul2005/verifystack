import type { PackEnergyBinding, PackQuantityBinding } from "../types";

const KWH: PackQuantityBinding = {
  path: "electricity.activeEnergy",
  units: ["kWh", "MWh"],
  defaultUnit: "kWh",
};

const MASS: PackQuantityBinding = {
  path: "quantity",
  units: ["kg", "t"],
  defaultUnit: "t",
};

const CV_MASS: PackQuantityBinding = {
  path: "calorificValue",
  units: ["kcal/kg", "MJ/kg"],
  defaultUnit: "kcal/kg",
};

/**
 * Named energy streams every ADEETIE pack composes from.
 *
 * Fact paths are qualified by fuel (`coke.quantity`, not `quantity`) because an
 * ADEETIE baseline routinely carries several fuels at once.
 */
export const ADEETIE_ENERGY = {
  grid: {
    kind: "electricity",
    streamId: "grid-electricity",
    label: "Purchased electricity",
    quantity: KWH,
    required: true,
  },
  gridOptional: {
    kind: "electricity",
    streamId: "grid-electricity",
    label: "Purchased electricity",
    quantity: KWH,
  },
  renewable: {
    kind: "electricity",
    streamId: "onsite-renewable",
    label: "On-site renewable generation",
    quantity: {
      path: "electricity.renewableEnergy",
      units: ["kWh", "MWh"],
      defaultUnit: "kWh",
    },
    onSiteGeneration: true,
  },
  coal: {
    kind: "fuel_mass",
    streamId: "coal",
    label: "Coal",
    quantity: { ...MASS, path: "coal.quantity" },
    calorificValue: { ...CV_MASS, path: "coal.calorificValue" },
    factorKey: "ec_coal_indian",
    factorVintage: "TO-VERIFY",
    energyContentBasis: "GCV",
    phase: "solid",
  },
  coke: {
    kind: "fuel_mass",
    streamId: "coke",
    label: "Hard coke (cupola charge)",
    quantity: { ...MASS, path: "coke.quantity" },
    calorificValue: { ...CV_MASS, path: "coke.calorificValue" },
    factorKey: "ec_coke",
    factorVintage: "TO-VERIFY",
    energyContentBasis: "GCV",
    phase: "solid",
  },
  png: {
    kind: "fuel_volume",
    streamId: "png",
    label: "Piped natural gas",
    quantity: { path: "png.quantity", units: ["SCM", "m3"], defaultUnit: "SCM" },
    calorificValue: {
      path: "png.calorificValue",
      units: ["kcal/SCM", "MJ/SCM", "kcal/m3", "MJ/m3"],
      defaultUnit: "kcal/SCM",
    },
    factorKey: "ec_png",
    factorVintage: "TO-VERIFY",
    energyContentBasis: "GCV",
    phase: "gaseous",
  },
  lpg: {
    kind: "fuel_mass",
    streamId: "lpg",
    label: "Liquefied petroleum gas",
    quantity: { path: "lpg.quantity", units: ["kg", "t"], defaultUnit: "kg" },
    calorificValue: { ...CV_MASS, path: "lpg.calorificValue" },
    factorKey: "ec_lpg",
    factorVintage: "TO-VERIFY",
    energyContentBasis: "GCV",
    phase: "gaseous",
  },
  furnaceOil: {
    kind: "fuel_mass",
    streamId: "furnace-oil",
    label: "Furnace oil (mass basis)",
    quantity: { ...MASS, path: "furnaceOil.quantity" },
    calorificValue: { ...CV_MASS, path: "furnaceOil.calorificValue" },
    factorKey: "ec_furnace_oil",
    factorVintage: "TO-VERIFY",
    energyContentBasis: "GCV",
    phase: "liquid",
  },
  diesel: {
    kind: "fuel_volume",
    streamId: "diesel",
    label: "High speed diesel (DG sets and handling)",
    quantity: { path: "diesel.quantity", units: ["L", "kL"], defaultUnit: "L" },
    calorificValue: {
      path: "diesel.calorificValue",
      units: ["kcal/L", "MJ/L"],
      defaultUnit: "kcal/L",
    },
    factorKey: "ec_diesel",
    factorVintage: "TO-VERIFY",
    energyContentBasis: "GCV",
    phase: "liquid",
  },
  biomass: {
    kind: "fuel_mass",
    streamId: "biomass",
    label: "Biomass / briquettes",
    quantity: { ...MASS, path: "biomass.quantity" },
    calorificValue: { ...CV_MASS, path: "biomass.calorificValue" },
    factorKey: "ec_biomass_briquette",
    factorVintage: "TO-VERIFY",
    energyContentBasis: "GCV",
    phase: "solid",
  },
} as const satisfies Record<string, PackEnergyBinding>;

export type AdeetieEnergyKey = keyof typeof ADEETIE_ENERGY;

export function pickEnergy(...keys: AdeetieEnergyKey[]): PackEnergyBinding[] {
  return keys.map((k) => ({ ...ADEETIE_ENERGY[k] }));
}

/** Foundry mix — kept as a named list so existing mapper tests stay pinned. */
export const FOUNDRY_ENERGY_BINDINGS: PackEnergyBinding[] = pickEnergy(
  "grid",
  "renewable",
  "coke",
  "png",
  "lpg",
  "furnaceOil",
  "diesel"
);

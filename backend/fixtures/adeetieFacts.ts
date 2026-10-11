/**
 * Synthetic ADEETIE evidence derived from a pack's own energy bindings.
 *
 * `adeetieSeed.ts` hand-writes one Foundry engagement and the pipeline test pins
 * its numbers. This module generalises the same shape to all 14 sector packs so
 * the product has a one-click demo path, rather than only the offline pipeline.
 *
 * Nothing here is real. The magnitudes describe a mid-size MSME sized so the
 * resulting SEC lands in a plausible range for its sector, and the baseline/post
 * pair clears the 10% scheme gate. Every figure is invented.
 */

import type { MethodologyPack, PackEnergyBinding } from "@verifystack/backend/domain/packs/types";
import type { SecPhase } from "@verifystack/backend/domain/calc/sec";

export interface SyntheticFact {
  field_path: string;
  value_json: number;
  unit: string | null;
  source_text: string;
}

/**
 * Baseline annual quantity per stream, in the binding's default unit, plus the
 * measured calorific value a lab report would carry. `diesel` deliberately has
 * no calorific value so the run falls back to the registry default and warns —
 * that fallback is a control worth showing, not a gap to paper over.
 */
const BASELINE: Record<
  string,
  { quantity: number; source: string; calorificValue?: number; cvSource?: string }
> = {
  "grid-electricity": {
    quantity: 4_812_000,
    source: "Total units consumed 48,12,000",
  },
  coal: {
    quantity: 2_400,
    source: "Coal received 2,400 MT",
    calorificValue: 4_200,
    cvSource: "GCV 4,200 kcal/kg",
  },
  coke: {
    quantity: 1_640,
    source: "Hard coke received 1,640 MT",
    calorificValue: 6_420,
    cvSource: "GCV 6,420 kcal/kg",
  },
  png: {
    quantity: 620_000,
    source: "PNG drawn 6,20,000 SCM",
    calorificValue: 8_500,
    cvSource: "GCV 8,500 kcal/SCM",
  },
  lpg: {
    quantity: 96_000,
    source: "LPG consumed 96,000 kg",
    calorificValue: 11_000,
    cvSource: "GCV 11,000 kcal/kg",
  },
  "furnace-oil": {
    quantity: 540,
    source: "Furnace oil issued 540 MT",
    calorificValue: 9_800,
    cvSource: "GCV 9,800 kcal/kg",
  },
  diesel: {
    quantity: 38_400,
    source: "HSD issued 38,400 litres",
  },
  biomass: {
    quantity: 1_800,
    source: "Briquettes received 1,800 MT",
    calorificValue: 3_600,
    cvSource: "GCV 3,600 kcal/kg",
  },
};

const BASELINE_PRODUCTION = 9_450;
const POST_PRODUCTION = 9_610;

/**
 * Energy reduction applied to every stream in the post-implementation year.
 * With output rising slightly, this puts measured savings a little over the 10%
 * minimum rather than comfortably clear of it, which is the more instructive
 * case to review.
 */
const POST_ENERGY_RATIO = 0.874;

const DEMAND_BASELINE = { contracted: 1_250, maximum: 1_085 };
const DEMAND_POST = { contracted: 1_100, maximum: 940 };

/**
 * Streams a synthetic plant is given.
 *
 * Every required binding is included, because a run fails without it. Beyond
 * that only the first fuel and diesel are included: a two- or three-stream
 * baseline is what a real MSME looks like, and summing every declared fuel
 * would produce an SEC no auditor would recognise.
 */
function streamsToSeed(pack: MethodologyPack): PackEnergyBinding[] {
  const bindings = (pack.energy_bindings ?? []).filter((b) => !b.onSiteGeneration);
  const chosen: PackEnergyBinding[] = bindings.filter((b) => b.required);
  const isChosen = (b: PackEnergyBinding) => chosen.some((c) => c.streamId === b.streamId);

  const firstFuel = bindings.find((b) => b.kind !== "electricity" && !isChosen(b));
  if (firstFuel) chosen.push(firstFuel);

  const diesel = bindings.find((b) => b.streamId === "diesel" && !isChosen(b));
  if (diesel) chosen.push(diesel);

  return chosen.filter((b) => BASELINE[b.streamId] !== undefined);
}

/** Can this pack be seeded at all? Used to decide whether to show the button. */
export function canSeedAdeetiePack(pack: MethodologyPack): boolean {
  if (pack.scheme !== "ADEETIE" || pack.calculation_method !== "SEC") return false;
  if (!pack.production_binding) return false;
  const bindings = pack.energy_bindings ?? [];
  const required = bindings.filter((b) => b.required && !b.onSiteGeneration);
  const seedable = streamsToSeed(pack);
  // Every required stream must have a magnitude, or the run would fail on a
  // stream this module cannot populate.
  return (
    seedable.length > 0 &&
    required.every((b) => seedable.some((s) => s.streamId === b.streamId))
  );
}

export function adeetieSyntheticFacts(
  pack: MethodologyPack,
  phase: SecPhase
): SyntheticFact[] {
  const post = phase === "post_implementation";
  const facts: SyntheticFact[] = [];

  for (const binding of streamsToSeed(pack)) {
    const base = BASELINE[binding.streamId]!;
    const quantity = post
      ? roundTo(base.quantity * POST_ENERGY_RATIO, binding.quantity.defaultUnit)
      : base.quantity;
    facts.push({
      field_path: binding.quantity.path,
      value_json: quantity,
      unit: binding.quantity.defaultUnit,
      source_text: post ? `${base.source} (post-implementation year)` : base.source,
    });

    // A measured calorific value overrides the registry default. Carrying it
    // unchanged across both years keeps the movement an efficiency change
    // rather than a fuel-quality change, which keeps the comparability check
    // on the savings assessment clean.
    if (binding.calorificValue && base.calorificValue != null) {
      facts.push({
        field_path: binding.calorificValue.path,
        value_json: base.calorificValue,
        unit: binding.calorificValue.defaultUnit,
        source_text: base.cvSource ?? "Lab certificate",
      });
    }
  }

  const demand = post ? DEMAND_POST : DEMAND_BASELINE;
  const contracted = pack.demand_binding?.contractedDemand;
  if (contracted) {
    facts.push({
      field_path: contracted.path,
      value_json: demand.contracted,
      unit: contracted.defaultUnit,
      source_text: `Contract demand ${demand.contracted} KVA`,
    });
  }
  const maximum = pack.demand_binding?.maximumDemand;
  if (maximum) {
    facts.push({
      field_path: maximum.path,
      value_json: demand.maximum,
      unit: maximum.defaultUnit,
      source_text: `Maximum demand recorded ${demand.maximum} KVA`,
    });
  }

  const production = pack.production_binding;
  if (production) {
    const value = post ? POST_PRODUCTION : BASELINE_PRODUCTION;
    facts.push({
      field_path: production.path,
      value_json: value,
      unit: production.defaultUnit,
      source_text: `${production.productLabel} ${value.toLocaleString("en-IN")} MT`,
    });
  }

  return facts;
}

/** Enterprise and finance context so the eligibility rules have something to judge. */
export const ADEETIE_DEMO_ENTERPRISE = {
  enterpriseCategory: "Small" as const,
  udyamRegistrationNo: "UDYAM-PB-05-1234567",
  loanAmountINR: 2_00_00_000,
  projectCostINR: 3_00_00_000,
  sanctionedRatePct: 10,
} as const;

/** Measures that clear the 10% projected gate against the synthetic baseline. */
export const ADEETIE_DEMO_MEASURES = [
  {
    description: "Replace cupola with a 1.5 t medium-frequency induction furnace",
    projectedAnnualSaving: 4_100,
    savingUnit: "GJ",
    capitalCostINR: 1_85_00_000,
    basis: "Vendor heat-balance guarantee cross-checked against IGEA melt-loss measurement",
  },
  {
    description: "VFDs on induced-draught and combustion-air blowers",
    projectedAnnualSaving: 1_450,
    savingUnit: "GJ",
    capitalCostINR: 42_00_000,
    basis: "Logged motor loading over 14 days at the IGEA stage, affinity-law projection",
  },
  {
    description: "Recuperator on the holding furnace flue",
    projectedAnnualSaving: 980,
    savingUnit: "GJ",
    capitalCostINR: 28_00_000,
    basis: "Flue-gas temperature and mass-flow measurement in the IGEA report",
  },
] as const;

function roundTo(value: number, unit: string): number {
  // Whole units for anything counted in litres, kWh or SCM; one decimal for
  // tonnes, where a fractional value is normal on a weighbridge slip.
  const wholeUnits = ["kWh", "MWh", "L", "kL", "SCM", "m3", "kg"];
  return wholeUnits.includes(unit)
    ? Math.round(value)
    : Math.round(value * 10) / 10;
}

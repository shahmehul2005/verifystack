/**
 * Synthetic ADEETIE Foundry engagement.
 *
 * Every figure here is invented for a demo plant that does not exist. It is shaped
 * to exercise the parts of the SEC path that matter: a coke-plus-electricity energy
 * mix, a measured calorific value on one fuel and a registry default on another, a
 * kVA demand that must stay out of the energy total, and a baseline/post pair that
 * lands just clear of the 10% gate.
 */

import type { ProvenancedFact } from "@verifystack/backend/domain/calc/run";
import type { AdeetieEligibilityInput } from "@verifystack/backend/domain/rules/adeetie";

export const ADEETIE_SEED_ENGAGEMENT = {
  id: "eng-batala-foundry-fy2425",
  client: "Satluj Castings Pvt Ltd (synthetic demo enterprise)",
  plant: "Batala unit 1",
  scheme: "ADEETIE" as const,
  sector: "Foundry",
  packId: "ADEETIE-FOUNDRY-v1",
  packVersion: "1.0.0",
  state: "Punjab",
  cluster: "Batala, Jalandhar & Ludhiana",
  category: "Small" as const,
  udyamRegistrationNo: "UDYAM-PB-05-1234567",
  baselinePeriod: "FY2024-25",
  postPeriod: "FY2026-27",
  loanAmountINR: 2_00_00_000,
  projectCostINR: 3_00_00_000,
  sanctionedRatePct: 10,
  draftMode: true,
} as const;

function f(
  id: string,
  fieldPath: string,
  value: number,
  unit: string | null,
  documentId: string,
  sourceText: string,
  page = 1
): ProvenancedFact {
  return {
    id,
    field_path: fieldPath,
    value_json: value,
    unit,
    document_id: documentId,
    page,
    bbox: { x: 0.5, y: 0.42, width: 0.3, height: 0.045 },
    source_text: sourceText,
  };
}

/** Baseline year evidence. */
export const ADEETIE_BASELINE_FACTS: ProvenancedFact[] = [
  f(
    "ad-fact-elec",
    "electricity.activeEnergy",
    4_812_000,
    "kWh",
    "ad-doc-elec",
    "Total units consumed 48,12,000"
  ),
  f(
    "ad-fact-cd",
    "electricity.contractedDemand",
    1_250,
    "kVA",
    "ad-doc-elec",
    "Contract demand 1250 KVA"
  ),
  f(
    "ad-fact-md",
    "electricity.maximumDemand",
    1_085,
    "kVA",
    "ad-doc-elec",
    "Maximum demand recorded 1085 KVA"
  ),
  f(
    "ad-fact-coke-qty",
    "coke.quantity",
    1_640,
    "t",
    "ad-doc-coke",
    "Hard coke received 1,640 MT"
  ),
  f(
    "ad-fact-coke-cv",
    "coke.calorificValue",
    6_420,
    "kcal/kg",
    "ad-doc-coke-lab",
    "GCV 6,420 kcal/kg"
  ),
  // No calorific value supplied for diesel, so the registry default applies and the
  // engine warns about it.
  f(
    "ad-fact-diesel",
    "diesel.quantity",
    38_400,
    "L",
    "ad-doc-diesel",
    "HSD issued 38,400 litres"
  ),
  f(
    "ad-fact-prod",
    "production",
    9_450,
    "t",
    "ad-doc-prod",
    "Good castings dispatched 9,450 MT"
  ),
];

/**
 * Post-implementation evidence. Same streams, same output basis — the movement is a
 * genuine efficiency change rather than a boundary change, so the comparability
 * check stays clean.
 */
export const ADEETIE_POST_FACTS: ProvenancedFact[] = [
  f(
    "ad-post-elec",
    "electricity.activeEnergy",
    4_205_000,
    "kWh",
    "ad-post-doc-elec",
    "Total units consumed 42,05,000"
  ),
  f(
    "ad-post-cd",
    "electricity.contractedDemand",
    1_100,
    "kVA",
    "ad-post-doc-elec",
    "Contract demand 1100 KVA"
  ),
  f(
    "ad-post-md",
    "electricity.maximumDemand",
    940,
    "kVA",
    "ad-post-doc-elec",
    "Maximum demand recorded 940 KVA"
  ),
  f(
    "ad-post-coke-qty",
    "coke.quantity",
    1_452,
    "t",
    "ad-post-doc-coke",
    "Hard coke received 1,452 MT"
  ),
  f(
    "ad-post-coke-cv",
    "coke.calorificValue",
    6_420,
    "kcal/kg",
    "ad-post-doc-coke-lab",
    "GCV 6,420 kcal/kg"
  ),
  f(
    "ad-post-diesel",
    "diesel.quantity",
    34_100,
    "L",
    "ad-post-doc-diesel",
    "HSD issued 34,100 litres"
  ),
  f(
    "ad-post-prod",
    "production",
    9_610,
    "t",
    "ad-post-doc-prod",
    "Good castings dispatched 9,610 MT"
  ),
];

export const ADEETIE_SEED_ELIGIBILITY: AdeetieEligibilityInput = {
  enterpriseName: ADEETIE_SEED_ENGAGEMENT.client,
  category: ADEETIE_SEED_ENGAGEMENT.category,
  udyamRegistrationNo: ADEETIE_SEED_ENGAGEMENT.udyamRegistrationNo,
  sector: ADEETIE_SEED_ENGAGEMENT.sector,
  cluster: ADEETIE_SEED_ENGAGEMENT.cluster,
  loanAmountINR: ADEETIE_SEED_ENGAGEMENT.loanAmountINR,
  projectCostINR: ADEETIE_SEED_ENGAGEMENT.projectCostINR,
  sanctionedRatePct: ADEETIE_SEED_ENGAGEMENT.sanctionedRatePct,
  factIds: ["ad-fact-udyam", "ad-fact-loan"],
};

export const ADEETIE_FY2425_MONTHS = [
  "2024-04", "2024-05", "2024-06", "2024-07", "2024-08", "2024-09",
  "2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03",
];

export const ADEETIE_SEED_DISCLAIMER =
  "Synthetic enterprise. Energy content factors are unverified placeholders and the " +
  "notified cluster list has not been read back against the official BEE publication. " +
  "AI proposes; the licensed auditor decides. Not an energy audit opinion, and not the " +
  "official BEE DPR or M&V template.";

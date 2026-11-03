/**
 * End-to-end ADEETIE demo pipeline.
 *
 * Runs the same path a real Foundry engagement takes: facts → SEC baseline →
 * SEC post-implementation → savings assessment → reconciliation and eligibility
 * rules → subvention computation. Draft mode throughout, because every energy
 * content factor in the registry is still unverified.
 */

import { buildFactorSet } from "@verifystack/backend/domain/factors";
import { executeSecRun } from "@verifystack/backend/domain/calc/secRun";
import { assessSavings, type SavingsAssessment, type SecResult } from "@verifystack/backend/domain/calc/sec";
import {
  runAdeetieRules,
  type AdeetieRuleRunResult,
} from "@verifystack/backend/domain/rules/adeetie";
import {
  computeSubvention,
  isNotifiedCluster,
  MIN_ENERGY_SAVINGS_PCT,
  type SubventionResult,
} from "@verifystack/backend/domain/packs/adeetie";
import {
  ADEETIE_BASELINE_FACTS,
  ADEETIE_FY2425_MONTHS,
  ADEETIE_POST_FACTS,
  ADEETIE_SEED_DISCLAIMER,
  ADEETIE_SEED_ELIGIBILITY,
  ADEETIE_SEED_ENGAGEMENT,
} from "./adeetieSeed";

export interface AdeetieDemoPayload {
  engagement: typeof ADEETIE_SEED_ENGAGEMENT;
  baseline: SecResult;
  post: SecResult;
  baselineInputHash: string;
  postInputHash: string;
  savings: SavingsAssessment;
  minSavingsPct: number;
  rules: AdeetieRuleRunResult;
  subvention: SubventionResult;
  clusterIsNotified: boolean;
  disclaimer: string;
}

export function runAdeetieDemoPipeline(): AdeetieDemoPayload {
  const factors = buildFactorSet("demo-factorset-0.2.0");
  const e = ADEETIE_SEED_ENGAGEMENT;

  const baselineRun = executeSecRun({
    engagementId: e.id,
    organizationId: "org-demo",
    packId: e.packId,
    packVersion: e.packVersion,
    periodLabel: e.baselinePeriod,
    phase: "baseline",
    draftMode: true,
    facts: ADEETIE_BASELINE_FACTS,
    factorSet: factors,
  });

  const postRun = executeSecRun({
    engagementId: e.id,
    organizationId: "org-demo",
    packId: e.packId,
    packVersion: e.packVersion,
    periodLabel: e.postPeriod,
    phase: "post_implementation",
    draftMode: true,
    facts: ADEETIE_POST_FACTS,
    previousRunHash: baselineRun.inputHash,
    factorSet: factors,
  });

  const savings = assessSavings(baselineRun.result, postRun.result);

  const rules = runAdeetieRules({
    baselinePeriodLabel: e.baselinePeriod,
    expectedMonths: ADEETIE_FY2425_MONTHS,
    baselineSec: baselineRun.result,
    postSec: postRun.result,
    savings,
    // A complete baseline year with the plant's own sub-metering close to billed.
    energyBalance: ADEETIE_FY2425_MONTHS.map((month, i) => ({
      month,
      billedEnergyMJ: 1_443_600,
      meteredEnergyMJ: 1_443_600 * (i === 7 ? 0.97 : 0.995),
      factIds: ["ad-fact-elec"],
    })),
    meterCalibrations: [
      {
        meterId: "EM-INCOMER-01",
        description: "Main incomer trivector meter",
        calibratedOn: "2024-03-12",
        validUntil: "2026-03-11",
        reliedOnFrom: "2024-04-01",
        reliedOnTo: "2025-03-31",
        factIds: ["ad-fact-elec"],
      },
    ],
    eligibility: ADEETIE_SEED_ELIGIBILITY,
  });

  return {
    engagement: e,
    baseline: baselineRun.result,
    post: postRun.result,
    baselineInputHash: baselineRun.inputHash,
    postInputHash: postRun.inputHash,
    savings,
    minSavingsPct: MIN_ENERGY_SAVINGS_PCT,
    rules,
    subvention: computeSubvention({
      category: e.category,
      sanctionedRatePct: e.sanctionedRatePct,
      principalINR: e.loanAmountINR,
    }),
    clusterIsNotified: isNotifiedCluster(e.sector, e.cluster),
    disclaimer: ADEETIE_SEED_DISCLAIMER,
  };
}

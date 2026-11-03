/**
 * Verification planning and risk assessment (DFD 13.0).
 *
 * Before a verifier reads evidence they decide how hard to look. The plan
 * records that decision: a rating per risk factor with the reason, the overall
 * risk that follows, the review sampling rate it implies, whether a site visit
 * is warranted, and the visits planned. Plans are versioned and immutable, and
 * approval is a lead verifier's act.
 *
 * Overall risk is the highest factor rating. That is deliberately conservative
 * and easy to explain to a reviewer: one high-risk factor makes the engagement
 * high-risk, and no average can hide it. The rates below are firm policy
 * defaults, not scheme requirements; whether a scheme prescribes a sampling or
 * site-visit regime is an open item in the regulatory register.
 */

import { z } from "zod";
import { hashCanonical } from "../canonical";

export type RiskRating = "low" | "medium" | "high";

export const RISK_RATINGS: readonly RiskRating[] = ["low", "medium", "high"];

/** Firm policy defaults, overridable by the plan. */
export const POLICY_SAMPLE_RATE: Record<RiskRating, number> = {
  low: 0.1,
  medium: 0.2,
  high: 0.4,
};

export interface RiskFactorDef {
  key: string;
  label: string;
  prompt: string;
  /** A "high" rating on this factor means a site visit is warranted regardless of the overall rating. */
  siteVisitIfHigh?: boolean;
}

/** Manual factors the verifier rates. Automatic ones come from the data (see deriveAutoFactors). */
export const RISK_FACTORS: readonly RiskFactorDef[] = [
  { key: "entity_history", label: "Entity history", prompt: "First verification, or a repeat with a clean record?" },
  { key: "data_source", label: "Data source quality", prompt: "Metered and logged, or manual and estimated?", siteVisitIfHigh: true },
  { key: "process_complexity", label: "Process complexity", prompt: "Single fuel and product, or many streams and by-products?" },
  { key: "boundary_clarity", label: "Boundary clarity", prompt: "Is the installation boundary and its meters clear?", siteVisitIfHigh: true },
  { key: "management_controls", label: "Management controls", prompt: "Are there documented controls over data collection?" },
  { key: "prior_findings", label: "Prior findings", prompt: "Open or repeated findings from earlier periods?" },
];

export const FactorRatingSchema = z.object({
  key: z.string().min(1).max(60),
  rating: z.enum(["low", "medium", "high"]),
  rationale: z.string().trim().min(5).max(1000),
});

export const PlannedVisitSchema = z.object({
  id: z.string().min(1).max(60),
  plannedFor: z.string().max(40),
  location: z.string().trim().min(2).max(200),
  scope: z.string().trim().min(5).max(1000),
  assignedTo: z.string().max(120).optional(),
});

export const PlanContentSchema = z.object({
  factors: z.array(FactorRatingSchema).max(30),
  /** Overrides the policy sampling rate for this engagement, with a reason. */
  sampleRateOverride: z
    .object({ rate: z.number().gt(0).lte(1), reason: z.string().trim().min(10).max(500) })
    .optional(),
  /** Site visit decision. `required` follows the assessment unless the verifier records a reason to waive it. */
  siteVisitWaiverReason: z.string().trim().min(10).max(500).optional(),
  visits: z.array(PlannedVisitSchema).max(50),
  notes: z.string().max(4000).optional(),
});

export type PlanContent = z.infer<typeof PlanContentSchema>;
export type FactorRating = z.infer<typeof FactorRatingSchema>;

export interface AutoFactorInputs {
  /** From declared-vs-extracted: disagreements over compared fields. */
  comparison?: { compared: number; disagree: number } | null;
  /** Emission or energy factors in use that are not marked verified. */
  unverifiedFactors?: number;
  /** Share of accepted facts that came from site observation or spreadsheet vs scanned pages is not used. */
  estimatedShare?: number | null;
}

export interface DerivedFactor {
  key: string;
  label: string;
  rating: RiskRating;
  rationale: string;
}

/** Ratings the data supports without anyone's judgement. Shown beside the manual ones. */
export function deriveAutoFactors(input: AutoFactorInputs): DerivedFactor[] {
  const out: DerivedFactor[] = [];
  if (input.comparison && input.comparison.compared > 0) {
    const share = input.comparison.disagree / input.comparison.compared;
    out.push({
      key: "declared_vs_evidence",
      label: "Declared against evidence",
      rating: share === 0 ? "low" : share <= 0.1 ? "medium" : "high",
      rationale: `${input.comparison.disagree} of ${input.comparison.compared} compared values disagree with what the entity declared.`,
    });
  }
  if (typeof input.unverifiedFactors === "number") {
    out.push({
      key: "unverified_factors",
      label: "Unverified factors",
      rating: input.unverifiedFactors === 0 ? "low" : input.unverifiedFactors <= 2 ? "medium" : "high",
      rationale: `${input.unverifiedFactors} emission or energy factor(s) in use are not marked verified.`,
    });
  }
  return out;
}

const ORDER: Record<RiskRating, number> = { low: 0, medium: 1, high: 2 };

export function maxRating(ratings: RiskRating[]): RiskRating {
  return ratings.reduce<RiskRating>((m, r) => (ORDER[r] > ORDER[m] ? r : m), "low");
}

export interface PlanAssessment {
  overall: RiskRating;
  /** The factor ratings that drove `overall` (those at the top rating). */
  drivers: string[];
  sampleRate: number;
  sampleRateSource: "policy" | "override";
  siteVisitRecommended: boolean;
  siteVisitReasons: string[];
  /** Site visit recommended, not waived, and no visit planned. */
  siteVisitGap: boolean;
  missingFactors: string[];
}

export function assessPlan(plan: PlanContent, auto: DerivedFactor[] = []): PlanAssessment {
  const rated = [...plan.factors.map((f) => ({ key: f.key, rating: f.rating })), ...auto.map((f) => ({ key: f.key, rating: f.rating }))];
  const overall = maxRating(rated.map((r) => r.rating));
  const drivers = overall === "low" ? [] : rated.filter((r) => r.rating === overall).map((r) => r.key);

  const reasons: string[] = [];
  for (const def of RISK_FACTORS) {
    if (def.siteVisitIfHigh && plan.factors.find((f) => f.key === def.key)?.rating === "high") {
      reasons.push(`${def.label} is rated high.`);
    }
  }
  if (overall === "high") reasons.push("Overall risk is high.");
  const recommended = reasons.length > 0 || overall !== "low";
  if (overall === "medium" && reasons.length === 0) reasons.push("Overall risk is medium.");

  const waived = Boolean(plan.siteVisitWaiverReason);
  const sampleRate = plan.sampleRateOverride?.rate ?? POLICY_SAMPLE_RATE[overall];
  const ratedKeys = new Set(plan.factors.map((f) => f.key));

  return {
    overall,
    drivers,
    sampleRate,
    sampleRateSource: plan.sampleRateOverride ? "override" : "policy",
    siteVisitRecommended: recommended,
    siteVisitReasons: reasons,
    siteVisitGap: recommended && !waived && plan.visits.length === 0,
    missingFactors: RISK_FACTORS.filter((f) => !ratedKeys.has(f.key)).map((f) => f.key),
  };
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

/** Approval needs every standard factor rated and a plan for the visit the assessment calls for. */
export function planApprovalBlockers(plan: PlanContent, auto: DerivedFactor[] = []): string[] {
  const a = assessPlan(plan, auto);
  const out: string[] = [];
  if (a.missingFactors.length > 0) {
    const labels = a.missingFactors.map((k) => RISK_FACTORS.find((f) => f.key === k)?.label ?? k);
    out.push(`Rate every risk factor first. Missing: ${labels.join(", ")}.`);
  }
  if (a.siteVisitGap) {
    out.push(
      `A site visit is recommended (${a.siteVisitReasons.join(" ")}). Plan a visit or record why it is not needed.`
    );
  }
  return out;
}

export function planContentHash(plan: PlanContent): string {
  return hashCanonical(plan);
}

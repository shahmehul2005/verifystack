/**
 * Risk tiers, deterministic sampling and bulk-accept eligibility (DFD 4.0, 4.2).
 *
 * The rule that does not move: an AI proposal becomes a fact only when a named
 * person accepts it. This module lets a verifier accept the long tail of
 * low-risk values in one audited action without reading each one, and makes
 * that safe with two controls:
 *
 *  1. Only low-risk values are eligible. Anything material, low-confidence,
 *     unusually evidenced, or disagreeing with what the entity declared is
 *     high-risk and always reviewed one by one.
 *  2. A deterministic sample of the low-risk values must be reviewed
 *     individually first, and a single rejection or correction in it blocks the
 *     bulk action. A sample that comes back clean is evidence the rest is fine;
 *     one that does not is evidence it is not.
 *
 * "Deterministic" matters: the sample is a function of the engagement and the
 * field ids, so it can be recomputed later and an auditor can see which values
 * were sampled. No randomness, no clock.
 *
 * The sample rate is a firm policy default, not a scheme requirement. Whether a
 * scheme prescribes a sampling regime is an open item in the regulatory register.
 */

import { createHash } from "node:crypto";
import { CONFIDENCE_POLICY } from "../extraction/schemas";

export const DEFAULT_SAMPLE_RATE = 0.2;
/** Never sample fewer than this many (or all of them, when there are fewer). */
export const MIN_SAMPLE = 3;
/** Never bulk-accept more than this many values in one action. */
export const MAX_BULK_BATCH = 500;

export type RiskTier = "high" | "low";

export interface TriageField {
  id: string;
  field_path: string;
  confidence: number;
  triage_action: "human_review" | "auto_commit";
  state: "suggested" | "accepted" | "rejected" | "corrected";
  provenance_type?: string | null;
  /** The value was drawn on the page and typed by a person, not proposed by the model. */
  snip?: boolean;
}

export interface RiskAssessment {
  tier: RiskTier;
  /** Plain reasons, shown next to the value so the verifier sees why it needs them. */
  reasons: string[];
}

function leafOf(path: string): string {
  return path.split(".").pop() ?? path;
}

export function assessRisk(
  field: Pick<TriageField, "field_path" | "confidence" | "triage_action"> & { snip?: boolean },
  opts: { declaredMismatch?: boolean } = {}
): RiskAssessment {
  const reasons: string[] = [];
  if (field.snip) {
    reasons.push("Entered from a region drawn on the page: always read by a person.");
  }
  if (CONFIDENCE_POLICY.alwaysReview.has(leafOf(field.field_path))) {
    reasons.push("High-materiality field: always reviewed.");
  }
  if (field.confidence < CONFIDENCE_POLICY.reviewBelow) {
    reasons.push(
      `Confidence ${Math.round(field.confidence * 100)}% is below ${Math.round(CONFIDENCE_POLICY.reviewBelow * 100)}%.`
    );
  }
  if (field.triage_action === "human_review" && reasons.length === 0) {
    reasons.push("Marked for review at extraction.");
  }
  if (opts.declaredMismatch) {
    reasons.push("Differs from what the entity declared.");
  }
  return { tier: reasons.length > 0 ? "high" : "low", reasons };
}

/** Stable 0..1 position for a field, from the engagement and field ids. */
export function samplePosition(engagementId: string, fieldId: string): number {
  const h = createHash("sha256").update(`${engagementId}:${fieldId}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}

/**
 * Choose the review sample from a set of low-risk fields: the k with the
 * smallest positions, where k = max(MIN_SAMPLE, ceil(rate * n)), capped at n.
 * Adding or removing unrelated fields never changes which of the remaining
 * ones rank lowest, only how many are taken.
 */
export function selectSample<T extends { id: string }>(
  engagementId: string,
  lowRisk: T[],
  rate = DEFAULT_SAMPLE_RATE
): T[] {
  if (rate <= 0 || rate > 1) throw new RangeError("Sample rate must be in (0, 1].");
  const n = lowRisk.length;
  if (n === 0) return [];
  const k = Math.min(n, Math.max(MIN_SAMPLE, Math.ceil(rate * n)));
  return [...lowRisk]
    .map((f) => ({ f, p: samplePosition(engagementId, f.id) }))
    .sort((a, b) => a.p - b.p || a.f.id.localeCompare(b.f.id))
    .slice(0, k)
    .map((x) => x.f);
}

export interface BulkPlan {
  /** Low-risk suggested values still waiting. */
  lowRiskPending: number;
  /** The sample, in the order it should be reviewed. */
  sample: Array<{ id: string; field_path: string; state: TriageField["state"] }>;
  sampleDecided: number;
  sampleRejectedOrCorrected: number;
  /** Values the bulk action would accept: low-risk, pending, outside the sample. */
  eligibleIds: string[];
  canBulkAccept: boolean;
  /** Why not, when `canBulkAccept` is false. */
  blockedReason: string | null;
}

/**
 * Plan a bulk accept for one engagement.
 *
 * `fields` holds every extracted field for the engagement so the sample is
 * stable as values get decided: membership is computed over low-risk fields in
 * any state, then pending ones are looked at.
 */
export function planBulkAccept(
  engagementId: string,
  fields: Array<TriageField & { declaredMismatch?: boolean }>,
  rate = DEFAULT_SAMPLE_RATE
): BulkPlan {
  const lowRiskAll = fields.filter(
    (f) =>
      (f.provenance_type ?? "document_page") === "document_page" &&
      assessRisk(f, { declaredMismatch: f.declaredMismatch }).tier === "low"
  );
  const sample = selectSample(engagementId, lowRiskAll, rate);
  const sampleIds = new Set(sample.map((s) => s.id));
  const pending = lowRiskAll.filter((f) => f.state === "suggested");
  const sampleView = sample.map((s) => ({ id: s.id, field_path: s.field_path, state: s.state }));
  const sampleDecided = sample.filter((s) => s.state !== "suggested").length;
  const sampleBad = sample.filter((s) => s.state === "rejected" || s.state === "corrected").length;
  const eligibleIds = pending.filter((f) => !sampleIds.has(f.id)).map((f) => f.id);

  let blockedReason: string | null = null;
  if (eligibleIds.length === 0) {
    blockedReason = "There are no low-risk values waiting outside the review sample.";
  } else if (sampleDecided < sample.length) {
    blockedReason = `Review the sample first: ${sample.length - sampleDecided} of ${sample.length} sampled values are still undecided.`;
  } else if (sampleBad > 0) {
    blockedReason = `${sampleBad} sampled value(s) were rejected or corrected, so the remaining low-risk values cannot be accepted in bulk. Review them individually.`;
  } else if (eligibleIds.length > MAX_BULK_BATCH) {
    blockedReason = `Accept at most ${MAX_BULK_BATCH} values at a time; ${eligibleIds.length} are eligible.`;
  }

  return {
    lowRiskPending: pending.length,
    sample: sampleView,
    sampleDecided,
    sampleRejectedOrCorrected: sampleBad,
    eligibleIds,
    canBulkAccept: blockedReason === null,
    blockedReason,
  };
}

export interface AcceptanceShare {
  total: number;
  individual: number;
  bulk: number;
  /** bulk / total, 0 when there are no accepted values. */
  bulkShare: number;
}

/** How the accepted values were decided, for the report and for the reviewer. */
export function acceptanceShare(
  accepted: Array<{ accept_mode?: "individual" | "bulk" | null }>
): AcceptanceShare {
  const total = accepted.length;
  const bulk = accepted.filter((a) => a.accept_mode === "bulk").length;
  return { total, individual: total - bulk, bulk, bulkShare: total === 0 ? 0 : bulk / total };
}

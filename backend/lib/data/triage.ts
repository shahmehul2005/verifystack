import "server-only";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import {
  DEFAULT_SAMPLE_RATE,
  acceptanceShare,
  assessRisk,
  planBulkAccept,
  type AcceptanceShare,
  type BulkPlan,
  type RiskAssessment,
} from "@verifystack/backend/domain/triage/risk";
import {
  DEFAULT_TOLERANCE,
  compareDeclared,
  mismatchedPaths,
  summariseComparisons,
  type Comparison,
  type ComparisonSummary,
} from "@verifystack/backend/domain/compare/declared";
import { isSnipProvenance } from "@verifystack/backend/domain/deskreview/snip";
import type { Tables } from "@verifystack/backend/lib/supabase/types";

export interface EngagementTriage {
  sampleRate: number;
  /** True when the rate comes from an approved verification plan, false for the firm default. */
  sampleRateFromPlan: boolean;
  fields: Tables<"extracted_fields">[];
  risk: Map<string, RiskAssessment>;
  sampleIds: Set<string>;
  plan: BulkPlan;
  comparisons: Comparison[];
  comparisonSummary: ComparisonSummary;
  share: AcceptanceShare;
  declaredCount: number;
}

/**
 * Everything the review screens and the bulk-accept route need to agree on:
 * which values are low-risk, which of them form the sample, what the entity
 * declared and where the evidence disagrees. One function, so the page and the
 * route cannot compute different samples.
 */
export async function loadEngagementTriage(
  organizationId: string,
  engagementId: string
): Promise<EngagementTriage> {
  const db = createServiceClient() ?? (await createServerSupabase());
  if (!db) throw new Error("Supabase is not configured");

  const [fieldsRes, declaredRes, factsRes, planRes] = await Promise.all([
    db.from("extracted_fields").select("*").eq("engagement_id", engagementId).eq("organization_id", organizationId),
    db.from("declared_values").select("*").eq("engagement_id", engagementId).eq("organization_id", organizationId),
    db.from("facts").select("*").eq("engagement_id", engagementId).eq("organization_id", organizationId),
    db
      .from("verification_plans")
      .select("sample_rate, status, version")
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId)
      .eq("status", "approved")
      .order("version", { ascending: false })
      .limit(1),
  ]);
  const fields = fieldsRes.data ?? [];
  const declared = declaredRes.data ?? [];
  const facts = factsRes.data ?? [];
  const approved = planRes.data?.[0];
  const sampleRate = approved ? Number(approved.sample_rate) : DEFAULT_SAMPLE_RATE;

  // Evidence for the comparison: what is waiting plus what has been accepted.
  const pending = fields.filter((f) => f.state === "suggested" || f.state === "corrected");
  const evidence = [
    ...pending.map((f) => ({
      fieldPath: f.field_path,
      value: f.state === "corrected" && f.correction_json !== null ? f.correction_json : f.value_json,
      unit: f.unit,
      refId: f.id,
    })),
    ...facts.map((f) => ({ fieldPath: f.field_path, value: f.value_json, unit: f.unit, refId: f.id })),
  ];
  const comparisons = compareDeclared(
    declared.map((d) => ({
      fieldPath: d.field_path,
      value: d.value_json as number | string | boolean | null,
      unit: d.unit,
      source: d.source,
    })),
    evidence,
    { tolerance: DEFAULT_TOLERANCE }
  );
  const mismatched = mismatchedPaths(comparisons);

  const triageInput = fields.map((f) => ({
    id: f.id,
    field_path: f.field_path,
    confidence: Number(f.confidence),
    triage_action: f.triage_action,
    state: f.state,
    provenance_type: f.provenance_type,
    snip: isSnipProvenance(f.provenance),
    declaredMismatch: mismatched.has(f.field_path),
  }));
  const plan = planBulkAccept(engagementId, triageInput, sampleRate);

  const risk = new Map<string, RiskAssessment>();
  for (const f of fields) {
    risk.set(
      f.id,
      assessRisk(
        { field_path: f.field_path, confidence: Number(f.confidence), triage_action: f.triage_action, snip: isSnipProvenance(f.provenance) },
        { declaredMismatch: mismatched.has(f.field_path) }
      )
    );
  }

  return {
    sampleRate,
    sampleRateFromPlan: Boolean(approved),
    fields,
    risk,
    sampleIds: new Set(plan.sample.map((s) => s.id)),
    plan,
    comparisons,
    comparisonSummary: summariseComparisons(comparisons),
    share: acceptanceShare(facts),
    declaredCount: declared.length,
  };
}

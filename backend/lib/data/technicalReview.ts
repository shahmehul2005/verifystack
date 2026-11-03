import "server-only";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { loadPack } from "@verifystack/backend/domain/packs";
import {
  draftersOf,
  evaluateTechnicalReview,
  reviewSnapshotHash,
  type TechnicalReviewState,
} from "@verifystack/backend/domain/review/technical";
import type { Tables } from "@verifystack/backend/lib/supabase/types";

export interface TechnicalReviewContext {
  required: boolean;
  snapshotHash: string;
  state: TechnicalReviewState;
  drafters: Set<string>;
  reviews: Tables<"technical_reviews">[];
  factCount: number;
  latestRun: { id: string; input_hash: string; created_at: string } | null;
}

/**
 * Everything a technical review, and the sign-off gate that depends on it,
 * needs to know about an engagement right now. One loader so the review page,
 * the review route and the sign-off route cannot disagree about "stale".
 */
export async function loadTechnicalReview(
  organizationId: string,
  engagement: Pick<Tables<"engagements">, "id" | "pack_id" | "adeetie_phase">
): Promise<TechnicalReviewContext> {
  const supabase = createServiceClient() ?? (await createServerSupabase());
  if (!supabase) throw new Error("Supabase is not configured");

  const [{ data: facts }, { data: runs }, { data: reviews }] = await Promise.all([
    supabase
      .from("facts")
      .select("id, value_json, unit, accepted_by")
      .eq("engagement_id", engagement.id)
      .eq("organization_id", organizationId),
    supabase
      .from("calculation_runs")
      .select("id, input_hash, created_by, created_at")
      .eq("engagement_id", engagement.id)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("technical_reviews")
      .select("*")
      .eq("engagement_id", engagement.id)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
  ]);

  const latestRun = runs?.[0] ?? null;
  const snapshotHash = reviewSnapshotHash({
    runInputHash: latestRun?.input_hash ?? null,
    facts: (facts ?? []).map((f) => ({ id: f.id, value_json: f.value_json, unit: f.unit })),
  });
  const phaseReviews = (reviews ?? []).filter((r) => (r.adeetie_phase ?? null) === (engagement.adeetie_phase ?? null));
  const required = loadPack(engagement.pack_id).technical_review_required === true;
  const state = evaluateTechnicalReview({
    required,
    reviews: phaseReviews.map((r) => ({
      id: r.id,
      reviewer_user_id: r.reviewer_user_id,
      decision: r.decision,
      snapshot_hash: r.snapshot_hash,
      created_at: r.created_at,
    })),
    currentSnapshotHash: snapshotHash,
  });

  return {
    required,
    snapshotHash,
    state,
    drafters: draftersOf({
      factAcceptors: (facts ?? []).map((f) => f.accepted_by),
      runCreators: (runs ?? []).map((r) => r.created_by),
    }),
    reviews: phaseReviews,
    factCount: facts?.length ?? 0,
    latestRun: latestRun
      ? { id: latestRun.id, input_hash: latestRun.input_hash, created_at: latestRun.created_at }
      : null,
  };
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { loadTechnicalReview } from "@verifystack/backend/lib/data/technicalReview";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { displayNameOf } from "@verifystack/backend/lib/auth/displayName";
import {
  TechnicalReviewError,
  assertReviewInput,
  assertReviewerIndependent,
} from "@verifystack/backend/domain/review/technical";

const Body = z.object({
  engagementId: z.string().uuid(),
  decision: z.enum(["approved", "changes_requested"]),
  comments: z.string().trim().max(8000),
});

/**
 * Record an independent technical review of the engagement as it stands now.
 * The decision is bound to a hash of the run and the accepted facts, so any
 * later change makes it stale. Reviews are append-only: a new one supersedes.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.technical");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const body = parsed.data;
    const engagement = await getEngagement(body.engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    assertReviewInput(body.decision, body.comments);

    const ctx = await loadTechnicalReview(organizationId, engagement);
    assertReviewerIndependent(session.user.id, ctx.drafters);
    if (!ctx.latestRun) {
      throw new TechnicalReviewError("There is nothing to review yet: no calculation has been run.");
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const reviewerName = displayNameOf(session.user);
    const { data: row, error } = await supabase
      .from("technical_reviews")
      .insert({
        organization_id: organizationId,
        engagement_id: engagement.id,
        adeetie_phase: engagement.scheme === "ADEETIE" ? engagement.adeetie_phase : null,
        reviewer_user_id: session.user.id,
        reviewer_name: reviewerName,
        decision: body.decision,
        comments: body.comments,
        snapshot_hash: ctx.snapshotHash,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: `technical_review.${body.decision}`,
      entityType: "technical_review",
      entityId: row.id,
      payload: {
        snapshot_hash: ctx.snapshotHash,
        run_input_hash: ctx.latestRun.input_hash,
        facts: ctx.factCount,
        reviewer: reviewerName,
      },
    });

    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    return jsonError(e);
  }
}

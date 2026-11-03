import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { loadEngagementTriage } from "@verifystack/backend/lib/data/triage";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import {
  PlanContentSchema,
  PlanError,
  assessPlan,
  deriveAutoFactors,
  planApprovalBlockers,
  planContentHash,
} from "@verifystack/backend/domain/planning/plan";
import type { Json } from "@verifystack/backend/lib/supabase/types";

const Body = z.object({
  engagementId: z.string().uuid(),
  action: z.enum(["save", "approve"]),
  /** Required for save; ignored for approve, which approves the latest saved draft. */
  content: PlanContentSchema.optional(),
});

/**
 * Verification plan versions (DFD 13.0). Rows are immutable, so every save and
 * the approval itself are new versions; the approved row carries the same
 * content hash as the draft it approves, which is the audit link between them.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("plan.manage");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    const { engagementId, action } = parsed.data;
    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Engagement not found" }, { status: 404 });
    const db = createServiceClient() ?? (await createServerSupabase());
    if (!db) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { data: latestRows } = await db
      .from("verification_plans")
      .select("*")
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId)
      .order("version", { ascending: false })
      .limit(1);
    const latest = latestRows?.[0] ?? null;

    const triage = await loadEngagementTriage(organizationId, engagementId);
    const auto = deriveAutoFactors({
      comparison: { compared: triage.comparisonSummary.compared, disagree: triage.comparisonSummary.disagree },
    });

    let content;
    if (action === "save") {
      if (!parsed.data.content) {
        return NextResponse.json({ ok: false, error: "A plan is required." }, { status: 400 });
      }
      content = parsed.data.content;
    } else {
      if (!latest) throw new PlanError("Save a plan before approving it.");
      if (latest.status === "approved") throw new PlanError("The latest version is already approved.");
      const stored = PlanContentSchema.safeParse(latest.content);
      if (!stored.success) throw new PlanError("The saved plan is unreadable. Save it again.");
      content = stored.data;
      const blockers = planApprovalBlockers(content, auto);
      if (blockers.length > 0) {
        return NextResponse.json({ ok: false, error: blockers.join(" ") }, { status: 422 });
      }
    }

    const assessment = assessPlan(content, auto);
    const { data: row, error } = await db
      .from("verification_plans")
      .insert({
        organization_id: organizationId,
        engagement_id: engagementId,
        version: (latest?.version ?? 0) + 1,
        status: action === "approve" ? "approved" : "draft",
        content: content as unknown as Json,
        content_hash: planContentHash(content),
        overall_risk: assessment.overall,
        sample_rate: assessment.sampleRate,
        created_by: session.user.id,
        approved_by: action === "approve" ? session.user.id : null,
      })
      .select("id, version, status")
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { ok: false, error: "Someone saved a newer version first. Reload and try again." },
          { status: 409 }
        );
      }
      throw new Error(error.message);
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: action === "approve" ? "plan.approved" : "plan.saved",
      entityType: "verification_plan",
      entityId: row.id,
      payload: {
        engagementId,
        version: row.version,
        overall: assessment.overall,
        sampleRate: assessment.sampleRate,
        sampleRateSource: assessment.sampleRateSource,
      },
    });
    return NextResponse.json({ ok: true, version: row.version, status: row.status });
  } catch (e) {
    return jsonError(e);
  }
}

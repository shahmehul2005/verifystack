import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import type { DeskOutcome } from "@verifystack/backend/domain/deskreview/engine";
import { deskFindingDraft } from "@verifystack/backend/domain/deskreview/toFindings";
import type { Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

const Body = z.object({ engagementId: z.string().uuid(), ruleId: z.string().min(1).max(120) });

/**
 * Raise the finding for one desk-review check in one step. The request names
 * the check and nothing else: the title, the figures, the clause, the size of
 * the gap and what the plant is asked to supply are all built here from the
 * latest saved run and the clause registry. A finding already stored for the
 * check, in any state, is returned and not duplicated.
 */
export async function POST(req: Request) {
  try {
    await requireCapability("review.decide");
    const session = await requireCapability("findings.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    const { engagementId, ruleId } = parsed.data;

    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const supabase = createServiceClient();
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { data: review, error: reviewError } = await supabase
      .from("desk_reviews")
      .select("results")
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (reviewError) throw new Error(reviewError.message);
    const outcome = ((review?.results ?? []) as unknown as DeskOutcome[]).find((r) => r.id === ruleId);
    if (!outcome) {
      return NextResponse.json({ ok: false, error: "That check is not in the latest desk review. Run the review first." }, { status: 404 });
    }
    if (outcome.status === "pass") {
      return NextResponse.json({ ok: false, error: "This check agrees, so there is nothing to raise." }, { status: 409 });
    }

    const draft = deskFindingDraft(outcome);
    const { data: existing, error: existingError } = await supabase
      .from("findings")
      .select("id, state")
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId)
      .eq("rule_id", draft.ruleId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return NextResponse.json({ ok: true, created: false, findingId: existing.id, state: existing.state });

    const { data: created, error: createError } = await supabase
      .from("findings")
      .insert({
        organization_id: organizationId,
        engagement_id: engagementId,
        calculation_run_id: null,
        rule_id: draft.ruleId,
        severity: draft.severity,
        title: draft.title,
        detail: draft.detail,
        clause_ref: draft.clauseRef,
        evidence_refs: draft.evidenceRefs as unknown as Json,
        magnitude: (draft.magnitude ?? null) as unknown as Json | null,
        required_response: draft.requiredResponse,
        generator: "desk_review",
        state: "suggested" as const,
      })
      .select("id, state")
      .single();
    if (createError || !created) throw new Error(createError?.message ?? "Could not raise the finding");

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "finding.raised",
      entityType: "finding",
      entityId: created.id,
      payload: { engagementId, ruleId: draft.ruleId, severity: draft.severity, clauseVerified: draft.clauseVerified },
    });
    return NextResponse.json({ ok: true, created: true, findingId: created.id, state: created.state });
  } catch (e) {
    return jsonError(e);
  }
}

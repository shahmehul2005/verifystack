import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { loadEngagementTriage } from "@verifystack/backend/lib/data/triage";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";

const Body = z.object({
  engagementId: z.string().uuid(),
  /** The count the verifier saw. A different count means the queue changed under them. */
  expectedCount: z.number().int().positive(),
});

/**
 * Accept the low-risk values outside the review sample in one audited action
 * (DFD 4.0). The same function that draws the page decides eligibility here, so
 * a stale browser tab cannot widen what is accepted: the route recomputes the
 * plan and refuses unless the sample is fully reviewed and clean.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    const { engagementId, expectedCount } = parsed.data;

    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Engagement not found" }, { status: 404 });
    const db = createServiceClient() ?? (await createServerSupabase());
    if (!db) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const triage = await loadEngagementTriage(organizationId, engagementId);
    if (!triage.plan.canBulkAccept) {
      return NextResponse.json({ ok: false, error: triage.plan.blockedReason }, { status: 409 });
    }
    const ids = triage.plan.eligibleIds;
    if (ids.length !== expectedCount) {
      return NextResponse.json(
        {
          ok: false,
          error: `The queue changed: ${ids.length} value(s) are now eligible, not ${expectedCount}. Reload and check again.`,
        },
        { status: 409 }
      );
    }
    const byId = new Map(triage.fields.map((f) => [f.id, f]));

    const batchId = randomUUID();
    const { error: batchErr } = await db.from("bulk_accept_batches").insert({
      id: batchId,
      organization_id: organizationId,
      engagement_id: engagementId,
      accepted_by: session.user.id,
      accepted_count: ids.length,
      sample_rate: triage.sampleRate,
      sample_field_ids: triage.plan.sample.map((s) => s.id),
      accepted_field_ids: ids,
    });
    if (batchErr) throw new Error(batchErr.message);

    // Only rows still waiting are accepted; a value decided in the meantime is left alone.
    const { data: updated, error: upErr } = await db
      .from("extracted_fields")
      .update({
        state: "accepted",
        reviewed_by: session.user.id,
        reviewed_at: new Date().toISOString(),
        accept_mode: "bulk",
        bulk_batch_id: batchId,
      })
      .in("id", ids)
      .eq("state", "suggested")
      .eq("organization_id", organizationId)
      .select("id");
    if (upErr) throw new Error(upErr.message);
    const acceptedIds = new Set((updated ?? []).map((u) => u.id));

    const rows = ids
      .filter((id) => acceptedIds.has(id))
      .map((id) => byId.get(id)!)
      .map((f) => ({
        organization_id: organizationId,
        engagement_id: engagementId,
        extracted_field_id: f.id,
        document_id: f.document_id,
        field_path: f.field_path,
        value_json: f.value_json,
        unit: f.unit,
        page: f.page,
        bbox: f.bbox,
        source_text: f.source_text,
        provenance_type: f.provenance_type,
        provenance: f.provenance,
        accepted_by: session.user.id,
        accept_mode: "bulk" as const,
        bulk_batch_id: batchId,
      }));
    if (rows.length > 0) {
      const { error: factErr } = await db.from("facts").insert(rows);
      if (factErr) throw new Error(factErr.message);
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "field.bulk_accepted",
      entityType: "bulk_accept_batch",
      entityId: batchId,
      payload: {
        engagementId,
        count: rows.length,
        intended: ids.length,
        sampleRate: triage.sampleRate,
        sampleSize: triage.plan.sample.length,
      },
    });
    if (rows.length > 0) {
      await ensureEngagementStatus({
        organizationId,
        actorUserId: session.user.id,
        engagementId,
        current: engagement.status,
        target: "review",
      });
    }
    return NextResponse.json({ ok: true, batchId, accepted: rows.length });
  } catch (e) {
    return jsonError(e);
  }
}

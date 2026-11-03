import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";

const Body = z.object({
  engagementId: z.string().uuid(),
  fieldPath: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.\-[\]]+$/),
  value: z.union([z.number().finite(), z.string().trim().min(1).max(500)]),
  unit: z.string().trim().max(30).optional(),
});

/**
 * Record a figure the entity declared (typed from a submission form, say). It is
 * stored as a declaration only: it is compared with the evidence and never
 * becomes a fact or enters a calculation.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    const { engagementId, fieldPath, value, unit } = parsed.data;
    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Engagement not found" }, { status: 404 });
    const db = createServiceClient() ?? (await createServerSupabase());
    if (!db) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { error } = await db.from("declared_values").upsert(
      {
        organization_id: organizationId,
        engagement_id: engagementId,
        field_path: fieldPath,
        value_json: value,
        unit: unit || null,
        source: "manual" as const,
        created_by: session.user.id,
      },
      { onConflict: "engagement_id,field_path,source" }
    );
    if (error) throw new Error(error.message);
    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "declared_value.recorded",
      entityType: "engagement",
      entityId: engagementId,
      payload: { fieldPath, unit: unit || null },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

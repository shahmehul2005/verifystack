import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { runDocumentExtraction } from "@verifystack/backend/domain/extraction/runDocument";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCapability("documents.extract");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const admin = createServiceClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { data: doc } = await admin
      .from("documents")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();
    if (!doc) {
      return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
    }
    const engagement = await getEngagement(doc.engagement_id, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Engagement not found" }, { status: 404 });
    }

    const result = await runDocumentExtraction({
      organizationId,
      engagementId: engagement.id,
      documentId: doc.id,
      packId: engagement.pack_id,
    });

    if (result.ok) {
      await ensureEngagementStatus({
        organizationId,
        engagementId: engagement.id,
        current: engagement.status,
        target: "review",
      });
    }

    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return jsonError(error);
  }
}

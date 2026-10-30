import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";

export const runtime = "nodejs";

/**
 * Remove an uploaded document from the engagement.
 * Deletes storage object and cascades deletion to extracted pages, fields, and datasets.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const { data: doc } = await supabase
      .from("documents")
      .select("id, original_filename, storage_path, engagement_id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!doc) {
      return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
    }

    // 1. Remove storage object from evidence bucket if present
    if (doc.storage_path) {
      await supabase.storage.from("evidence").remove([doc.storage_path]);
    }

    // 2. Delete document record (foreign keys cascade to pages, datasets, and extracted fields)
    const { error: delErr } = await supabase
      .from("documents")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (delErr) throw new Error(delErr.message);

    // 3. Audit log deletion
    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "document.deleted",
      entityType: "document",
      entityId: id,
      payload: { filename: doc.original_filename, engagementId: doc.engagement_id },
    });

    return NextResponse.json({ ok: true, id, filename: doc.original_filename });
  } catch (e) {
    return jsonError(e);
  }
}

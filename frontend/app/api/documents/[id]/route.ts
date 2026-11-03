import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { assessRemoval } from "@verifystack/backend/domain/intake/removal";
import type { Status } from "@verifystack/backend/domain/engagements/status";

export const runtime = "nodejs";

const COUNT = { count: "exact" as const, head: true };

/**
 * Remove an uploaded document from its engagement.
 *
 * The rule is `assessRemoval`: nothing may rest on the file. Deleting the row
 * cascades to its pages, extraction jobs, unreviewed suggestions and dataset
 * rows. The stored bytes are keyed by their hash and shared by every engagement
 * that uploaded the same file, so they are deleted only when no document row,
 * in any engagement, still points at them. The removal is audit-logged with the
 * file's name and hash, so the record shows what was taken out and by whom.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;

    const admin = createServiceClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const { data: doc } = await admin
      .from("documents")
      .select("id, engagement_id, organization_id, sha256, storage_path, original_filename, source, slot")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const engagement = await getEngagement(doc.engagement_id, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const [facts, fields, declared, readings] = await Promise.all([
      admin.from("facts").select("id", COUNT).eq("document_id", id),
      admin.from("extracted_fields").select("id", COUNT).eq("document_id", id).neq("state", "suggested"),
      admin.from("declared_values").select("id", COUNT).eq("document_id", id),
      admin.from("desk_readings").select("id", COUNT).eq("document_id", id),
    ]);
    for (const r of [facts, fields, declared, readings]) {
      if (r.error) throw new Error(r.error.message);
    }

    const verdict = assessRemoval({
      engagementStatus: engagement.status as Status,
      source: doc.source,
      facts: facts.count ?? 0,
      reviewedFields: fields.count ?? 0,
      declaredValues: declared.count ?? 0,
      deskReadings: readings.count ?? 0,
    });
    if (!verdict.allowed) {
      return NextResponse.json(
        { ok: false, error: `This document cannot be removed. ${verdict.reasons.join(" ")}`, reasons: verdict.reasons },
        { status: 409 }
      );
    }

    const { error: delErr } = await admin
      .from("documents")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (delErr) throw new Error(delErr.message);

    // The bytes are shared by hash. Remove them only when nothing else uses them.
    let storageRemoved = false;
    const { count: stillUsed, error: usedErr } = await admin
      .from("documents")
      .select("id", COUNT)
      .eq("storage_path", doc.storage_path);
    if (!usedErr && (stillUsed ?? 0) === 0) {
      const { error: rmErr } = await admin.storage.from("evidence").remove([doc.storage_path]);
      storageRemoved = !rmErr;
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "document.removed",
      entityType: "document",
      entityId: id,
      payload: {
        engagementId: doc.engagement_id,
        filename: doc.original_filename,
        sha256: doc.sha256,
        source: doc.source,
        slot: doc.slot ?? null,
        storageRemoved,
      },
    });

    return NextResponse.json({ ok: true, storageRemoved });
  } catch (e) {
    return jsonError(e);
  }
}

import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { sha256Bytes, evidenceObjectKey } from "@verifystack/backend/lib/hash";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { canStartWork, loadPack } from "@verifystack/backend/domain/packs";
import { countEvidencePages, documentPageInserts } from "@verifystack/backend/domain/extraction/pages";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { inngest } from "@verifystack/backend/inngest/client";
import { isInngestConfigured } from "@verifystack/backend/lib/supabase/configured";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const engagementId = req.headers.get("x-engagement-id");
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "upload.bin");
    if (!engagementId) {
      return NextResponse.json({ ok: false, error: "x-engagement-id required" }, { status: 400 });
    }
    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Engagement not found" }, { status: 404 });
    }
    const pack = loadPack(engagement.pack_id);
    if (!canStartWork(pack)) {
      return NextResponse.json(
        { ok: false, error: "Scaffold packs cannot start active work" },
        { status: 409 }
      );
    }

    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.byteLength < 16) {
      return NextResponse.json({ ok: false, error: "File too small" }, { status: 400 });
    }
    const sha256 = sha256Bytes(buf);
    const storagePath = evidenceObjectKey(sha256);
    const mime = req.headers.get("content-type") || "application/octet-stream";

    const admin = createServiceClient() ?? (await createServerSupabase());
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const { data: existing } = await admin
      .from("documents")
      .select("*")
      .eq("engagement_id", engagementId)
      .eq("sha256", sha256)
      .maybeSingle();
    if (existing) {
      await auditEvent({
        organizationId,
        action: "document.deduped",
        entityType: "document",
        entityId: existing.id,
        payload: { sha256 },
      });
      await ensureEngagementStatus({
        organizationId,
        engagementId,
        current: engagement.status,
        target: "intake",
      });
      return NextResponse.json({ ok: true, document: existing, deduped: true });
    }

    const { error: upErr } = await admin.storage.from("evidence").upload(storagePath, buf, {
      contentType: mime,
      upsert: true,
    });
    if (upErr && !/exists|duplicate/i.test(upErr.message)) {
      throw new Error(`Storage: ${upErr.message}`);
    }

    const { data: doc, error } = await admin
      .from("documents")
      .insert({
        organization_id: organizationId,
        engagement_id: engagementId,
        sha256,
        storage_path: storagePath,
        original_filename: filename,
        mime_type: mime,
        byte_size: buf.byteLength,
        created_by: session.user.id,
        ...(engagement.scheme === "ADEETIE" && engagement.adeetie_phase
          ? { adeetie_phase: engagement.adeetie_phase }
          : {}),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await auditEvent({
      organizationId,
      action: "document.uploaded",
      entityType: "document",
      entityId: doc.id,
      payload: { sha256, filename },
    });

    const pageCount = await countEvidencePages(buf, mime);
    await admin.from("document_pages").upsert(
      documentPageInserts(organizationId, doc.id, pageCount, storagePath),
      { onConflict: "document_id,page_number" }
    );
    await admin.from("documents").update({ page_count: pageCount }).eq("id", doc.id);

    if (isInngestConfigured()) {
      await inngest.send({
        name: "documents/uploaded",
        data: {
          organizationId,
          engagementId,
          documentId: doc.id,
          sha256,
          mimeType: mime,
          packId: engagement.pack_id,
        },
      });
    }

    await ensureEngagementStatus({
      organizationId,
      engagementId,
      current: engagement.status,
      target: "intake",
    });
    return NextResponse.json({ ok: true, document: doc, deduped: false });
  } catch (e) {
    return jsonError(e);
  }
}
